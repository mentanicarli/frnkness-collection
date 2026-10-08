import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/supabaseClient'

/**
 * Приватный канал комнаты (Supabase Realtime): broadcast — команды хозяина,
 * presence — кто сейчас в комнате. Права проверяет база (политики на
 * realtime.messages): слушают участники, команды шлёт только хозяин.
 * Интерфейс узкий, чтобы в тестах подставлять подделку вместо сети.
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
}

export interface RoomChannel {
    /** Подписаться; готово, когда канал принят сервером (иначе — ошибка). */
    start(): Promise<void>
    /** false — не отправлено. */
    send(event: string, payload: unknown): Promise<boolean>
    track(meta: { role: string }): Promise<void>
    stop(): Promise<void>
}

export type ChannelFactory = (topic: string, userId: string, events: ChannelEvents) => RoomChannel

const START_TIMEOUT_MS = 10_000

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

    return {
        async start() {
            // Приватному каналу нужен токен вошедшего.
            await supabase.realtime.setAuth()
            const ch = supabase.channel(topic, { config: { private: true, broadcast: { self: false }, presence: { key: userId } } })
            channel = ch
            ch.on('broadcast', { event: '*' }, (message) => events.onBroadcast(String(message.event), message.payload))
            ch.on('presence', { event: 'sync' }, () => events.onPresence(presenceMap(ch)))
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('timeout')), START_TIMEOUT_MS)
                ch.subscribe((status, err) => {
                    if (status === 'SUBSCRIBED') {
                        clearTimeout(timer)
                        if (connected) events.onReconnect()
                        else resolve()
                        connected = true
                    } else if (!connected && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
                        clearTimeout(timer)
                        reject(err ?? new Error(status))
                    }
                })
            })
        },
        async send(event, payload) {
            if (!channel) return false
            try {
                return (await channel.send({ type: 'broadcast', event, payload })) === 'ok'
            } catch {
                return false
            }
        },
        async track(meta) {
            await channel?.track({ user_id: userId, ...meta })
        },
        async stop() {
            const ch = channel
            channel = null
            if (ch) await supabase.removeChannel(ch).catch(() => undefined)
        }
    }
}
