import { reactive } from 'vue'
import { session } from '@/site/session'
import { recapApi } from './api'
import type { RecapState } from './types'

/**
 * Что «Итоги года» значат для вошедшего. Пока итоги не открыты, state
 * остаётся null: плашки, ссылок и страницы нет, следа функции на сайте нет.
 */
export const recapStore = reactive({
    state: null as RecapState | null,
    loaded: false,
    /** Плашку закрыли (для текущего года). */
    dismissed: false
})

const dismissKey = (userId: string, year: number) => `frnk-recap-dismissed:${userId}:${year}`

function readDismissed(userId: string, year: number): boolean {
    try {
        return localStorage.getItem(dismissKey(userId, year)) === '1'
    } catch {
        return false
    }
}

let token = 0

export function resetRecap(): void {
    token++
    recapStore.state = null
    recapStore.loaded = false
    recapStore.dismissed = false
}

/** Спросить у базы, открыты ли мне итоги. Любая ошибка — «не открыты». */
export async function loadRecapState(): Promise<void> {
    const userId = session.user?.id
    if (!userId) return
    const mine = ++token
    let state: RecapState | null = null
    try {
        state = await recapApi.state()
    } catch {
        state = null
    }
    if (mine !== token || session.user?.id !== userId) return
    recapStore.state = state && Number.isInteger(state.year) ? { year: state.year, years: Array.isArray(state.years) ? state.years : [state.year] } : null
    recapStore.dismissed = state ? readDismissed(userId, state.year) : false
    recapStore.loaded = true
}

/** Плашка при входе: открыто и ещё не закрыто. */
export const bannerVisible = (): boolean => Boolean(recapStore.state) && !recapStore.dismissed

export function dismissBanner(): void {
    const userId = session.user?.id
    const year = recapStore.state?.year
    recapStore.dismissed = true
    if (!userId || !year) return
    try {
        localStorage.setItem(dismissKey(userId, year), '1')
    } catch {
        // Без хранилища плашка вернётся при следующем входе — не страшно.
    }
}
