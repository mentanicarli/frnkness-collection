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

/** Обложки для коллажа: разные обложки первых доступных треков, до четырёх. */
export function collageCovers(trackIds: readonly string[]): string[] {
    const out: string[] = []
    for (const id of trackIds) {
        const cover = trackInfo(id).cover
        if (cover && !out.includes(cover)) out.push(cover)
        if (out.length === 4) break
    }
    return out
}
