import { describe, it, expect } from 'vitest'
import { parseTokenExpiration } from '../../../../supabase/functions/_shared/tokenExpiry.ts'
import { pluralDays, tokenStatus } from '../token'

describe('parseTokenExpiration', () => {
    it('форматы заголовка GitHub', () => {
        expect(parseTokenExpiration('2026-12-31 23:59:59 UTC')).toBe('2026-12-31T23:59:59.000Z')
        expect(parseTokenExpiration('2026-12-31 23:59:59 +0300')).toBe('2026-12-31T20:59:59.000Z')
        expect(parseTokenExpiration('2026-12-31 23:59:59 -07:00')).toBe('2027-01-01T06:59:59.000Z')
        expect(parseTokenExpiration('2026-12-31T23:59:59Z')).toBe('2026-12-31T23:59:59.000Z')
    })

    it('нет заголовка или мусор — null', () => {
        expect(parseTokenExpiration(null)).toBeNull()
        expect(parseTokenExpiration('')).toBeNull()
        expect(parseTokenExpiration('never')).toBeNull()
    })
})

describe('tokenStatus', () => {
    const now = new Date('2026-10-02T09:00:00Z') // 12:00 по Москве

    it('больше 30 дней — ok', () => {
        expect(tokenStatus('2027-09-30T20:00:00Z', now)).toEqual({ kind: 'ok', days: 363, date: '30.09.2027' })
    })

    it('меньше 30 дней — предупреждение', () => {
        expect(tokenStatus('2026-10-20T09:00:00Z', now)).toEqual({ kind: 'soon', days: 18, date: '20.10.2026' })
        expect(tokenStatus('2026-10-31T21:30:00Z', now)).toEqual({ kind: 'ok', days: 30, date: '01.11.2026' })
        expect(tokenStatus('2026-10-02T20:00:00Z', now)).toEqual({ kind: 'soon', days: 0, date: '02.10.2026' })
    })

    it('истёк', () => {
        expect(tokenStatus('2026-10-01T09:00:00Z', now)).toEqual({ kind: 'expired', days: 0, date: '01.10.2026' })
    })

    it('без срока', () => {
        expect(tokenStatus(null, now)).toEqual({ kind: 'none', days: null, date: null })
    })

    it('склонение', () => {
        expect([1, 2, 5, 11, 21, 22, 25, 112].map((n) => `${n} ${pluralDays(n)}`)).toEqual([
            '1 день', '2 дня', '5 дней', '11 дней', '21 день', '22 дня', '25 дней', '112 дней'
        ])
    })
})
