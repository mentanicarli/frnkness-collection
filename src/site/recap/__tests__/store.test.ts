import { beforeEach, describe, expect, it, vi } from 'vitest'

const user = { id: 'u1' }
vi.mock('@/site/session', () => ({ session: { get user() { return user.id ? { id: user.id } : null } } }))
const state = vi.fn()
vi.mock('../api', () => ({ recapApi: { state: (...a: unknown[]) => state(...a), get: vi.fn() } }))

import { bannerVisible, dismissBanner, loadRecapState, recapStore, resetRecap } from '../store'

describe('итоги года: состояние сайта', () => {
    beforeEach(() => {
        user.id = 'u1'
        localStorage.clear()
        resetRecap()
        state.mockReset()
    })

    it('пока не открыто: ни состояния, ни плашки', async () => {
        state.mockResolvedValue(null)
        await loadRecapState()
        expect(recapStore.state).toBeNull()
        expect(recapStore.loaded).toBe(true)
        expect(bannerVisible()).toBe(false)
    })

    it('любая ошибка базы — как «не открыто»', async () => {
        state.mockRejectedValue(new Error('boom'))
        await loadRecapState()
        expect(recapStore.state).toBeNull()
        expect(bannerVisible()).toBe(false)
    })

    it('открыто: плашка видна, после «Закрыть» больше не появляется сама (и после перезагрузки)', async () => {
        state.mockResolvedValue({ year: 2025, years: [2025] })
        await loadRecapState()
        expect(recapStore.state?.year).toBe(2025)
        expect(bannerVisible()).toBe(true)
        dismissBanner()
        expect(bannerVisible()).toBe(false)
        // «Новый вход»: состояние сброшено и загружено заново.
        resetRecap()
        await loadRecapState()
        expect(recapStore.state?.year).toBe(2025)
        expect(bannerVisible()).toBe(false)
    })

    it('закрытие плашки привязано к году и к пользователю', async () => {
        state.mockResolvedValue({ year: 2025, years: [2025] })
        await loadRecapState()
        dismissBanner()
        state.mockResolvedValue({ year: 2026, years: [2026, 2025] })
        resetRecap()
        await loadRecapState()
        expect(bannerVisible()).toBe(true)
        user.id = 'u2'
        state.mockResolvedValue({ year: 2025, years: [2025] })
        resetRecap()
        await loadRecapState()
        expect(bannerVisible()).toBe(true)
    })

    it('хранилище недоступно — не падаем', async () => {
        state.mockResolvedValue({ year: 2025, years: [2025] })
        await loadRecapState()
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
        expect(() => dismissBanner()).not.toThrow()
        expect(bannerVisible()).toBe(false)
        spy.mockRestore()
    })

    it('устаревший ответ не затирает новый (смена пользователя во время запроса)', async () => {
        let resolve!: (v: unknown) => void
        state.mockReturnValueOnce(new Promise((r) => { resolve = r }))
        const pending = loadRecapState()
        user.id = 'u2'
        resetRecap()
        resolve({ year: 2025, years: [2025] })
        await pending
        expect(recapStore.state).toBeNull()
    })
})
