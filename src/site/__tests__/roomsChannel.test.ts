// Настоящая обёртка канала (src/site/rooms/channel.ts) над поддельным клиентом
// Supabase: токен вошедшего передаётся Realtime ДО подписки на приватный канал
// (после обновления страницы supabase-js сам этого не делает), ошибки входа
// становятся ошибками с причиной, обрыв после подключения — событием onDown.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
let sessionToken: string | null = 'header.eyJleHAiOjk5OTk5OTk5OTl9.sig'
let statusScript: ((cb: (status: string, err?: Error) => void) => void) | null = null
let trackResult = 'ok'
let sendResult = 'ok'
const handlers: Record<string, (msg?: unknown) => void> = {}

const fakeChannel = {
    on: vi.fn((type: string, _filter: unknown, cb: (m?: unknown) => void) => {
        handlers[type] = cb
        return fakeChannel
    }),
    subscribe: vi.fn((cb: (status: string, err?: Error) => void) => {
        calls.push('subscribe')
        statusScript?.(cb)
        return fakeChannel
    }),
    track: vi.fn(async () => trackResult),
    send: vi.fn(async () => sendResult),
    presenceState: vi.fn(() => ({ 'u-1': [{ role: 'host', presence_ref: 'x' }], 'u-2': [{ role: 'guest' }] }))
}

vi.mock('@/supabaseClient', () => ({
    supabase: {
        auth: {
            getSession: vi.fn(async () => ({ data: { session: sessionToken ? { access_token: sessionToken } : null } }))
        },
        realtime: {
            setAuth: vi.fn(async (token?: string) => {
                calls.push(`setAuth:${token ?? ''}`)
            })
        },
        channel: vi.fn((topic: string, config: unknown) => {
            calls.push(`channel:${topic}:${JSON.stringify(config)}`)
            return fakeChannel
        }),
        removeChannel: vi.fn(async () => {
            calls.push('removeChannel')
        })
    }
}))

const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
const { createSupabaseChannel, START_TIMEOUT_MS } = await import('../rooms/channel')

const events = () => ({ onBroadcast: vi.fn(), onPresence: vi.fn(), onReconnect: vi.fn(), onDown: vi.fn() })

beforeEach(() => {
    calls.length = 0
    sessionToken = 'header.eyJleHAiOjk5OTk5OTk5OTl9.sig'
    statusScript = (cb) => queueMicrotask(() => cb('SUBSCRIBED'))
    trackResult = 'ok'
    sendResult = 'ok'
    info.mockClear()
    vi.useRealTimers()
})

describe('канал комнаты на клиенте Supabase', () => {
    it('токен вошедшего передаётся Realtime до создания и подписки приватного канала', async () => {
        const ch = createSupabaseChannel('room:abc:0', 'u-1', events())
        await ch.start()
        expect(calls[0]).toBe(`setAuth:${sessionToken}`)
        expect(calls[1]).toBe('channel:room:abc:0:{"config":{"private":true,"broadcast":{"self":false},"presence":{"key":"u-1"}}}')
        expect(calls[2]).toBe('subscribe')
    })

    it('нет сессии — понятная ошибка, до Realtime дело не доходит', async () => {
        sessionToken = null
        const ch = createSupabaseChannel('room:abc:0', 'u-1', events())
        await expect(ch.start()).rejects.toThrow(/Нет сессии/)
        expect(calls).toEqual([])
    })

    it('отказ при входе (CHANNEL_ERROR, TIMED_OUT, CLOSED) — ошибка с причиной, чтобы контроллер повторил', async () => {
        for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
            statusScript = (cb) => queueMicrotask(() => cb(status, status === 'CHANNEL_ERROR' ? new Error('Unauthorized') : undefined))
            const ch = createSupabaseChannel('room:abc:0', 'u-1', events())
            await expect(ch.start(), status).rejects.toThrow(status === 'CHANNEL_ERROR' ? /Unauthorized/ : new RegExp(status))
        }
    })

    it('тишина дольше таймаута — ошибка «Таймаут входа»', async () => {
        vi.useFakeTimers()
        statusScript = null
        const ch = createSupabaseChannel('room:abc:0', 'u-1', events())
        const started = ch.start()
        const failed = expect(started).rejects.toThrow(/Таймаут/)
        await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS + 10)
        await failed
    })

    it('Presence не подтверждён сервером — track бросает ошибку', async () => {
        const ch = createSupabaseChannel('room:abc:0', 'u-1', events())
        await ch.start()
        await ch.track({ role: 'guest' })
        trackResult = 'timed out'
        await expect(ch.track({ role: 'guest' })).rejects.toThrow(/Presence: timed out/)
    })

    it('обрыв после подключения — onDown; возвращение — onReconnect; остановка молчит', async () => {
        let push: (status: string) => void = () => undefined
        statusScript = (cb) => {
            push = (status) => cb(status)
            queueMicrotask(() => cb('SUBSCRIBED'))
        }
        const ev = events()
        const ch = createSupabaseChannel('room:abc:0', 'u-1', ev)
        await ch.start()
        push('CLOSED')
        expect(ev.onDown).toHaveBeenCalledTimes(1)
        push('SUBSCRIBED')
        expect(ev.onReconnect).toHaveBeenCalledTimes(1)
        await ch.stop()
        push('CLOSED')
        expect(ev.onDown).toHaveBeenCalledTimes(1)
        expect(calls).toContain('removeChannel')
        expect(await ch.send('state', {})).toBe(false)
    })

    it('сообщения и Presence доходят до контроллера; отправка сообщает результат', async () => {
        const ev = events()
        const ch = createSupabaseChannel('room:abc:0', 'u-1', ev)
        await ch.start()
        handlers.broadcast({ event: 'state', payload: { seq: 1 } })
        expect(ev.onBroadcast).toHaveBeenCalledWith('state', { seq: 1 })
        handlers.presence()
        expect([...(ev.onPresence.mock.calls[0][0] as Map<string, unknown>).entries()]).toEqual([
            ['u-1', { role: 'host' }],
            ['u-2', { role: 'guest' }]
        ])
        expect(await ch.send('state', {})).toBe(true)
        sendResult = 'error'
        expect(await ch.send('state', {})).toBe(false)
    })

    it('журнал [rooms] не содержит токена', async () => {
        const ch = createSupabaseChannel('room:abc:0', 'u-1', events())
        await ch.start()
        const lines = info.mock.calls.map((c) => c.join(' '))
        expect(lines.length).toBeGreaterThan(0)
        expect(lines.every((l) => l.startsWith('[rooms]'))).toBe(true)
        expect(lines.join('\n')).not.toContain(sessionToken!)
        expect(lines.join('\n')).toMatch(/токен живёт ещё/)
    })
})
