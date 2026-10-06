// Очередь плеера: списки (релиз, плейлист, избранное) и бесконечные
// (Поток, Поток по избранному), перемешивание, недоступные треки.
import { describe, it, expect } from 'vitest'
import {
    type Queue,
    ENDLESS_HISTORY,
    createEndlessQueue,
    createListQueue,
    currentTrackId,
    jumpTo,
    nextInQueue,
    prevInQueue,
    sameSource,
    setQueueShuffle,
    shuffledOrder
} from '../player/queue'

const IDS = ['r/a', 'r/b', 'r/c', 'r/d', 'r/e']
const all = () => true
const without = (...gone: string[]) => (id: string) => !gone.includes(id)

/** Детерминированный генератор (LCG) — повторяемое «случайное». */
function seeded(seed = 1) {
    let s = seed
    return () => {
        s = (s * 1103515245 + 12345) % 2 ** 31
        return s / 2 ** 31
    }
}

function walk(q: Queue, steps: number, step: (q: Queue) => Queue | null): string[] {
    const out = [currentTrackId(q)!]
    for (let i = 0; i < steps; i++) {
        q = step(q)!
        out.push(currentTrackId(q)!)
    }
    return out
}

describe('shuffledOrder', () => {
    it('перестановка всех индексов, заданный — первым', () => {
        for (let seed = 1; seed < 20; seed++) {
            const order = shuffledOrder(7, 3, seeded(seed))
            expect(order[0]).toBe(3)
            expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5, 6])
        }
    })

    it('порядок действительно меняется', () => {
        const orders = new Set(Array.from({ length: 10 }, (_, s) => shuffledOrder(6, null, seeded(s + 1)).join()))
        expect(orders.size).toBeGreaterThan(1)
    })
})

describe('очередь-список (релиз, плейлист, избранное)', () => {
    const sources = [
        { kind: 'release', releaseId: 'r' },
        { kind: 'playlist', playlistId: 'p1', title: 'Мой' },
        { kind: 'favorites', ownerId: 'u1' }
    ] as const

    it.each(sources)('по порядку и по кругу: %o', (source) => {
        const q = createListQueue(source, IDS, 3, all)!
        expect(q.source).toEqual(source)
        expect(walk(q, 3, (x) => nextInQueue(x, all))).toEqual(['r/d', 'r/e', 'r/a', 'r/b'])
        expect(walk(q, 4, (x) => prevInQueue(x, all))).toEqual(['r/d', 'r/c', 'r/b', 'r/a', 'r/e'])
    })

    it('недоступные треки пропускаются — и на старте, и в пути', () => {
        const ok = without('r/b', 'r/c')
        const q = createListQueue({ kind: 'favorites', ownerId: 'u' }, IDS, 1, ok)!
        expect(currentTrackId(q)).toBe('r/d')
        expect(walk(q, 3, (x) => nextInQueue(x, ok))).toEqual(['r/d', 'r/e', 'r/a', 'r/d'])
        expect(currentTrackId(prevInQueue(createListQueue({ kind: 'release', releaseId: 'r' }, IDS, 3, ok)!, ok))).toBe('r/a')
    })

    it('все недоступны — очереди нет; пустой список — тоже', () => {
        expect(createListQueue({ kind: 'release', releaseId: 'r' }, IDS, 0, () => false)).toBeNull()
        expect(createListQueue({ kind: 'release', releaseId: 'r' }, [], 0, all)).toBeNull()
    })

    it('перемешанный: текущий первым, каждый трек ровно один раз за круг', () => {
        const q = createListQueue({ kind: 'playlist', playlistId: 'p', title: 'x' }, IDS, 2, all, { shuffle: true, rng: seeded(7) })!
        expect(currentTrackId(q)).toBe('r/c')
        const lap = walk(q, 4, (x) => nextInQueue(x, all))
        expect([...lap].sort()).toEqual([...IDS].sort())
        // Следующий круг — тот же порядок.
        expect(walk(q, 9, (x) => nextInQueue(x, all)).slice(5)).toEqual(lap)
    })

    it('включить и выключить перемешивание посреди списка — с того же трека', () => {
        let q = createListQueue({ kind: 'release', releaseId: 'r' }, IDS, 1, all)!
        q = nextInQueue(q, all)! // r/c
        const shuffled = setQueueShuffle(q, true, seeded(3))
        expect(shuffled.shuffle).toBe(true)
        expect(currentTrackId(shuffled)).toBe('r/c')
        expect(shuffled.order[0]).toBe(2)
        const back = setQueueShuffle(nextInQueue(shuffled, all)!, false)
        expect(back.order).toEqual([0, 1, 2, 3, 4])
        expect(currentTrackId(back)).toBe(currentTrackId(nextInQueue(shuffled, all)))
        expect(setQueueShuffle(back, false)).toBe(back)
    })

    it('переход к треку списка', () => {
        const q = createListQueue({ kind: 'release', releaseId: 'r' }, IDS, 0, all, { shuffle: true, rng: seeded(2) })!
        expect(currentTrackId(jumpTo(q, 4))).toBe('r/e')
        expect(jumpTo(q, 99)).toBeNull()
    })
})

describe('бесконечная очередь (Поток, Поток по избранному)', () => {
    it.each([{ kind: 'flow' }, { kind: 'favorites-flow', ownerId: 'u1' }] as const)('случайно, без повтора текущего подряд: %o', (source) => {
        const q = createEndlessQueue(source, IDS, all, { rng: seeded(5) })!
        expect(q.endless).toBe(true)
        const played = walk(q, 40, (x) => nextInQueue(x, all, seeded(x.order.length + 11)))
        for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1])
        expect(new Set(played).size).toBeGreaterThan(2)
    })

    it('начинает с заданного трека, если он в пуле и доступен', () => {
        expect(currentTrackId(createEndlessQueue({ kind: 'flow' }, IDS, all, { startTrackId: 'r/d' }))).toBe('r/d')
        expect(currentTrackId(createEndlessQueue({ kind: 'flow' }, IDS, without('r/d'), { startTrackId: 'r/d', rng: seeded(1) }))).not.toBe('r/d')
    })

    it('«назад» — по сыгранным, потом «вперёд» — те же треки, затем новые', () => {
        let q = createEndlessQueue({ kind: 'flow' }, IDS, all, { rng: seeded(9) })!
        const played = walk(q, 3, (x) => nextInQueue(x, all, seeded(x.order.length)))
        for (let i = 0; i < 3; i++) q = nextInQueue(q, all, seeded(q.order.length))!
        q = prevInQueue(prevInQueue(q, all)!, all)!
        expect(currentTrackId(q)).toBe(played[1])
        q = nextInQueue(q, all)!
        expect(currentTrackId(q)).toBe(played[2])
        // В самом начале «назад» некуда.
        expect(prevInQueue(createEndlessQueue({ kind: 'flow' }, IDS, all)!, all)).toBeNull()
    })

    it('недоступные не выбираются; один доступный — повторяется', () => {
        const ok = (id: string) => id === 'r/b'
        const q = createEndlessQueue({ kind: 'favorites-flow', ownerId: 'u' }, IDS, ok)!
        expect(walk(q, 3, (x) => nextInQueue(x, ok))).toEqual(['r/b', 'r/b', 'r/b', 'r/b'])
        expect(createEndlessQueue({ kind: 'flow' }, IDS, () => false)).toBeNull()
        expect(createEndlessQueue({ kind: 'favorites-flow', ownerId: 'u' }, [], all)).toBeNull()
    })

    it('история ограничена, дубли в пуле схлопываются', () => {
        let q = createEndlessQueue({ kind: 'flow' }, [...IDS, 'r/a', 'r/a'], all)!
        expect(q.trackIds).toHaveLength(5)
        for (let i = 0; i < ENDLESS_HISTORY + 20; i++) q = nextInQueue(q, all)!
        expect(q.order.length).toBe(ENDLESS_HISTORY)
        expect(q.pos).toBe(ENDLESS_HISTORY - 1)
    })

    it('перемешивание бесконечную очередь не меняет; переход к треку добавляет его в историю', () => {
        const q = createEndlessQueue({ kind: 'flow' }, IDS, all, { startTrackId: 'r/a' })!
        expect(setQueueShuffle(q, false)).toBe(q)
        const j = jumpTo(q, 3)!
        expect(currentTrackId(j)).toBe('r/d')
        expect(currentTrackId(prevInQueue(j, all))).toBe('r/a')
    })
})

describe('sameSource', () => {
    it('сравнивает по виду и id источника', () => {
        expect(sameSource({ kind: 'release', releaseId: 'a' }, { kind: 'release', releaseId: 'a' })).toBe(true)
        expect(sameSource({ kind: 'release', releaseId: 'a' }, { kind: 'release', releaseId: 'b' })).toBe(false)
        expect(sameSource({ kind: 'playlist', playlistId: 'p', title: 'x' }, { kind: 'playlist', playlistId: 'p', title: 'y' })).toBe(true)
        expect(sameSource({ kind: 'favorites', ownerId: 'u' }, { kind: 'favorites-flow', ownerId: 'u' })).toBe(false)
        expect(sameSource({ kind: 'flow' }, { kind: 'flow' })).toBe(true)
        expect(sameSource(null, { kind: 'flow' })).toBe(false)
    })
})
