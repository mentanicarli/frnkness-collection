import { describe, it, expect } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { generateTempPassword } from '../../api/users'
import { isAdminSession } from '../../composables/useAuth'
import { validatePassword } from '../../../../supabase/functions/_shared/accounts.ts'

describe('временный пароль', () => {
    it('12 символов без похожих, проходит правила', () => {
        for (let i = 0; i < 50; i++) {
            const p = generateTempPassword()
            expect(p).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{12}$/)
            expect(validatePassword(p, 'nick')).toBeNull()
        }
    })
})

describe('кому открыта админка (интерфейс; права проверяет сервер)', () => {
    const session = (app_metadata: Record<string, unknown>) => ({ user: { app_metadata } }) as unknown as Session
    it('admin и owner — да, остальные — нет', () => {
        expect(isAdminSession(session({ role: 'admin' }))).toBe(true)
        expect(isAdminSession(session({ role: 'owner' }))).toBe(true)
        expect(isAdminSession(session({ role: 'user' }))).toBe(false)
        expect(isAdminSession(session({}))).toBe(false)
        expect(isAdminSession(null)).toBe(false)
    })
})
