import { shallowReactive } from 'vue'
import { supabase } from '@/supabaseClient'
import { SocialError, api, errorText, type PlaylistSummary } from './api'
import { showNotice } from './notice'

/**
 * Мои плейлисты (меню «+ в плейлист», «Мои плейлисты») и обложки.
 *
 * Своя обложка — файл <owner>/<id> в приватном бакете playlist-covers:
 * замена перезаписывает файл, версия в базе сбрасывает кэш. Показываем
 * по подписанным ссылкам: видят те, кому виден плейлист.
 */

export const PLAYLISTS_MAX = 50
export const PLAYLIST_TRACKS_MAX = 200
export const COVER_SIZE = 512
const COVERS_BUCKET = 'playlist-covers'

export const myPlaylists = shallowReactive({
    items: [] as PlaylistSummary[],
    loaded: false,
    userId: null as string | null
})

let loadSeq = 0

export function resetMyPlaylists(userId: string | null): void {
    loadSeq++
    myPlaylists.userId = userId
    myPlaylists.items = []
    myPlaylists.loaded = false
}

export async function loadMyPlaylists(): Promise<void> {
    const userId = myPlaylists.userId
    if (!userId) return
    const seq = ++loadSeq
    try {
        const rows = await api.userPlaylists(userId)
        if (seq !== loadSeq) return
        myPlaylists.items = rows ?? []
        myPlaylists.loaded = true
    } catch {
        // Повторим при следующем открытии меню или страницы.
    }
}

/** Обновить плейлист в списке (после правки), новые и изменённые — сверху. */
export function rememberPlaylist(p: PlaylistSummary): void {
    myPlaylists.items = [p, ...myPlaylists.items.filter((x) => x.id !== p.id)]
}

export function forgetPlaylist(id: string): void {
    myPlaylists.items = myPlaylists.items.filter((x) => x.id !== id)
}

/** «+ в плейлист»: true — добавлено. */
export async function addToPlaylist(playlist: { id: string; title: string }, trackId: string): Promise<boolean> {
    try {
        rememberPlaylist(await api.playlistAddTrack(playlist.id, trackId))
        showNotice(`Добавлено в «${playlist.title}»`)
        return true
    } catch (e) {
        showNotice(errorText(e), true)
        return false
    }
}

export async function createPlaylist(title: string, trackId?: string): Promise<PlaylistSummary | null> {
    try {
        let created: PlaylistSummary = await api.playlistCreate(title)
        if (trackId) created = await api.playlistAddTrack(created.id, trackId)
        rememberPlaylist(created)
        showNotice(trackId ? `Создан плейлист «${created.title}», трек добавлен` : `Создан плейлист «${created.title}»`)
        return created
    } catch (e) {
        showNotice(errorText(e), true)
        return null
    }
}

// ── Обложки ────────────────────────────────────────────────────────────

export const coverPath = (p: { owner_id: string; id: string }): string => `${p.owner_id}/${p.id}`

/** Загрузить свою обложку (уже обрезанную и сжатую) и записать версию. */
export async function uploadPlaylistCover(p: PlaylistSummary, blob: Blob): Promise<PlaylistSummary> {
    const { error } = await supabase.storage.from(COVERS_BUCKET).upload(coverPath(p), blob, { upsert: true, contentType: blob.type, cacheControl: '3600' })
    if (error) throw new SocialError('Не удалось загрузить картинку — попробуй ещё раз', 'storage')
    const updated = await api.playlistSetCover(p.id, Date.now())
    signedCache.delete(coverPath(p))
    rememberPlaylist(updated)
    return updated
}

/** Вернуть коллаж: файл — из хранилища, версия — null. */
export async function removePlaylistCover(p: PlaylistSummary): Promise<PlaylistSummary> {
    await supabase.storage.from(COVERS_BUCKET).remove([coverPath(p)]).catch(() => undefined)
    const updated = await api.playlistSetCover(p.id, null)
    signedCache.delete(coverPath(p))
    rememberPlaylist(updated)
    return updated
}

/** Удалить плейлист: сначала своя обложка (файлы удаляет только API хранилища). */
export async function deletePlaylist(p: PlaylistSummary): Promise<void> {
    if (p.cover_version) await supabase.storage.from(COVERS_BUCKET).remove([coverPath(p)]).catch(() => undefined)
    await api.playlistDelete(p.id)
    signedCache.delete(coverPath(p))
    forgetPlaylist(p.id)
}

// Подписанная ссылка живёт час; держим 50 минут на путь+версию.
const SIGNED_TTL_SEC = 3600
const signedCache = new Map<string, { version: number; url: string; until: number }>()

/** Ссылки на свои обложки плейлистов: id плейлиста → url. */
export async function coverUrls(list: readonly PlaylistSummary[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {}
    const now = Date.now()
    const missing: PlaylistSummary[] = []
    for (const p of list) {
        if (!p.cover_version) continue
        const cached = signedCache.get(coverPath(p))
        if (cached && cached.version === p.cover_version && cached.until > now) out[p.id] = cached.url
        else missing.push(p)
    }
    if (!missing.length) return out
    try {
        const { data } = await supabase.storage.from(COVERS_BUCKET).createSignedUrls(missing.map(coverPath), SIGNED_TTL_SEC)
        for (const item of data ?? []) {
            const p = missing.find((x) => coverPath(x) === item.path)
            if (!p || !item.signedUrl || item.error) continue
            const url = `${item.signedUrl}&v=${p.cover_version}`
            signedCache.set(coverPath(p), { version: p.cover_version!, url, until: now + (SIGNED_TTL_SEC - 600) * 1000 })
            out[p.id] = url
        }
    } catch {
        // Без ссылки покажется коллаж.
    }
    return out
}

// ── Порядок ────────────────────────────────────────────────────────────

/** Новый порядок: элемент from встаёт на место to (перетаскивание, ↑/↓). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
    const out = [...list]
    if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out
    const [item] = out.splice(from, 1)
    out.splice(to, 0, item)
    return out
}
