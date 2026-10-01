import { describe, it, expect } from 'vitest'
import type { Releases } from '@/types'
import {
    addDays,
    diffDays,
    eachDay,
    formatMediumDate,
    formatRuDate,
    formatShortDate,
    isValidIsoDate,
    moscowDateOf,
    moscowToday,
    parseRuDate
} from '../dates'
import { aggregatePlays, fillDays, releaseDailySeries, releaseTrackPlays, releaseWindow, resolvePeriod } from '../stats'
import releasesJson from '@/content/releases.json'

const releases = releasesJson as unknown as Releases

describe('даты', () => {
    it('сегодня по Москве', () => {
        expect(moscowToday(new Date('2026-09-30T20:59:59Z'))).toBe('2026-09-30')
        expect(moscowToday(new Date('2026-09-30T21:00:00Z'))).toBe('2026-10-01')
        expect(moscowDateOf('2026-10-01T22:30:00+00:00')).toBe('2026-10-02')
    })

    it('арифметика дней', () => {
        expect(addDays('2026-02-27', 2)).toBe('2026-03-01')
        expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
        expect(diffDays('2026-08-26', '2026-09-25')).toBe(30)
        expect(eachDay('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
        expect(isValidIsoDate('2026-02-30')).toBe(false)
        expect(isValidIsoDate('2026-02-28')).toBe(true)
    })

    it('формат releaseDate туда и обратно', () => {
        expect(parseRuDate('26 августа 2026')).toBe('2026-08-26')
        expect(parseRuDate('3 февраля 2026')).toBe('2026-02-03')
        expect(parseRuDate('31 февраля 2026')).toBeNull()
        expect(parseRuDate('26 Августа 2026')).toBe('2026-08-26')
        expect(parseRuDate('26.08.2026')).toBeNull()
        expect(parseRuDate(undefined)).toBeNull()
        expect(formatRuDate('2026-08-26')).toBe('26 августа 2026')
        expect(formatRuDate('2026-05-01')).toBe('1 мая 2026')
        expect(() => formatRuDate('2026-13-01')).toThrow()
    })

    it('все существующие releaseDate разбираются', () => {
        for (const r of Object.values(releases)) {
            const iso = parseRuDate(r.releaseDate)
            expect(iso, r.title).not.toBeNull()
            expect(formatRuDate(iso!)).toBe(r.releaseDate)
            expect(iso!.slice(0, 4)).toBe(r.year)
        }
    })

    it('короткие подписи', () => {
        expect(formatShortDate('2026-08-26')).toBe('26 авг')
        expect(formatMediumDate('2026-01-05')).toBe('5 янв 2026')
    })
})

describe('aggregatePlays — ключи статистики', () => {
    it('складывает старый (1-based) и новый (0-based) формат одного трека', () => {
        const res = aggregatePlays(
            [
                { track_key: 'most-venture-poopsicks-0', plays: 10 },
                { track_key: 'most-venture-poopsicks--1', plays: 5 },
                { track_key: 'most-venture-poopsicks--3', plays: 2 },
                { track_key: 'disinvolto-0', plays: 7 }
            ],
            releases
        )
        expect(res.tracks.map((t) => [t.releaseId, t.trackIndex, t.plays])).toEqual([
            ['most-venture-poopsicks', 0, 15],
            ['disinvolto', 0, 7],
            ['most-venture-poopsicks', 2, 2]
        ])
        expect(res.tracks[0].title).toBe('POOPSICKS')
        expect(res.releases.map((r) => [r.releaseId, r.plays])).toEqual([
            ['most-venture-poopsicks', 17],
            ['disinvolto', 7]
        ])
        expect(res.total).toBe(24)
        expect(res.unknown).toEqual([])
    })

    it('id релиза с дефисами и цифрами в конце', () => {
        const res = aggregatePlays([{ track_key: 'zlaya-nostalgia-6', plays: 3 }], releases)
        expect(res.tracks[0]).toMatchObject({ releaseId: 'zlaya-nostalgia', trackIndex: 6, title: 'ГОУТЫ' })
    })

    it('несуществующие треки и мусор — отдельно, но в общей сумме', () => {
        const res = aggregatePlays(
            [
                { track_key: 'faaa-5', plays: 2 },
                { track_key: 'no-such-release-0', plays: 1 },
                { track_key: 'garbage', plays: 4 },
                { track_key: 'faaa--0', plays: 9 },
                { track_key: 'faaa-0', plays: 0 }
            ],
            releases
        )
        expect(res.tracks).toEqual([])
        expect(res.unknown.map((u) => u.track_key)).toEqual(['faaa--0', 'garbage', 'faaa-5', 'no-such-release-0'])
        expect(res.total).toBe(16)
    })

    it('прослушивания по трекам релиза, включая нули', () => {
        const plays = releaseTrackPlays(
            [
                { track_key: 'six-senses-pupsiks-1', plays: 4 },
                { track_key: 'six-senses-pupsiks--2', plays: 1 },
                { track_key: 'six-senses-pupsiks-9', plays: 100 },
                { track_key: 'faaa-0', plays: 3 }
            ],
            releases,
            'six-senses-pupsiks'
        )
        expect(plays).toEqual([0, 5, 0, 0, 0, 0])
    })
})

describe('ряды по дням', () => {
    it('заполняет пропуски нулями', () => {
        expect(fillDays([{ day: '2026-10-02', plays: 3 }], '2026-10-01', '2026-10-03')).toEqual([
            { day: '2026-10-01', plays: 0 },
            { day: '2026-10-02', plays: 3 },
            { day: '2026-10-03', plays: 0 }
        ])
    })

    it('ряд релиза берёт только его ключи (оба формата)', () => {
        const rows = [
            { day: '2026-10-01', track_key: 'faaa-0', plays: 2 },
            { day: '2026-10-01', track_key: 'faaa--1', plays: 1 },
            { day: '2026-10-01', track_key: 'boxik-0', plays: 5 },
            { day: '2026-10-02', track_key: 'faaa-0', plays: 4 }
        ]
        expect(releaseDailySeries(rows, 'faaa', '2026-10-01', '2026-10-02').map((d) => d.plays)).toEqual([3, 4])
    })
})

describe('resolvePeriod', () => {
    const since = '2026-09-20T09:00:00Z'

    it('пресеты от сегодняшнего дня', () => {
        expect(resolvePeriod('7d', '2026-10-01', since)).toEqual({ from: '2026-09-25', to: '2026-10-01', clippedBefore: null })
        expect(resolvePeriod('since', '2026-10-01', since)).toEqual({ from: '2026-09-20', to: '2026-10-01', clippedBefore: null })
    })

    it('обрезает период по дате запуска журнала', () => {
        expect(resolvePeriod('30d', '2026-10-01', since)).toEqual({ from: '2026-09-20', to: '2026-10-01', clippedBefore: '2026-09-02' })
    })

    it('свой период: будущее обрезается до сегодня', () => {
        expect(resolvePeriod('custom', '2026-10-01', since, { from: '2026-09-25', to: '2026-12-01' })).toEqual({
            from: '2026-09-25',
            to: '2026-10-01',
            clippedBefore: null
        })
    })

    it('без журнала периода нет', () => {
        expect(resolvePeriod('7d', '2026-10-01', null)).toBeNull()
    })
})

describe('releaseWindow — первые дни после релиза', () => {
    const since = '2026-09-01T00:00:00+03:00'

    it('релиз после запуска журнала — полное окно', () => {
        expect(releaseWindow('5 сентября 2026', 7, since, '2026-10-01')).toEqual({
            status: 'ok',
            releaseDate: '2026-09-05',
            from: '2026-09-05',
            to: '2026-09-11',
            queryFrom: '2026-09-05',
            queryTo: '2026-09-11'
        })
    })

    it('окно ещё не закончилось — данные до сегодня', () => {
        expect(releaseWindow('28 сентября 2026', 30, since, '2026-10-01')).toMatchObject({ status: 'ok', queryTo: '2026-10-01', to: '2026-10-27' })
    })

    it('релиз до запуска журнала — честно нет данных', () => {
        expect(releaseWindow('20 августа 2026', 7, since, '2026-10-01').status).toBe('before-tracking')
        // 26.08 + 7 дней заканчивается 01.09 — в день запуска журнала: один день данных.
        expect(releaseWindow('26 августа 2026', 7, since, '2026-10-01').status).toBe('partial')
    })

    it('журнал запущен посреди окна — частичные данные', () => {
        expect(releaseWindow('26 августа 2026', 30, since, '2026-10-01')).toMatchObject({
            status: 'partial',
            queryFrom: '2026-09-01',
            queryTo: '2026-09-24'
        })
    })

    it('будущий релиз и релиз без даты', () => {
        expect(releaseWindow('1 декабря 2026', 7, since, '2026-10-01').status).toBe('future')
        expect(releaseWindow(undefined, 7, since, '2026-10-01').status).toBe('no-date')
        expect(releaseWindow('5 сентября 2026', 7, null, '2026-10-01').status).toBe('no-tracking')
    })
})
