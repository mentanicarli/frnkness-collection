import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/supabaseClient'
import { rlog, tokenTtlSeconds } from './log'

/**
 * Приватный канал комнаты (Supabase Realtime): broadcast — команды хозяина,
 * presence — кто сейчас в комнате. Права проверяет база (политики на
 * realtime.messages): слушают участники, команды шлёт только хозяин.
 * Интерфейс узкий, чтобы в тестах подставлять подделку вместо сети.
 *
 * Подключение к приватному каналу требует токен вошедшего ДО входа в канал.
 * supabase-js сам передаёт токен Realtime только при событиях SIGNED_IN и
 * TOKEN_REFRESHED, а после обновления страницы с сохранённой сессией
 * (INITIAL_SESSION) — нет: канал пытался войти с анонимным ключом и получал
 * отказ. Поэтому токен берём из сессии и передаём явно, каждый раз.
 */

export interface PresenceEntry {
    role?: string
}

export interface ChannelEvents {
    onBroadcast(event: string, payload: unknown): void
    /** Кто сейчас в канале: ключ — id пользователя. */
    onPresence(users: Map<string, PresenceEntry>): void
    /** Соединение вернулось после обрыва (первое подключение сюда не приходит). */
    onReconnect(): void
    /** Соединение оборвалось (клиент сам пробует вернуться). */
    onDown(): void
}

export interface RoomChannel {
    /** Подписаться; готово, когда канал принят сервером (иначе — ошибка с причиной). */
    start(): Promise<void>
    /** false — не отправлено. */
    send(event: string, payload: unknown): Promise<boolean>
    /** Объявить себя в Presence; ошибка, если сервер не подтвердил. */
    track(meta: { role: string }): Promise<void>
    stop(): Promise<void>
}

export type ChannelFactory = (topic: string, userId: string, events: ChannelEvents) => RoomChannel

/** Одна попытка входа в канал; дольше ждать смысла нет — контроллер повторит с новым каналом. */
export const START_TIMEOUT_MS = 12_000

function presenceMap(channel: RealtimeChannel): Map<string, PresenceEntry> {
    const out = new Map<string, PresenceEntry>()
    const state = channel.presenceState<{ role?: unknown }>()
    for (const [key, metas] of Object.entries(state)) {
        const meta = metas?.[0]
        out.set(key, { role: typeof meta?.role === 'string' ? meta.role : undefined })
    }
    return out
}

export const createSupabaseChannel: ChannelFactory = (topic, userId, events) => {
    let channel: RealtimeChannel | null = null
    let connected = false
    let stopped = false

    return {
        async start() {
            const started = Date.now()
            const { data } = await supabase.auth.getSession()
            const token = data.session?.access_token
            if (!token) {
                rlog('канал: нет сессии, токен не получен', topic)
                throw new Error('Нет сессии для входа в канал')
            }
            rlog('канал: вход', topic, `токен живёт ещё ${tokenTtlSeconds(token)} с`)
            // Токен — Realtime до подписки: приватный канал проверяет права по нему.
            await supabase.realtime.setAuth(token)
            const ch = supabase.channel(topic, { config: { private: true, broadcast: { self: false }, presence: { key: userId } } })
            channel = ch
            ch.on('broadcast', { event: '*' }, (message) => events.onBroadcast(String(message.event), message.payload))
            ch.on('presence', { event: 'sync' }, () => events.onPresence(presenceMap(ch)))
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => {
                    rlog('канал: таймаут входа', topic, `${Date.now() - started} мс`)
                    reject(new Error('Таймаут входа в канал'))
                }, START_TIMEOUT_MS)
                ch.subscribe((status, err) => {
                    if (stopped) return
                    rlog('канал: статус', status, err ? err.message : '', `${Date.now() - started} мс`)
                    if (status === 'SUBSCRIBED') {
                        clearTimeout(timer)
                        if (connected) events.onReconnect()
                        else resolve()
                        connected = true
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                        if (!connected) {
                            clearTimeout(timer)
                            reject(err ?? new Error(`Канал: ${status}`))
                        } else {
                            events.onDown()
                        }
                    }
                })
            })
        },
        async send(event, payload) {
            if (!channel || stopped) return false
            try {
                const result = await channel.send({ type: 'broadcast', event, payload })
                if (result !== 'ok') rlog('канал: сообщение не отправлено', event, result)
                return result === 'ok'
            } catch (e) {
                rlog('канал: ошибка отправки', event, String(e))
                return false
            }
        },
        async track(meta) {
            if (!channel) throw new Error('Канал не открыт')
            const result = await channel.track({ user_id: userId, ...meta })
            rlog('канал: presence track', result)
            if (result !== 'ok') throw new Error(`Presence: ${result}`)
        },
        async stop() {
            stopped = true
            const ch = channel
            channel = null
            if (ch) await supabase.removeChannel(ch).catch(() => undefined)
        }
    }
}
