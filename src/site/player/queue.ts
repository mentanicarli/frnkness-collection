/**
 * Очередь плеера: что играет и что будет дальше — для любого источника.
 * Чистые функции без Vue и <audio>: движок (engine.ts) хранит очередь в
 * player.queue и заменяет её целиком при каждом шаге.
 *
 * Треки — только по постоянному id. Трек, которого нет в каталоге
 * («недоступен»), очередь пропускает.
 *
 * Два вида очереди:
 *   список (релиз, плейлист, избранное) — по кругу, по порядку или
 *     перемешанный (перестановка, текущий трек — первым);
 *   бесконечная (Поток, Поток по избранному) — каждый следующий трек
 *     случайный, не повторяет текущий; «назад» — по уже сыгранным.
 *
 * Этап 4 (комнаты): очередь с controller 'remote' ведёт хозяин комнаты —
 * гость получает её целиком (replace), его next/prev/shuffle ничего не делают.
 */

export type QueueSource =
    | { kind: 'release'; releaseId: string }
    | { kind: 'playlist'; playlistId: string; title: string }
    | { kind: 'favorites'; ownerId: string }
    | { kind: 'flow' }
    | { kind: 'favorites-flow'; ownerId: string }

export interface Queue {
    source: QueueSource
    /** Список — треки в исходном порядке; бесконечная — из чего выбирать. */
    trackIds: readonly string[]
    /** Порядок игры: индексы в trackIds. В бесконечной — уже сыгранные. */
    order: readonly number[]
    /** Текущая позиция в order. */
    pos: number
    shuffle: boolean
    endless: boolean
    controller: 'local' | 'remote'
}

export type Rng = () => number
export type IsAvailable = (trackId: string) => boolean

/** Сколько сыгранных треков бесконечная очередь помнит для «назад». */
export const ENDLESS_HISTORY = 100

/** Перестановка 0..n-1 (Фишер — Йейтс); first, если задан, — первым. */
export function shuffledOrder(n: number, first: number | null, rng: Rng): number[] {
    const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== first)
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        ;[rest[i], rest[j]] = [rest[j], rest[i]]
    }
    return first !== null && first >= 0 && first < n ? [first, ...rest] : rest
}

const identity = (n: number) => Array.from({ length: n }, (_, i) => i)

export function sameSource(a: QueueSource | null | undefined, b: QueueSource | null | undefined): boolean {
    if (!a || !b || a.kind !== b.kind) return false
    switch (a.kind) {
        case 'release':
            return a.releaseId === (b as typeof a).releaseId
        case 'playlist':
            return a.playlistId === (b as typeof a).playlistId
        case 'favorites':
        case 'favorites-flow':
            return a.ownerId === (b as typeof a).ownerId
        case 'flow':
            return true
    }
}

/**
 * Очередь-список с трека startIndex (индекс в trackIds). Если он
 * недоступен — с ближайшего доступного дальше; нет ни одного — null.
 */
export function createListQueue(
    source: QueueSource,
    trackIds: readonly string[],
    startIndex: number,
    isAvailable: IsAvailable,
    options: { shuffle?: boolean; rng?: Rng } = {}
): Queue | null {
    const n = trackIds.length
    if (!n) return null
    let start = Number.isInteger(startIndex) && startIndex >= 0 && startIndex < n ? startIndex : 0
    for (let step = 0; step < n && !isAvailable(trackIds[start]); step++) start = (start + 1) % n
    if (!isAvailable(trackIds[start])) return null
    const shuffle = Boolean(options.shuffle)
    const order = shuffle ? shuffledOrder(n, start, options.rng ?? Math.random) : identity(n)
    return { source, trackIds: [...trackIds], order, pos: order.indexOf(start), shuffle, endless: false, controller: 'local' }
}

/** Случайный доступный трек пула, кроме exclude (если есть другие). */
function pickRandom(pool: readonly string[], exclude: number | null, isAvailable: IsAvailable, rng: Rng): number | null {
    const candidates = pool.map((_, i) => i).filter((i) => isAvailable(pool[i]))
    if (!candidates.length) return null
    const others = candidates.filter((i) => i !== exclude)
    const from = others.length ? others : candidates
    return from[Math.floor(rng() * from.length)]
}

/**
 * Бесконечная очередь по пулу. startTrackId — с какого трека начать
 * (например, тот, что уже играет); иначе — случайный. Пустой пул — null.
 */
export function createEndlessQueue(
    source: QueueSource,
    pool: readonly string[],
    isAvailable: IsAvailable,
    options: { startTrackId?: string | null; rng?: Rng } = {}
): Queue | null {
    const ids = [...new Set(pool)]
    let start = options.startTrackId ? ids.indexOf(options.startTrackId) : -1
    if (start < 0 || !isAvailable(ids[start])) {
        const picked = pickRandom(ids, null, isAvailable, options.rng ?? Math.random)
        if (picked === null) return null
        start = picked
    }
    return { source, trackIds: ids, order: [start], pos: 0, shuffle: true, endless: true, controller: 'local' }
}

export function currentTrackId(queue: Queue | null): string | null {
    if (!queue) return null
    const index = queue.order[queue.pos]
    return index === undefined ? null : queue.trackIds[index] ?? null
}

/** Следующий трек; null — дальше играть нечего (все треки недоступны). */
export function nextInQueue(queue: Queue, isAvailable: IsAvailable, rng: Rng = Math.random): Queue | null {
    if (queue.endless) {
        // После «назад» — вперёд по уже сыгранным.
        for (let p = queue.pos + 1; p < queue.order.length; p++) {
            if (isAvailable(queue.trackIds[queue.order[p]])) return { ...queue, pos: p }
        }
        const picked = pickRandom(queue.trackIds, queue.order[queue.pos] ?? null, isAvailable, rng)
        if (picked === null) return null
        const order = [...queue.order, picked].slice(-ENDLESS_HISTORY)
        return { ...queue, order, pos: order.length - 1 }
    }
    const n = queue.order.length
    for (let step = 1; step <= n; step++) {
        const p = (queue.pos + step) % n
        if (isAvailable(queue.trackIds[queue.order[p]])) return { ...queue, pos: p }
    }
    return null
}

/** Предыдущий трек; null — некуда (бесконечная очередь в самом начале). */
export function prevInQueue(queue: Queue, isAvailable: IsAvailable): Queue | null {
    if (queue.endless) {
        for (let p = queue.pos - 1; p >= 0; p--) {
            if (isAvailable(queue.trackIds[queue.order[p]])) return { ...queue, pos: p }
        }
        return null
    }
    const n = queue.order.length
    for (let step = 1; step <= n; step++) {
        const p = (queue.pos - step + n) % n
        if (isAvailable(queue.trackIds[queue.order[p]])) return { ...queue, pos: p }
    }
    return null
}

/**
 * Перемешивание списка. Включить — текущий трек остаётся, остальные
 * в случайном порядке после него; выключить — исходный порядок с того же
 * трека. Бесконечную очередь не меняет.
 */
export function setQueueShuffle(queue: Queue, shuffle: boolean, rng: Rng = Math.random): Queue {
    if (queue.endless || queue.shuffle === shuffle) return queue
    const current = queue.order[queue.pos] ?? 0
    const order = shuffle ? shuffledOrder(queue.trackIds.length, current, rng) : identity(queue.trackIds.length)
    return { ...queue, order, pos: order.indexOf(current), shuffle }
}

/** Перейти к треку trackIds[index] той же очереди (клик по строке списка). */
export function jumpTo(queue: Queue, index: number): Queue | null {
    const p = queue.order.indexOf(index)
    if (p >= 0) return { ...queue, pos: p }
    if (!queue.endless || index < 0 || index >= queue.trackIds.length) return null
    const order = [...queue.order.slice(0, queue.pos + 1), index].slice(-ENDLESS_HISTORY)
    return { ...queue, order, pos: order.length - 1 }
}
