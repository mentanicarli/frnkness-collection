import { describe, it, expect } from 'vitest'
import {
    CLOCK_BEST,
    DRIFT_THRESHOLD_MS,
    HOST_GRACE_MS,
    HOST_STALE_MS,
    QUEUE_AFTER,
    QUEUE_BEFORE,
    SEEK_MIN_GAP_MS,
    compactQueue,
    decideSeek,
    estimateOffset,
    expectedPositionMs,
    hostOnline,
    isRoomId,
    parseRoomState,
    roomTopic,
    serverNowFrom,
    snapshotState,
    stepHostWatch,
    toPlayerQueue,
    upcomingTrackIds
} from '../rooms/sync'
import { type Queue, createEndlessQueue, createListQueue, nextInQueue } from '../player/queue'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `album-one/track-${i}`)
const always = () => true

describe('часы: сдвиг относительно сервера', () => {
    it('симметричная задержка: сдвиг точный', () => {
        // Устройство спешит на 5 с: сервер видит 10_000, устройство — 15_000.
        const sample = { sentAt: 14_900, receivedAt: 15_100, serverMs: 10_000 }
        expect(estimateOffset([sample])).toEqual({ offsetMs: -5000, rttMs: 200 })
    })

    it('берёт самые быстрые пробы, медленная не портит оценку', () => {
        // Реальный сдвиг +1000. Быстрые пробы (40 мс) его видят точно; у медленной
        // (1000 мс) ответ пришёл с перекосом пути — сдвиг показался бы 1450.
        const fast = (sentAt: number) => ({ sentAt, receivedAt: sentAt + 40, serverMs: sentAt + 20 + 1000 })
        const slow = { sentAt: 700, receivedAt: 1700, serverMs: 700 + 900 + 1000 }
        const est = estimateOffset([slow, fast(100), fast(300), fast(500)])!
        expect(est.rttMs).toBe(40)
        expect(est.offsetMs).toBe(1000)
        // Из пяти проб в расчёт идут три лучших: медленные проходят мимо.
        expect(estimateOffset([slow, { ...slow, sentAt: 900, receivedAt: 1900 }, fast(100), fast(300), fast(500)])!.offsetMs).toBe(1000)
    })

    it('медиана лучших проб гасит одиночный выброс', () => {
        const samples = [
            { sentAt: 0, receivedAt: 20, serverMs: 1010 }, // сдвиг 1000
            { sentAt: 100, receivedAt: 122, serverMs: 1111 }, // 1000
            { sentAt: 200, receivedAt: 225, serverMs: 1812.5 } // выброс: 1600
        ]
        expect(CLOCK_BEST).toBe(3)
        expect(estimateOffset(samples)!.offsetMs).toBe(1000)
    })

    it('мусорные пробы отбрасываются; нет годных — null', () => {
        expect(estimateOffset([])).toBeNull()
        expect(estimateOffset([{ sentAt: 10, receivedAt: 5, serverMs: 1 }, { sentAt: NaN, receivedAt: 5, serverMs: 1 }, { sentAt: 1, receivedAt: 2, serverMs: Infinity }])).toBeNull()
        const est = estimateOffset([{ sentAt: 10, receivedAt: 5, serverMs: 1 }, { sentAt: 0, receivedAt: 10, serverMs: 105 }])
        expect(est).toEqual({ offsetMs: 100, rttMs: 10 })
    })

    it('два человека с разными часами сходятся к одному серверному времени', () => {
        const server = 1_000_000
        // У Ани часы отстают на 7 с, у Бори спешат на 3 с; задержка 60 мс в обе стороны.
        const probe = (deviceOffset: number) => {
            const sent = server + deviceOffset
            return { sentAt: sent, receivedAt: sent + 60, serverMs: server + 30 }
        }
        const anya = estimateOffset([probe(-7000)])!
        const boris = estimateOffset([probe(3000)])!
        const t = 5_000_000 // один и тот же момент по серверу
        expect(serverNowFrom(t - 7000, anya.offsetMs)).toBeCloseTo(t - 0, -1)
        expect(serverNowFrom(t + 3000, boris.offsetMs)).toBeCloseTo(t, -1)
    })
})

describe('позиция по состоянию хозяина', () => {
    const target = { posMs: 10_000, atMs: 1_000_000, playing: true }

    it('играет: позиция растёт вместе с серверным временем', () => {
        expect(expectedPositionMs(target, 1_000_000)).toBe(10_000)
        expect(expectedPositionMs(target, 1_003_500)).toBe(13_500)
    })

    it('пауза: позиция стоит', () => {
        expect(expectedPositionMs({ ...target, playing: false }, 1_050_000)).toBe(10_000)
    })

    it('часы назад (опоздавшее состояние) не дают отрицательного времени', () => {
        expect(expectedPositionMs(target, 999_000)).toBe(10_000)
    })

    it('не выходит за конец трека и за начало', () => {
        expect(expectedPositionMs(target, 1_900_000, 200_000)).toBe(200_000)
        expect(expectedPositionMs({ ...target, posMs: -5 }, 1_000_000)).toBe(0)
        expect(expectedPositionMs(target, 1_100_000, NaN)).toBe(110_000)
    })

    it('опоздавший гость попадает в то же место, что и давний', () => {
        const server = 2_000_000
        const early = expectedPositionMs(target, server)
        // Второй гость вошёл позже: его часы по серверу показывают то же server.
        const late = expectedPositionMs(target, serverNowFrom(server - 12_345 + 12_345, 0))
        expect(late).toBe(early)
    })
})

describe('подкрутка гостя', () => {
    const ctx = (over: Partial<{ now: number; lastSeekAt: number | null; force: boolean }> = {}) => ({ now: 100_000, lastSeekAt: null, ...over })

    it('расхождение до секунды не трогаем, больше — перематываем', () => {
        expect(decideSeek(50_000, 50_000 + DRIFT_THRESHOLD_MS, ctx())).toEqual({ seek: false, toMs: 51_000 })
        expect(decideSeek(50_000, 50_000 - 600, ctx()).seek).toBe(false)
        expect(decideSeek(50_000, 51_001, ctx())).toEqual({ seek: true, toMs: 51_001 })
        expect(decideSeek(60_000, 50_000, ctx())).toEqual({ seek: true, toMs: 50_000 })
    })

    it('не перематывает чаще, чем раз в SEEK_MIN_GAP_MS', () => {
        expect(decideSeek(0, 5000, ctx({ lastSeekAt: 100_000 - SEEK_MIN_GAP_MS + 1 })).seek).toBe(false)
        expect(decideSeek(0, 5000, ctx({ lastSeekAt: 100_000 - SEEK_MIN_GAP_MS })).seek).toBe(true)
    })

    it('первая выверка (вход, новый трек, возврат на вкладку) строже и без ограничения частоты', () => {
        expect(decideSeek(50_000, 50_500, ctx({ force: true })).seek).toBe(true)
        expect(decideSeek(50_000, 50_200, ctx({ force: true })).seek).toBe(false)
        expect(decideSeek(0, 5000, ctx({ force: true, lastSeekAt: 99_999 })).seek).toBe(true)
    })
})

describe('хозяин пропал: ожидание перед паузой', () => {
    it('на месте — online; короткий обрыв — grace; долгий — away; возврат — сразу online', () => {
        let w = { absentSince: null as number | null }
        let step = stepHostWatch(w, true, 0)
        expect(step.state).toBe('online')
        step = stepHostWatch(step.watch, false, 1000)
        expect(step.state).toBe('grace')
        step = stepHostWatch(step.watch, false, 1000 + HOST_GRACE_MS - 1)
        expect(step.state).toBe('grace')
        step = stepHostWatch(step.watch, false, 1000 + HOST_GRACE_MS)
        expect(step.state).toBe('away')
        step = stepHostWatch(step.watch, true, 1000 + HOST_GRACE_MS + 5)
        expect(step).toEqual({ watch: { absentSince: null }, state: 'online' })
        // Короткий обрыв не доходит до паузы.
        w = step.watch
        step = stepHostWatch(w, false, 100_000)
        step = stepHostWatch(step.watch, true, 100_000 + 5000)
        step = stepHostWatch(step.watch, false, 100_000 + 6000)
        expect(step.state).toBe('grace')
    })

    it('Presence без вестей от хозяина дольше минуты — не «на месте»', () => {
        expect(hostOnline(true, 1000)).toBe(true)
        expect(hostOnline(true, HOST_STALE_MS)).toBe(false)
        expect(hostOnline(false, 0)).toBe(false)
    })
})

describe('состояние плеера на проводе', () => {
    const SOURCE = { kind: 'release', releaseId: 'album-one' } as const
    const mkQueue = (n: number, start = 0, shuffle = false): Queue => createListQueue(SOURCE, ids(n), start, always, { shuffle, rng: () => 0.3 })!

    it('очередь сжимается до окна вокруг текущего трека', () => {
        const q = mkQueue(500, 200)
        const wire = compactQueue(q)
        expect(wire.trackIds).toHaveLength(QUEUE_BEFORE + QUEUE_AFTER + 1)
        expect(wire.trackIds[wire.order[wire.pos]]).toBe('album-one/track-200')
        expect(wire.trackIds[0]).toBe(`album-one/track-${200 - QUEUE_BEFORE}`)
        // Начало очереди — окно короче назад.
        const start = compactQueue(mkQueue(500, 2))
        expect(start.pos).toBe(2)
        // Короткая очередь едет целиком.
        expect(compactQueue(mkQueue(4, 1)).trackIds).toHaveLength(4)
    })

    it('перемешанная очередь передаётся в порядке игры', () => {
        const q = mkQueue(10, 3, true)
        const wire = compactQueue(q)
        const played = wire.order.map((i) => wire.trackIds[i])
        expect(played).toEqual(q.order.map((i) => q.trackIds[i]))
        expect(wire.shuffle).toBe(true)
    })

    it('бесконечная очередь (Поток) — только сыгранные треки', () => {
        let q = createEndlessQueue({ kind: 'flow' }, ids(30), always, { rng: () => 0.5 })!
        q = nextInQueue(q, always, () => 0.1)!
        const wire = compactQueue(q)
        expect(wire.endless).toBe(true)
        expect(wire.trackIds).toHaveLength(2)
        expect(upcomingTrackIds(wire, 5)).toEqual([])
    })

    it('снимок и разбор возвращают то же самое; очередь гостя — remote', () => {
        const q = mkQueue(6, 2)
        const state = snapshotState(q, 12_345.6, true)
        expect(state).toMatchObject({ track_id: 'album-one/track-2', pos_ms: 12_346, playing: true })
        const parsed = parseRoomState(JSON.parse(JSON.stringify(state)))
        expect(parsed).toEqual(state)
        const guestQueue = toPlayerQueue(parsed!.queue!, 'remote')
        expect(guestQueue.controller).toBe('remote')
        expect(upcomingTrackIds(guestQueue, 2)).toEqual(['album-one/track-3', 'album-one/track-4'])
        // Без очереди — ничего не играет и играть не может.
        expect(snapshotState(null, 5000, true)).toEqual({ queue: null, track_id: null, pos_ms: 5000, playing: false })
        expect(parseRoomState({ queue: null, track_id: null, pos_ms: 0, playing: false })).toEqual({ queue: null, track_id: null, pos_ms: 0, playing: false })
    })

    it('мусор из сети не принимается', () => {
        const good = snapshotState(mkQueue(5, 1), 1000, true)
        const clone = () => JSON.parse(JSON.stringify(good))
        const bad: unknown[] = [
            null,
            'x',
            [],
            {},
            { ...clone(), playing: 'да' },
            { ...clone(), pos_ms: -1 },
            { ...clone(), pos_ms: 'x' },
            { ...clone(), pos_ms: 1e12 },
            { ...clone(), track_id: 'не трек' },
            { ...clone(), track_id: 'album-one/track-3' }, // не совпадает с очередью
            { ...clone(), queue: { ...clone().queue, trackIds: [] } },
            { ...clone(), queue: { ...clone().queue, trackIds: ['<img src=x onerror=alert(1)>'] } },
            { ...clone(), queue: { ...clone().queue, order: [0, 99] } },
            { ...clone(), queue: { ...clone().queue, pos: 99 } },
            { ...clone(), queue: { ...clone().queue, source: { kind: 'hack' } } },
            { ...clone(), queue: { ...clone().queue, source: { kind: 'release', releaseId: '../x' } } },
            { ...clone(), queue: { ...clone().queue, source: { kind: 'playlist', playlistId: 'не uuid', title: 'x' } } },
            { ...clone(), queue: { ...clone().queue, shuffle: 'нет' } },
            { ...clone(), queue: { ...clone().queue, trackIds: ids(101), order: [0], pos: 0 } },
            { queue: null, track_id: 'album-one/track-1', pos_ms: 0, playing: false }
        ]
        for (const b of bad) expect(parseRoomState(b), JSON.stringify(b)).toBeNull()
    })

    it('название плейлиста в источнике обрезается', () => {
        const state = {
            queue: { source: { kind: 'playlist', playlistId: '12345678-1234-4123-8123-123456789abc', title: '<b>' + 'я'.repeat(500) }, trackIds: ['a/b'], order: [0], pos: 0, shuffle: false, endless: false },
            track_id: 'a/b',
            pos_ms: 0,
            playing: false
        }
        const parsed = parseRoomState(state)!
        expect((parsed.queue!.source as { title: string }).title.length).toBe(120)
    })

    it('топик канала и id комнаты', () => {
        const id = '12345678-1234-4123-8123-123456789abc'
        expect(roomTopic(id, 3)).toBe(`room:${id}:3`)
        expect(isRoomId(id)).toBe(true)
        expect(isRoomId('12345678-1234-4123-8123-123456789ABC')).toBe(false)
        expect(isRoomId('new')).toBe(false)
        expect(isRoomId(undefined)).toBe(false)
    })
})
