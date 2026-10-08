import { releases } from '@/config'
import { findTrackById } from '@/utils/trackIds'

/**
 * Трек по постоянному id — для избранного, плейлистов, топа. Трека нет в
 * каталоге — available: false, на странице он «недоступен».
 */
export interface TrackInfo {
    trackId: string
    available: boolean
    title: string
    releaseId: string | null
    releaseTitle: string
    cover: string | null
    trackIndex: number
}

export function trackInfo(trackId: string): TrackInfo {
    const ref = findTrackById(releases, trackId)
    if (!ref) return { trackId, available: false, title: 'Трек недоступен', releaseId: null, releaseTitle: '', cover: null, trackIndex: -1 }
    const release = releases[ref.releaseId]
    return {
        trackId,
        available: true,
        title: release.tracks[ref.trackIndex].title,
        releaseId: ref.releaseId,
        releaseTitle: release.title,
        cover: release.cover,
        trackIndex: ref.trackIndex
    }
}

/** Сколько первых треков база отдаёт для коллажа (first_tracks); страница плейлиста берёт столько же, чтобы коллаж в списке и на странице совпадал. */
export const COLLAGE_SOURCE_TRACKS = 8

/** Обложки для коллажа: разные обложки первых доступных треков, до четырёх. */
export function collageCovers(trackIds: readonly string[], failed?: ReadonlySet<string>): string[] {
    const out: string[] = []
    for (const id of trackIds) {
        const cover = trackInfo(id).cover
        if (cover && !failed?.has(cover) && !out.includes(cover)) out.push(cover)
        if (out.length === 4) break
    }
    return out
}

/**
 * Что рисовать на обложке плейлиста:
 *  - custom — своя картинка, одна на весь квадрат, сколько бы ни было треков;
 *  - grid   — четыре разные обложки, сетка 2×2;
 *  - single — меньше четырёх разных релизов: первая обложка на весь квадрат;
 *  - empty  — нет ни одной доступной обложки (0 треков): заглушка.
 * Клетки без картинки не бывает ни в одном из случаев: картинки, которые не
 * загрузились (failed), в раскладку не попадают, и она пересчитывается.
 */
export type CoverLayout = { kind: 'custom' | 'single'; covers: [string] } | { kind: 'grid'; covers: string[] } | { kind: 'empty'; covers: [] }

export function coverLayout(trackIds: readonly string[], customUrl?: string | null, failed?: ReadonlySet<string>): CoverLayout {
    if (customUrl && !failed?.has(customUrl)) return { kind: 'custom', covers: [customUrl] }
    const covers = collageCovers(trackIds, failed)
    if (covers.length >= 4) return { kind: 'grid', covers }
    if (covers.length) return { kind: 'single', covers: [covers[0]] }
    return { kind: 'empty', covers: [] }
}
