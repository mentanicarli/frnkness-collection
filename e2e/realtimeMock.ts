// Supabase Realtime в e2e: поддельный сервер WebSocket (протокол Phoenix,
// версия 2.0.0 — как у настоящего клиента), общий для всех страниц теста.
// Два окна браузера подключаются к одному такому серверу и обмениваются
// broadcast и Presence. Права на каналы проверяет настоящая функция базы
// (room_topic_access на PGlite) — те же правила, что у политик realtime.messages.
import type { Page, WebSocketRoute } from '@playwright/test'
import { jwtSub } from './accountsMock'
import type { SocialBackend } from './socialMock'

interface Join {
    joinRef: string
    topic: string
    wireTopic: string
    key: string
    meta: Record<string, unknown> | null
    phxRef: string
}

interface Conn {
    ws: WebSocketRoute
    userId: string | null
    joins: Map<string, Join>
}

const textDecoder = new TextDecoder()

export class FakeRealtime {
    private conns = new Set<Conn>()
    private refSeq = 0
    /** Сколько сообщений (broadcast) прошло и сколько отклонено политикой. */
    readonly stats = { delivered: 0, denied: 0, joinsDenied: 0 }
    /** Отправленные хозяином broadcast: для проверок. */
    readonly log: { topic: string; event: string; from: string | null }[] = []

    async attach(page: Page, social: SocialBackend): Promise<void> {
        await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
            const conn: Conn = { ws, userId: null, joins: new Map() }
            this.conns.add(conn)
            ws.onMessage((message) => void this.onMessage(conn, message, social))
            ws.onClose(() => {
                for (const join of [...conn.joins.values()]) this.leave(conn, join)
                this.conns.delete(conn)
            })
        })
    }

    /** Разорвать все соединения пользователя (обрыв сети). */
    dropUser(userId: string): void {
        for (const c of [...this.conns]) if (c.userId === userId) c.ws.close()
    }

    private reply(conn: Conn, joinRef: string | null, ref: string | null, topic: string, payload: unknown, event = 'phx_reply') {
        conn.ws.send(JSON.stringify([joinRef, ref, topic, event, payload]))
    }

    private peers(topic: string): Conn[] {
        return [...this.conns].filter((c) => c.joins.has(topic))
    }

    private presenceState(topic: string): Record<string, { metas: Record<string, unknown>[] }> {
        const out: Record<string, { metas: Record<string, unknown>[] }> = {}
        for (const c of this.peers(topic)) {
            const j = c.joins.get(topic)!
            if (j.meta) out[j.key] = { metas: [{ ...j.meta, phx_ref: j.phxRef }] }
        }
        return out
    }

    private presenceDiff(topic: string, joins: Join[], leaves: Join[]) {
        const toMap = (list: Join[]) => Object.fromEntries(list.filter((j) => j.meta).map((j) => [j.key, { metas: [{ ...j.meta, phx_ref: j.phxRef }] }]))
        for (const c of this.peers(topic)) {
            const j = c.joins.get(topic)!
            this.reply(c, j.joinRef, null, j.wireTopic, { joins: toMap(joins), leaves: toMap(leaves) }, 'presence_diff')
        }
    }

    private leave(conn: Conn, join: Join) {
        conn.joins.delete(join.topic)
        this.presenceDiff(join.topic, [], [join])
    }

    private encodeBroadcast(wireTopic: string, event: string, payload: unknown): Buffer {
        const topic = Buffer.from(wireTopic)
        const name = Buffer.from(event)
        const body = Buffer.from(JSON.stringify(payload))
        return Buffer.concat([Buffer.from([4, topic.length, name.length, 0, 1]), topic, name, body])
    }

    private async onMessage(conn: Conn, message: string | Buffer, social: SocialBackend): Promise<void> {
        if (typeof message !== 'string') return this.onBinary(conn, message, social)
        const [joinRef, ref, wireTopic, event, payload] = JSON.parse(message) as [string | null, string | null, string, string, any]
        const topic = wireTopic.replace(/^realtime:/, '')
        switch (event) {
            case 'heartbeat':
                return this.reply(conn, null, ref, 'phoenix', { status: 'ok', response: {} })
            case 'access_token':
                return this.reply(conn, joinRef, ref, wireTopic, { status: 'ok', response: {} })
            case 'phx_join': {
                conn.userId = jwtSub(payload?.access_token) ?? conn.userId
                // Приватный канал: права проверяет база.
                if (payload?.config?.private && !(await social.roomAccess(conn.userId, topic, false))) {
                    this.stats.joinsDenied++
                    return this.reply(conn, joinRef, ref, wireTopic, { status: 'error', response: { reason: 'Unauthorized: You do not have permissions to read from this Channel topic' } })
                }
                const key = String(payload?.config?.presence?.key ?? `anon-${++this.refSeq}`)
                conn.joins.set(topic, { joinRef: joinRef ?? '', topic, wireTopic, key, meta: null, phxRef: `ref-${++this.refSeq}` })
                this.reply(conn, joinRef, ref, wireTopic, { status: 'ok', response: { postgres_changes: [] } })
                return this.reply(conn, joinRef, null, wireTopic, this.presenceState(topic), 'presence_state')
            }
            case 'phx_leave': {
                const join = conn.joins.get(topic)
                if (join) this.leave(conn, join)
                return this.reply(conn, joinRef, ref, wireTopic, { status: 'ok', response: {} })
            }
            case 'presence': {
                const join = conn.joins.get(topic)
                if (!join) return
                if (payload?.event === 'track') {
                    const old = join.meta ? { ...join } : null
                    join.meta = payload.payload ?? {}
                    join.phxRef = `ref-${++this.refSeq}`
                    this.presenceDiff(topic, [join], old ? [old] : [])
                } else if (payload?.event === 'untrack' && join.meta) {
                    const old = { ...join }
                    join.meta = null
                    this.presenceDiff(topic, [], [old])
                }
                return this.reply(conn, joinRef, ref, wireTopic, { status: 'ok', response: {} })
            }
            case 'broadcast': {
                // Текстовая форма (на случай JSON-кодировщика клиента).
                if (payload?.type === 'broadcast') await this.forward(conn, topic, wireTopic, String(payload.event), payload.payload, social)
                return
            }
        }
    }

    // Клиент отправляет broadcast бинарным кадром: kind 3, длины, строки, JSON.
    private async onBinary(conn: Conn, buf: Buffer, social: SocialBackend): Promise<void> {
        if (buf[0] !== 3) return
        const [joinLen, refLen, topicLen, eventLen, metaLen, encoding] = [buf[1], buf[2], buf[3], buf[4], buf[5], buf[6]]
        let o = 7 + joinLen + refLen
        const wireTopic = buf.subarray(o, o + topicLen).toString()
        o += topicLen
        const event = buf.subarray(o, o + eventLen).toString()
        o += eventLen + metaLen
        const body = buf.subarray(o)
        const payload = encoding === 1 ? JSON.parse(textDecoder.decode(body)) : body
        await this.forward(conn, wireTopic.replace(/^realtime:/, ''), wireTopic, event, payload, social)
    }

    private async forward(from: Conn, topic: string, wireTopic: string, event: string, payload: unknown, social: SocialBackend) {
        // Команды принимаются только от хозяина (политика insert).
        if (!from.joins.has(topic) || !(await social.roomAccess(from.userId, topic, true))) {
            this.stats.denied++
            return
        }
        this.log.push({ topic, event, from: from.userId })
        for (const c of this.peers(topic)) {
            if (c === from) continue
            this.stats.delivered++
            c.ws.send(this.encodeBroadcast(wireTopic, event, payload))
        }
    }
}
