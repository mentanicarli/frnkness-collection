import type { Releases } from '@/types'
import { findTrackById } from '@/utils/trackIds'
import { MATCH_NONE, createMatcher } from '@/utils/search'
import type { Top4Row } from './api'

/**
 * «Мой топ-4»: до четырёх значимых для человека треков, по постоянному id.
 * Не считается по прослушиваниям — человек выбирает сам и задаёт порядок.
 * Хранится в базе по id (top4_set / user_top4); трек, пропавший из каталога,
 * показывается пустым местом, без ошибки.
 */
export const TOP4_SIZE = 4

/**
 * Четыре места для показа: на каждом — id доступного трека или null (место
 * пустое либо трек пропал из каталога). Место берётся из position, поэтому
 * пропавший трек не сдвигает остальные.
 */
export function top4Slots(rows: readonly Top4Row[] | null | undefined, releases: Releases): (string | null)[] {
    const slots: (string | null)[] = Array.from({ length: TOP4_SIZE }, () => null)
    for (const row of rows ?? []) {
        const pos = Number(row?.position)
        if (!Number.isInteger(pos) || pos < 1 || pos > TOP4_SIZE || typeof row.track_id !== 'string') continue
        if (findTrackById(releases, row.track_id)) slots[pos - 1] = row.track_id
    }
    return slots
}

/** Черновик для редактора: id по порядку, без разрывов (пропавшие из каталога остаются — их можно убрать). */
export function draftFromRows(rows: readonly Top4Row[] | null | undefined): string[] {
    return [...(rows ?? [])]
        .filter((r) => typeof r?.track_id === 'string' && Number.isInteger(Number(r.position)))
        .sort((a, b) => Number(a.position) - Number(b.position))
        .map((r) => r.track_id)
        .slice(0, TOP4_SIZE)
}

export const canAdd = (draft: readonly string[], trackId: string): boolean => draft.length < TOP4_SIZE && !draft.includes(trackId)

export function addToDraft(draft: readonly string[], trackId: string): string[] {
    return canAdd(draft, trackId) ? [...draft, trackId] : [...draft]
}

export function removeFromDraft(draft: readonly string[], index: number): string[] {
    return draft.filter((_, i) => i !== index)
}

/** Переставить элемент с места from на место to (остальные сдвигаются). Выход за границы — без изменений. */
export function moveInDraft(draft: readonly string[], from: number, to: number): string[] {
    const out = [...draft]
    if (from === to || from < 0 || to < 0 || from >= out.length || to >= out.length) return out
    const [item] = out.splice(from, 1)
    out.splice(to, 0, item)
    return out
}

export const sameDraft = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, i) => id === b[i])

export interface TrackHit {
    trackId: string
    title: string
    releaseTitle: string
    cover: string
}

/**
 * Поиск трека по каталогу для редактора: по названию трека и релиза, с
 * начала слова. Название трека весит больше названия релиза. Релизы «скоро»
 * пропускаются — их треков ещё нет.
 */
export function searchTracks(releases: Releases, query: string, limit = 8): TrackHit[] {
    const match = createMatcher(query)
    const hits: (TrackHit & { rank: number; order: number })[] = []
    let order = 0
    for (const release of Object.values(releases)) {
        if (release.upcoming) continue
        const releaseRank = match(release.title)
        for (const track of release.tracks) {
            order++
            if (!track.id) continue
            const trackRank = match(track.title)
            const rank = trackRank !== MATCH_NONE ? trackRank + 2 : releaseRank
            if (rank === MATCH_NONE) continue
            hits.push({ trackId: track.id, title: track.title, releaseTitle: release.title, cover: release.cover, rank, order })
        }
    }
    hits.sort((a, b) => b.rank - a.rank || a.order - b.order)
    return hits.slice(0, limit).map(({ trackId, title, releaseTitle, cover }) => ({ trackId, title, releaseTitle, cover }))
}
