import type { LyricLine, TrackRef } from '@/types'
import type { Releases } from '@/types'

/**
 * Парсит LRC-текст в массив строк с таймкодами.
 */
export function parseLRC(text: string): LyricLine[] {
    return text
        .split('\n')
        .map((line) => {
            const m = line.match(/\[(\d{2}):(\d{2})(?:\.|:)(\d{2})?\](.*)/)
            if (m) {
                return {
                    time: parseInt(m[1]) * 60 + parseInt(m[2]) + (m[3] ? parseInt(m[3]) / 100 : 0),
                    text: m[4] || ''
                }
            }
            return null
        })
        .filter(Boolean)
        .sort((a, b) => a!.time - b!.time) as LyricLine[]
}

/**
 * Парсит ключ трека в обоих форматах:
 * legacy: releaseId--trackNumber (1-based)
 * modern: releaseId-trackNumber (0-based)
 */
export function parseTrackKey(key: string): TrackRef | null {
    if (typeof key !== 'string') return null

    // Legacy format: releaseId--trackNumber (1-based)
    const legacyMatch = key.match(/^(.*)--(\d+)$/)
    if (legacyMatch) {
        const releaseId = legacyMatch[1]
        const oneBased = parseInt(legacyMatch[2], 10)
        const trackIndex = oneBased - 1
        if (Number.isInteger(trackIndex) && trackIndex >= 0) {
            return { releaseId, trackIndex }
        }
        return null
    }

    // Modern format: releaseId-trackNumber (0-based)
    const modernMatch = key.match(/^(.*)-(\d+)$/)
    if (modernMatch) {
        const releaseId = modernMatch[1]
        const trackIndex = parseInt(modernMatch[2], 10)
        if (Number.isInteger(trackIndex) && trackIndex >= 0) {
            return { releaseId, trackIndex }
        }
    }

    return null
}

/**
 * Строит плоский список ссылок на все треки из реестра релизов.
 */
export function getAllTrackRefs(releases: Releases): TrackRef[] {
    return Object.entries(releases).flatMap(([releaseId, release]) =>
        release.tracks.map((_, trackIndex) => ({ releaseId, trackIndex }))
    )
}

/**
 * Сравнивает две ссылки на трек.
 */
export function isSameTrackRef(a: TrackRef | null, b: TrackRef | null): boolean {
    return Boolean(a && b && a.releaseId === b.releaseId && a.trackIndex === b.trackIndex)
}

/**
 * Выбирает случайный трек, опционально исключая текущий.
 */
export function pickRandomTrackRef(
    releases: Releases,
    excludeRef: TrackRef | null = null
): TrackRef | null {
    const refs = getAllTrackRefs(releases).filter((ref) => !excludeRef || !isSameTrackRef(ref, excludeRef))
    if (!refs.length) return null
    return refs[Math.floor(Math.random() * refs.length)]
}
