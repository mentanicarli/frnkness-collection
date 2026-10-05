import type { Releases, TrackRef } from '@/types'
import { parseTrackKey } from './lyrics'

/**
 * Постоянные id треков («<releaseId>/<slug>», поле id в releases.json) и
 * старые ключи статистики («<releaseId>-<индекс>», в самых старых записях —
 * «<releaseId>--<номер с 1>»).
 *
 * Избранное, плейлисты и комнаты ссылаются только на id. Статистика пока
 * хранится по старым ключам; эти функции переводят одно в другое.
 */

/** Трек с этим id: релиз и индекс в нём, или null. */
export function findTrackById(releases: Releases, trackId: string): TrackRef | null {
    if (typeof trackId !== 'string') return null
    const releaseId = trackId.slice(0, trackId.indexOf('/'))
    const release = releases[releaseId]
    if (!release) return null
    const trackIndex = release.tracks.findIndex((t) => t.id === trackId)
    return trackIndex >= 0 ? { releaseId, trackIndex } : null
}

/** id трека по релизу и индексу, или null. */
export function trackIdAt(releases: Releases, releaseId: string, trackIndex: number): string | null {
    return releases[releaseId]?.tracks[trackIndex]?.id ?? null
}

/** Ключ статистики → id трека; null, если такого трека в каталоге нет. */
export function statsKeyToTrackId(releases: Releases, key: string): string | null {
    const ref = parseTrackKey(key)
    return ref ? trackIdAt(releases, ref.releaseId, ref.trackIndex) : null
}

/** id трека → ключ статистики в нынешнем формате «<releaseId>-<индекс>». */
export function trackIdToStatsKey(releases: Releases, trackId: string): string | null {
    const ref = findTrackById(releases, trackId)
    return ref ? `${ref.releaseId}-${ref.trackIndex}` : null
}
