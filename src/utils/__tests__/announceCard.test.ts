import { describe, it, expect } from 'vitest'
import type { Announce } from '@/types'
import {
    formatCountdown,
    formatReleaseMoment,
    isAnnounceActive,
    isAnnounceExpired,
    safeAnnounceUrl
} from '../announceCard'

const base: Announce = {
    enabled: true,
    title: 'Новый <альбом>',
    cover: 'images/announce-novyy-20261002.jpg',
    releaseAt: '2026-11-01T18:00:00+03:00',
    text: 'Пресейв уже открыт',
    url: 'https://example.com/presave'
}
const AT = Date.parse('2026-11-01T15:00:00Z')

describe('анонс: время', () => {
    it('активен до момента выхода, потом — нет', () => {
        expect(isAnnounceActive(base, AT - 1)).toBe(true)
        expect(isAnnounceActive(base, AT)).toBe(false)
        expect(isAnnounceActive({ ...base, enabled: false }, AT - 1000)).toBe(false)
        expect(isAnnounceActive({ ...base, releaseAt: 'мусор' }, 0)).toBe(false)
        expect(isAnnounceActive(undefined)).toBe(false)
    })

    it('«N дн. HH:MM:SS»', () => {
        expect(formatCountdown(((3 * 24 + 4) * 3600 + 5 * 60 + 6) * 1000)).toBe('3 дн. 04:05:06')
        expect(formatCountdown(999)).toBe('0 дн. 00:00:01')
        expect(formatCountdown(-5)).toBe('0 дн. 00:00:00')
    })

    it('подпись момента выхода', () => {
        expect(formatReleaseMoment('2026-11-01T18:00:00+03:00')).toBe('1 ноября в 18:00 по Москве')
    })
})

// Сама карточка — src/site/__tests__/components.test.ts (AnnounceCard).
describe('ссылка «Подробнее»', () => {
    it('только https без кавычек и пробелов', () => {
        expect(safeAnnounceUrl('https://example.com/presave')).toBe('https://example.com/presave')
        expect(safeAnnounceUrl('javascript:alert(1)')).toBeNull()
        expect(safeAnnounceUrl('http://example.com')).toBeNull()
        expect(safeAnnounceUrl('https://a.b/"onmouseover=x')).toBeNull()
        expect(safeAnnounceUrl(undefined)).toBeNull()
    })
})

describe('анонс без даты', () => {
    const { releaseAt: _r, ...noDate } = base

    it('активен всегда, пока включён, и не истекает', () => {
        expect(isAnnounceActive(noDate, 0)).toBe(true)
        expect(isAnnounceActive(noDate, Date.parse('2099-01-01T00:00:00Z'))).toBe(true)
        expect(isAnnounceActive({ ...noDate, enabled: false })).toBe(false)
        expect(isAnnounceExpired(noDate, Date.parse('2099-01-01T00:00:00Z'))).toBe(false)
        // Старый формат с датой — как раньше.
        expect(isAnnounceExpired(base, AT)).toBe(true)
        expect(isAnnounceExpired(base, AT - 1)).toBe(false)
    })

})
