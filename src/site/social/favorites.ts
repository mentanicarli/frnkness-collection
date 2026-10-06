import { shallowReactive } from 'vue'
import { api, errorText, type FavoriteRow } from './api'
import { showNotice } from './notice'

/**
 * Моё избранное: сердечки в треклисте, на странице трека и в плеерах
 * читают отсюда. Нажатие меняет состояние сразу; если база не приняла —
 * возвращаем как было и показываем ошибку.
 */
export const favorites = shallowReactive({
    /** Новые сверху. */
    items: [] as FavoriteRow[],
    ids: new Set<string>(),
    loaded: false,
    userId: null as string | null
})

let loadSeq = 0
// Ожидающие ответа нажатия: повторное нажатие на тот же трек ждёт первое.
const pending = new Map<string, Promise<void>>()

function setItems(items: FavoriteRow[]) {
    favorites.items = items
    favorites.ids = new Set(items.map((i) => i.track_id))
}

export function resetFavorites(userId: string | null): void {
    loadSeq++
    pending.clear()
    favorites.userId = userId
    favorites.loaded = false
    setItems([])
}

export async function loadFavorites(): Promise<void> {
    const userId = favorites.userId
    if (!userId) return
    const seq = ++loadSeq
    try {
        const rows = await api.userFavorites(userId)
        if (seq !== loadSeq) return
        setItems(rows ?? [])
        favorites.loaded = true
    } catch {
        // Без сети сердечки просто пустые; повторим при следующем заходе на страницу.
    }
}

export const isFavorite = (trackId: string | null | undefined): boolean => Boolean(trackId && favorites.ids.has(trackId))

export function toggleFavorite(trackId: string): Promise<void> {
    const before = pending.get(trackId) ?? Promise.resolve()
    const run = before.then(() => setFavorite(trackId, !isFavorite(trackId)))
    pending.set(trackId, run)
    void run.finally(() => {
        if (pending.get(trackId) === run) pending.delete(trackId)
    })
    return run
}

async function setFavorite(trackId: string, on: boolean): Promise<void> {
    if (!favorites.userId) return
    const seq = loadSeq
    const prev = favorites.items
    setItems(on ? [{ track_id: trackId, added_at: new Date().toISOString() }, ...prev.filter((i) => i.track_id !== trackId)] : prev.filter((i) => i.track_id !== trackId))
    try {
        await api.favoriteSet(trackId, on)
    } catch (e) {
        if (seq !== loadSeq) return
        setItems(prev)
        showNotice(errorText(e), true)
    }
}
