// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { RECOVERY_ALPHABET, formatRecoveryCode, generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode } from '../../../../supabase/functions/_shared/recoveryCode.ts'

describe('код восстановления', () => {
    it('формат: 4 группы по 4 символа, алфавит без похожих знаков (0, 1, I, O)', () => {
        for (let i = 0; i < 200; i++) {
            const code = generateRecoveryCode()
            expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/)
            expect(code).not.toMatch(/[01IO]/)
        }
        expect(RECOVERY_ALPHABET).toHaveLength(32)
        expect(new Set(RECOVERY_ALPHABET).size).toBe(32)
    })

    it('случайность: коды не повторяются, символы разбросаны по всему алфавиту', () => {
        const codes = new Set<string>()
        const seen = new Set<string>()
        for (let i = 0; i < 500; i++) {
            const c = generateRecoveryCode()
            codes.add(c)
            for (const ch of c.replace(/-/g, '')) seen.add(ch)
        }
        expect(codes.size).toBe(500)
        expect(seen.size).toBe(32)
    })

    it('каждый байт даёт символ без смещения: 256 значений поровну на 32 знака', () => {
        const counts = new Map<string, number>()
        for (let b = 0; b < 256; b += 16) {
            const bytes = new Uint8Array(16).fill(0).map((_, i) => (b + i) % 256)
            const raw = generateRecoveryCode(() => bytes).replace(/-/g, '')
            for (const ch of raw) counts.set(ch, (counts.get(ch) ?? 0) + 1)
        }
        // 256 байт = 8 полных кругов алфавита.
        expect([...counts.values()].every((n) => n === 8)).toBe(true)
        expect(counts.size).toBe(32)
    })

    it('нормализация: регистр, пробелы и дефисы не важны; мусор и неверная длина — null', () => {
        expect(normalizeRecoveryCode('abcd-efgh-jklm-npqr')).toBe('ABCDEFGHJKLMNPQR')
        expect(normalizeRecoveryCode(' ABCD EFGH  JKLM NPQR ')).toBe('ABCDEFGHJKLMNPQR')
        expect(normalizeRecoveryCode('ABCDEFGHJKLMNPQR')).toBe('ABCDEFGHJKLMNPQR')
        for (const bad of ['', 'ABCD', 'ABCD-EFGH-JKLM-NPQ', 'ABCD-EFGH-JKLM-NPQR-S', 'ABCD-EFGH-JKLM-NPQ0', 'ABCD-EFGH-JKLM-NPQI', 'мусор', null, undefined, 123]) {
            expect(normalizeRecoveryCode(bad as string), String(bad)).toBeNull()
        }
        expect(formatRecoveryCode('ABCDEFGHJKLMNPQR')).toBe('ABCD-EFGH-JKLM-NPQR')
    })

    it('хеш: 64 hex, зависит от кода, пользователя и секрета; открытого кода в нём нет', async () => {
        const h = await hashRecoveryCode('secret', 'user-1', 'ABCDEFGHJKLMNPQR')
        expect(h).toMatch(/^[0-9a-f]{64}$/)
        expect(await hashRecoveryCode('secret', 'user-1', 'ABCDEFGHJKLMNPQR')).toBe(h)
        expect(await hashRecoveryCode('secret', 'user-2', 'ABCDEFGHJKLMNPQR')).not.toBe(h)
        expect(await hashRecoveryCode('other', 'user-1', 'ABCDEFGHJKLMNPQR')).not.toBe(h)
        expect(await hashRecoveryCode('secret', 'user-1', 'ABCDEFGHJKLMNPQS')).not.toBe(h)
        expect(h).not.toContain('ABCD')
    })
})
