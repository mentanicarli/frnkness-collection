import { describe, it, expect } from 'vitest'
import {
    CLOCK_BEST,
    DRIFT_THRESHOLD_MS,
    HOST_GRACE_MS,
    HOST_STALE_MS,
    QUEUE_AFTER,
    QUEUE_BEFORE,
    SEEK_MIN_GAP_MS,
    AUTO_LEAD_MS,
    RATE_DEADBAND_MS,
    START_LEAD_MS,
    compactQueue,
    decideDrift,
    decideSeek,
    isNewerCommand,
    msUntilStart,
    parseBeacon,
    planStart,
    resumeSeq,
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

    it('расхождение до порога не перематываем, больше — перематываем', () => {
        expect(decideSeek(50_000, 50_000 + DRIFT_THRESHOLD_MS, ctx())).toEqual({ seek: false, toMs: 50_000 + DRIFT_THRESHOLD_MS })
        expect(decideSeek(50_000, 50_000 - 600, ctx()).seek).toBe(false)
        expect(decideSeek(50_000, 50_000 + DRIFT_THRESHOLD_MS + 1, ctx())).toEqual({ seek: true, toMs: 50_000 + DRIFT_THRESHOLD_MS + 1 })
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

describe('расписание старта', () => {
    it('нажатие хозяина: старт через ~1,2 с, позиция сохраняется', () => {
        expect(planStart(10_000, 42_500.4)).toEqual({ startAt: 10_000 + START_LEAD_MS, posMs: 42_500 })
        expect(START_LEAD_MS).toBeGreaterThanOrEqual(1000)
        expect(START_LEAD_MS).toBeLessThanOrEqual(1500)
    })

    it('медленная сеть хозяина увеличивает запас, но не больше 1,5 с', () => {
        expect(planStart(0, 0, { rttMs: 100 }).startAt).toBe(START_LEAD_MS)
        expect(planStart(0, 0, { rttMs: 600 }).startAt).toBe(1400)
        expect(planStart(0, 0, { rttMs: 5000 }).startAt).toBe(1500)
    })

    it('трек сменился сам — короткий запас: следующий у гостей уже загружен', () => {
        expect(planStart(5000, 0, { gapless: true, rttMs: 900 })).toEqual({ startAt: 5000 + AUTO_LEAD_MS, posMs: 0 })
    })

    it('сколько ждать до старта: с поправкой на запуск звука, отрицательное — время пришло', () => {
        expect(msUntilStart(11_200, 10_000)).toBe(1200)
        expect(msUntilStart(11_200, 10_000, 80)).toBe(1120)
        expect(msUntilStart(11_200, 11_300, 0)).toBe(-100)
    })

    it('до назначенного старта позиция стоит на месте, после — идёт', () => {
        const t = { posMs: 30_000, atMs: 11_200, playing: true }
        expect(expectedPositionMs(t, 10_000)).toBe(30_000)
        expect(expectedPositionMs(t, 11_200)).toBe(30_000)
        expect(expectedPositionMs(t, 12_200)).toBe(31_000)
    })
})

describe('порядок команд', () => {
    it('новее — больший номер команды, а внутри команды — больший маячок', () => {
        expect(isNewerCommand({ seq: 5, beat: 0 }, { seq: 4, beat: 99 })).toBe(true)
        expect(isNewerCommand({ seq: 5, beat: 2 }, { seq: 5, beat: 1 })).toBe(true)
        expect(isNewerCommand({ seq: 5, beat: 1 }, { seq: 5, beat: 1 })).toBe(false)
        expect(isNewerCommand({ seq: 4, beat: 100 }, { seq: 5, beat: 0 })).toBe(false)
        expect(isNewerCommand({ seq: 1, beat: 0 }, { seq: 0, beat: -1 })).toBe(true)
    })

    it('после перезагрузки хозяин продолжает с сохранённого в базе, а не с нуля', () => {
        expect(resumeSeq(12, { cseq: 40 })).toBe(40)
        expect(resumeSeq(12, { cseq: 3 })).toBe(12)
        expect(resumeSeq(12, null)).toBe(12)
        expect(resumeSeq(0, {})).toBe(0)
        expect(resumeSeq(NaN, { cseq: 7 })).toBe(7)
    })

    it('состояние и маячок из сети проверяются', () => {
        const q = createListQueue({ kind: 'release', releaseId: 'album-one' }, ids(3), 1, always)!
        const st = snapshotState(q, 12_345.6, true, { atMs: 99_000.2, cseq: 7 })
        expect(st).toMatchObject({ pos_ms: 12_346, playing: true, at_ms: 99_000, cseq: 7, track_id: 'album-one/track-1' })
        expect(parseRoomState(JSON.parse(JSON.stringify(st)))).toEqual(st)
        // Без новых полей (старая версия сайта) состояние тоже годное.
        expect(parseRoomState({ ...st, at_ms: undefined, cseq: undefined })).not.toBeNull()
        expect(parseRoomState({ ...st, cseq: -1 })).toBeNull()
        expect(parseRoomState({ ...st, cseq: 1.5 })).toBeNull()
        expect(parseRoomState({ ...st, at_ms: 'скоро' })).toBeNull()

        const beacon = { seq: 7, beat: 3, sent: 1, at: 2, track_id: 'album-one/track-1', pos_ms: 5, playing: false }
        expect(parseBeacon(beacon)).toMatchObject(beacon)
        for (const bad of [null, {}, { ...beacon, seq: -1 }, { ...beacon, beat: 0.5 }, { ...beacon, track_id: '../x' }, { ...beacon, pos_ms: 9e9 }, { ...beacon, playing: 'да' }, { ...beacon, at: NaN }]) {
            expect(parseBeacon(bad)).toBeNull()
        }
    })
})

describe('подстройка скоростью', () => {
    const ctx = (over: Partial<{ now: number; lastSeekAt: number | null; currentRate: number; force: boolean }> = {}) => ({ now: 100_000, lastSeekAt: null, currentRate: 1, ...over })

    it('в мёртвой зоне скорость обычная', () => {
        for (const diff of [0, 10, -30, RATE_DEADBAND_MS - 1]) expect(decideDrift(diff, 50_000, ctx())).toEqual({ action: 'none', rate: 1, toMs: 50_000 })
    })

    it('впереди — замедляемся, позади — ускоряемся; сильнее при большом расхождении', () => {
        expect(decideDrift(100, 0, ctx()).rate).toBeCloseTo(0.98)
        expect(decideDrift(-100, 0, ctx()).rate).toBeCloseTo(1.02)
        expect(decideDrift(400, 0, ctx()).rate).toBeCloseTo(0.96)
        expect(decideDrift(-900, 0, ctx()).rate).toBeCloseTo(1.04)
        expect(decideDrift(900, 0, ctx())).toMatchObject({ action: 'rate' })
    })

    it('скорость не выходит за ±5 %', () => {
        for (const diff of [41, 150, 151, 600, 1199, -1199, 1200, -1200]) {
            const r = decideDrift(diff, 0, ctx()).rate
            expect(r).toBeGreaterThanOrEqual(0.95)
            expect(r).toBeLessThanOrEqual(1.05)
        }
    })

    it('уже идущая подстройка отпускается позже входа в зону (гистерезис)', () => {
        expect(decideDrift(30, 0, ctx({ currentRate: 0.96 })).rate).toBeCloseTo(0.98)
        expect(decideDrift(20, 0, ctx({ currentRate: 0.96 }))).toEqual({ action: 'rate', rate: 1, toMs: 0 })
        // Та же скорость повторно не назначается.
        expect(decideDrift(400, 0, ctx({ currentRate: 0.96 })).action).toBe('none')
    })

    it('перемотка — только при расхождении больше порога и не чаще раза в 2 с', () => {
        expect(decideDrift(DRIFT_THRESHOLD_MS, 50_000, ctx()).action).toBe('rate')
        expect(decideDrift(DRIFT_THRESHOLD_MS + 1, 50_000, ctx())).toEqual({ action: 'seek', rate: 1, toMs: 50_000 })
        expect(decideDrift(-5000, 50_000, ctx({ currentRate: 1.04 }))).toEqual({ action: 'seek', rate: 1, toMs: 50_000 })
        // Только что перематывали — пока подстраиваем скоростью.
        expect(decideDrift(5000, 0, ctx({ lastSeekAt: 99_000 })).action).toBe('rate')
        // Первая выверка строже и без ограничения частоты.
        expect(decideDrift(400, 0, ctx({ force: true, lastSeekAt: 99_999 })).action).toBe('seek')
        expect(decideDrift(200, 0, ctx({ force: true })).action).toBe('rate')
    })

    it('сходимость: с расхождением 0,3 с и скоростью ±4 % за ≤ 12 с мы в мёртвой зоне, без перемоток', () => {
        let diff = 300
        let rate = 1
        let seconds = 0
        while (seconds < 30) {
            const d = decideDrift(diff, 0, ctx({ currentRate: rate, now: 100_000 + seconds * 1000 }))
            expect(d.action).not.toBe('seek')
            rate = d.rate
            diff += (rate - 1) * 1000
            seconds++
            if (Math.abs(diff) < RATE_DEADBAND_MS && rate === 1) break
        }
        expect(seconds).toBeLessThanOrEqual(12)
        expect(Math.abs(diff)).toBeLessThan(RATE_DEADBAND_MS)
    })
})
