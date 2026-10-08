import { describe, expect, it } from 'vitest'
import {
    REACTION_EMOJIS,
    REACTION_LIFETIME_MS,
    REACTIONS_ON_SCREEN,
    createRateGate,
    createReactionHub,
    isReactionEmoji,
    parseReaction,
    reactionTopic,
    type ReactionItem
} from '../rooms/reactions'

const U1 = '00000000-0000-4000-8000-000000000001'
const U2 = '00000000-0000-4000-8000-000000000002'

function hub(nicks: Record<string, string> = { [U1]: 'Яна', [U2]: 'Второй' }) {
    let t = 0
    let timers: { at: number; fn: () => void; id: number }[] = []
    let n = 0
    const changes: ReactionItem[][] = []
    const h = createReactionHub({
        now: () => t,
        random: () => 0.5,
        setTimeout: (fn, ms) => {
            const id = ++n
            timers.push({ at: t + ms, fn, id })
            return id
        },
        clearTimeout: (id) => {
            timers = timers.filter((x) => x.id !== id)
        },
        nickOf: (id) => nicks[id] ?? null,
        onChange: (items) => changes.push([...items])
    })
    const advance = (ms: number) => {
        t += ms
        for (const timer of timers.filter((x) => x.at <= t)) timer.fn()
        timers = timers.filter((x) => x.at > t)
    }
    return { h, advance, changes, nicks }
}

describe('реакции: набор и разбор сообщений', () => {
    it('в наборе ровно восемь эмодзи из задания', () => {
        expect([...REACTION_EMOJIS]).toEqual(['🔥', '❤️', '😭', '😂', '👏', '🤯', '🫶', '💀'])
        expect(reactionTopic('abc', 3)).toBe('roomfx:abc:3')
    })

    it('принимается только эмодзи из набора и настоящий id отправителя', () => {
        expect(parseReaction({ from: U1, emoji: '🔥' })).toEqual({ from: U1, emoji: '🔥' })
        for (const bad of [null, undefined, 'x', 1, [], {}, { from: U1 }, { emoji: '🔥' }, { from: '<b>x</b>', emoji: '🔥' }, { from: 'a'.repeat(65), emoji: '🔥' }, { from: '', emoji: '🔥' }, { from: 7, emoji: '🔥' }, { from: U1, emoji: '🍕' }, { from: U1, emoji: '🔥🔥' }, { from: U1, emoji: '<b>🔥</b>' }, { from: U1, emoji: 5 }]) {
            expect(parseReaction(bad), JSON.stringify(bad)).toBeNull()
        }
        expect(isReactionEmoji('🔥')).toBe(true)
        expect(isReactionEmoji('🍕')).toBe(false)
    })
})

describe('реакции: ограничение частоты', () => {
    it('не больше N за скользящую секунду', () => {
        let t = 0
        const gate = createRateGate(2, () => t)
        expect([gate.allow(), gate.allow(), gate.allow()]).toEqual([true, true, false])
        t = 999
        expect(gate.allow()).toBe(false)
        // Секунда прошла: старые нажатия вышли из окна.
        t = 1000
        expect([gate.allow(), gate.allow(), gate.allow()]).toEqual([true, true, false])
        t = 1999
        expect(gate.allow()).toBe(false)
        t = 2000
        expect(gate.allow()).toBe(true)
        gate.reset()
        expect(gate.allow()).toBe(true)
    })
})

describe('реакции: что летит на экране', () => {
    it('показывает эмодзи с ником из списка участников и убирает через время жизни', () => {
        const { h, advance } = hub()
        expect(h.show(U1, '🔥')).toBe(true)
        expect(h.items.map((i) => `${i.emoji} ${i.nick}`)).toEqual(['🔥 Яна'])
        advance(REACTION_LIFETIME_MS - 1)
        expect(h.items).toHaveLength(1)
        advance(1)
        expect(h.items).toHaveLength(0)
    })

    it('неизвестного участника молча отбрасывает', () => {
        const { h } = hub()
        expect(h.show('00000000-0000-4000-8000-0000000000ff', '🔥')).toBe(false)
        expect(h.items).toEqual([])
    })

    it('2 в секунду на человека; другой человек не страдает', () => {
        const { h, advance } = hub()
        expect([h.show(U1, '🔥'), h.show(U1, '❤️'), h.show(U1, '😭')]).toEqual([true, true, false])
        expect(h.show(U2, '😂')).toBe(true)
        expect(h.items).toHaveLength(3)
        advance(1000)
        expect(h.show(U1, '👏')).toBe(true)
    })

    it('общий потолок входящих режет подделанных «отправителей»', () => {
        const ids = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
        const { h } = hub(Object.fromEntries(ids.map((id) => [id, id.slice(-2)])))
        let accepted = 0
        for (const id of ids) if (h.show(id, '🔥')) accepted++
        // Не больше общего потолка в секунду и не больше экрана.
        expect(accepted).toBeLessThanOrEqual(12)
        expect(h.items.length).toBeLessThanOrEqual(REACTIONS_ON_SCREEN)
    })

    it('на экране не больше 15 одновременно, остальные отбрасываются', () => {
        const ids = Array.from({ length: 24 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
        const { h, advance } = hub(Object.fromEntries(ids.map((id) => [id, 'x'])))
        // По 6 в секунду от разных людей (общий потолок 12/с и частота на человека не мешают):
        // за 2,6 секунды эмодзи ещё не успевают улететь, и экран упирается в 15.
        const accepted: number[] = []
        for (let batch = 0; batch < 3; batch++) {
            accepted.push(ids.slice(batch * 6, batch * 6 + 6).filter((id) => h.show(id, '🔥')).length)
            advance(batch < 2 ? 1000 : 0)
        }
        expect(accepted).toEqual([6, 6, 3])
        expect(h.items).toHaveLength(REACTIONS_ON_SCREEN)
        // Дальше новые отбрасываются, пока что-то не улетит.
        expect(h.show(ids[20], '🔥')).toBe(false)
        advance(700) // первая шестёрка (показана в 0 мс) улетела на отметке 2600
        expect(h.items).toHaveLength(REACTIONS_ON_SCREEN - 6)
        expect(h.show(ids[20], '🔥')).toBe(true)
    })

    it('clear() убирает всё и сбрасывает счётчики', () => {
        const { h } = hub()
        h.show(U1, '🔥')
        h.show(U1, '❤️')
        h.clear()
        expect(h.items).toEqual([])
        expect(h.show(U1, '😭')).toBe(true)
    })
})
