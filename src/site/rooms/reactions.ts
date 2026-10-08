/**
 * Реакции в комнатах: эмодзи всплывает у всех участников и улетает вверх.
 * Нигде не сохраняются. Идут по отдельному приватному каналу
 * «roomfx:<комната>:<эпоха>», в который пишут все участники (команды плеера
 * идут по «room:…», где пишет только хозяин).
 *
 * Защита от перегруза — на обеих сторонах:
 *   — не больше 2 реакций в секунду на человека: лишние нажатия молча
 *     игнорируются и при отправке, и при получении (чужой клиент мог быть
 *     изменён, поэтому фильтр есть и у остальных);
 *   — общий потолок входящих (чтобы подделанные «отправители» не обошли
 *     фильтр по человеку);
 *   — на экране не больше REACTIONS_ON_SCREEN эмодзи одновременно: новые
 *     сверх этого отбрасываются.
 */
export const REACTION_EMOJIS = ['🔥', '❤️', '😭', '😂', '👏', '🤯', '🫶', '💀'] as const
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

export const REACTIONS_PER_SECOND = 2
/** Общий потолок входящих реакций в секунду, от всех участников вместе. */
export const REACTIONS_TOTAL_PER_SECOND = 12
export const REACTIONS_ON_SCREEN = 15
/** Сколько эмодзи живёт на экране (совпадает с CSS-анимацией rx-float). */
export const REACTION_LIFETIME_MS = 2600
export const REACTION_EVENT = 'reaction'

// Формат id только отсекает мусор (разметку, длинные строки). Кто это на самом
// деле, решает поиск в списке участников комнаты (nickOf): неизвестные отбрасываются.
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/

export const isReactionEmoji = (v: unknown): v is ReactionEmoji => typeof v === 'string' && (REACTION_EMOJIS as readonly string[]).includes(v)

export function reactionTopic(roomId: string, epoch: number): string {
    return `roomfx:${roomId}:${epoch}`
}

/**
 * Скользящее окно: не больше `max` событий за любую секунду.
 * allow() записывает событие, если оно проходит.
 */
export function createRateGate(max: number, now: () => number, windowMs = 1000) {
    let stamps: number[] = []
    return {
        allow(): boolean {
            const t = now()
            stamps = stamps.filter((s) => t - s < windowMs)
            if (stamps.length >= max) return false
            stamps.push(t)
            return true
        },
        reset(): void {
            stamps = []
        }
    }
}

/** Сообщение канала → id отправителя и эмодзи; всё неожиданное — null. */
export function parseReaction(payload: unknown): { from: string; emoji: ReactionEmoji } | null {
    if (!payload || typeof payload !== 'object') return null
    const p = payload as Record<string, unknown>
    if (typeof p.from !== 'string' || !USER_ID.test(p.from) || !isReactionEmoji(p.emoji)) return null
    return { from: p.from, emoji: p.emoji }
}

export interface ReactionItem {
    id: number
    emoji: ReactionEmoji
    nick: string
    /** Горизонтальное смещение 0…1 внутри слоя. */
    lane: number
}

export interface ReactionHubDeps {
    now(): number
    random(): number
    setTimeout(fn: () => void, ms: number): unknown
    clearTimeout(handle: unknown): void
    /** Ник участника по id; null — такого участника в комнате нет (реакция отбрасывается). */
    nickOf(userId: string): string | null
    /** Показанное изменилось. */
    onChange(items: readonly ReactionItem[]): void
}

/**
 * Что сейчас летит на экране и кого слушать. show() — для входящих и своих
 * реакций; весь отбор (частота, потолок, участник) — здесь.
 */
export function createReactionHub(deps: ReactionHubDeps) {
    let items: ReactionItem[] = []
    let nextId = 1
    const timers = new Map<number, unknown>()
    const perSender = new Map<string, ReturnType<typeof createRateGate>>()
    const total = createRateGate(REACTIONS_TOTAL_PER_SECOND, deps.now)

    const gateOf = (userId: string) => {
        let gate = perSender.get(userId)
        if (!gate) {
            gate = createRateGate(REACTIONS_PER_SECOND, deps.now)
            perSender.set(userId, gate)
        }
        return gate
    }

    function remove(id: number): void {
        const timer = timers.get(id)
        if (timer !== undefined) deps.clearTimeout(timer)
        timers.delete(id)
        if (!items.some((i) => i.id === id)) return
        items = items.filter((i) => i.id !== id)
        deps.onChange(items)
    }

    return {
        /** Показать реакцию участника. true — показана, false — молча отброшена. */
        show(userId: string, emoji: ReactionEmoji): boolean {
            const nick = deps.nickOf(userId)
            if (nick === null) return false
            if (items.length >= REACTIONS_ON_SCREEN) return false
            if (!gateOf(userId).allow() || !total.allow()) return false
            const item: ReactionItem = { id: nextId++, emoji, nick, lane: Math.min(1, Math.max(0, deps.random())) }
            items = [...items, item]
            timers.set(item.id, deps.setTimeout(() => remove(item.id), REACTION_LIFETIME_MS))
            deps.onChange(items)
            return true
        },
        remove,
        get items(): readonly ReactionItem[] {
            return items
        },
        /** Вышли из комнаты или сменили её: всё убрать. */
        clear(): void {
            for (const timer of timers.values()) deps.clearTimeout(timer)
            timers.clear()
            perSender.clear()
            total.reset()
            if (items.length) {
                items = []
                deps.onChange(items)
            }
        },
        /** Участник ушёл: его счётчик частоты больше не нужен. */
        forget(userId: string): void {
            perSender.delete(userId)
        }
    }
}
