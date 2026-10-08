import { describe, expect, it } from 'vitest'
import { buildCards } from '../cards'
import { DAY_PART_LABEL, formatCount, formatDuration, formatRecapDay, topDayPart } from '../format'
import { catalogFromReleases } from '../catalog'
import { CATALOG, RELEASES, makeRecap } from './fixtures'

const kinds = (cards: ReturnType<typeof buildCards>) => cards.map((c) => c.kind)

describe('итоги года: карточки', () => {
    it('полные данные — все карточки по порядку и сводка в конце', () => {
        expect(kinds(buildCards(makeRecap(), CATALOG))).toEqual(['intro', 'minutes', 'top', 'release', 'first', 'day', 'daypart', 'rooms', 'favorites', 'summary'])
    })

    it('треки, которых нет в каталоге, в топе пропускаются', () => {
        const top = buildCards(makeRecap(), CATALOG).find((c) => c.kind === 'top')
        expect(top?.kind === 'top' && top.tracks.map((t) => t.title)).toEqual(['Первый', 'Соло', 'Второй'])
    })

    it('карточки без данных не показываются', () => {
        const recap = makeRecap({ rooms: { count: 0, with: [] }, favorites_added: 0, best_day: null, first_track: null, top_release: null })
        expect(kinds(buildCards(recap, CATALOG))).toEqual(['intro', 'minutes', 'top', 'daypart', 'summary'])
        // Релиз удалили из каталога — карточки «любимый релиз» нет.
        expect(kinds(buildCards(makeRecap({ top_release: { release_id: 'gone', plays: 5, minutes: 5 } }), CATALOG))).not.toContain('release')
        expect(kinds(buildCards(makeRecap({ day_parts: { morning: 0, day: 0, evening: 0, night: 0 } }), CATALOG))).not.toContain('daypart')
    })

    it('меньше 10 прослушиваний: заметка и только то, что есть; без релиза, дня и времени суток', () => {
        const recap = makeRecap({ plays: 4, sparse: true, minutes: 12, top_tracks: [{ track_key: 'alpha-0', plays: 4, minutes: 12 }] })
        expect(kinds(buildCards(recap, CATALOG))).toEqual(['intro', 'sparse', 'minutes', 'top', 'first', 'rooms', 'favorites', 'summary'])
    })

    it('совсем пусто — дружелюбный текст без сводки (и без картинки)', () => {
        const empty = makeRecap({ plays: 0, minutes: 0, sparse: true, top_tracks: [], top_release: null, first_track: null, best_day: null, rooms: { count: 0, with: [] }, favorites_added: 0 })
        expect(kinds(buildCards(empty, CATALOG))).toEqual(['intro', 'empty'])
    })

    it('только избранное или комнаты — это уже данные', () => {
        const only = makeRecap({ plays: 0, minutes: 0, sparse: true, top_tracks: [], top_release: null, first_track: null, best_day: null, rooms: { count: 0, with: [] }, favorites_added: 2 })
        expect(kinds(buildCards(only, CATALOG))).toEqual(['intro', 'sparse', 'favorites', 'summary'])
    })

    it('ник и тексты остаются данными (экранирует шаблон), карточки не собирают html', () => {
        const cards = buildCards(makeRecap({ user: { id: 'u1', nick: '<img src=x onerror=alert(1)>', avatar: 'initials:0' } }), CATALOG)
        expect(cards[0]).toMatchObject({ kind: 'intro', nick: '<img src=x onerror=alert(1)>' })
    })
})

describe('итоги года: форматирование и каталог', () => {
    it('день, число, длительность', () => {
        expect(formatRecapDay('2025-05-05')).toBe('5 мая')
        expect(formatRecapDay('2025-12-31')).toBe('31 декабря')
        expect(formatRecapDay('мусор')).toBe('')
        expect(formatCount(12345)).toMatch(/^12\s?345$/)
        expect(formatCount(-3)).toBe('0')
        expect(formatDuration(45)).toBe('45 мин')
        expect(formatDuration(135)).toBe('2 ч 15 мин')
        expect(formatDuration(120)).toBe('2 ч')
    })

    it('любимое время суток: больше всего прослушиваний, доля в процентах', () => {
        expect(topDayPart({ morning: 1, day: 2, evening: 6, night: 1 })).toEqual({ id: 'evening', plays: 6, share: 60 })
        expect(topDayPart({ morning: 0, day: 0, evening: 0, night: 0 })).toBeNull()
        expect(topDayPart({ morning: 3, day: 3, evening: 0, night: 0 })?.id).toBe('morning')
        expect(DAY_PART_LABEL.night).toBe('Ночь')
    })

    it('каталог: ключ статистики → трек и релиз; неизвестное — null', () => {
        expect(catalogFromReleases(RELEASES).track('alpha-1')).toMatchObject({ title: 'Второй', releaseId: 'alpha', releaseTitle: 'Альфа', cover: 'images/alpha.jpg' })
        expect(CATALOG.track('alpha-9')).toBeNull()
        expect(CATALOG.track('gone-0')).toBeNull()
        expect(CATALOG.track('мусор')).toBeNull()
        expect(CATALOG.release('beta')?.title).toContain('Бета')
        expect(CATALOG.release('gone')).toBeNull()
    })
})
