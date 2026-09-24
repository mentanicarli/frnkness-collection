import type { Releases, Track, TrackRef } from '@/types'

/**
 * Адрес трека в URL.
 *
 * За основу берём имя файла с текстом: оно уже в латинице и kebab-case,
 * поэтому транслитерация кириллических названий не нужна. Ведущий номер
 * трека отбрасываем — он дублирует порядок внутри релиза и сместился бы
 * при любой перестановке.
 */
export function getTrackSlug(track: Track): string {
    const base = (track?.lyricsFile || '').replace(/\.[^/.]+$/, '')
    const slug = base.replace(/^\d+-/, '')
    return slug || String(track?.num ?? '')
}

/**
 * Ищет трек по релизу и слагу. Возвращает null, если такого трека нет —
 * например, когда ссылка пришла из старой версии сайта.
 */
export function findTrackRefBySlug(
    releases: Releases,
    releaseId: string,
    slug: string
): TrackRef | null {
    const release = releases[releaseId]
    if (!release) return null
    const trackIndex = release.tracks.findIndex((track) => getTrackSlug(track) === slug)
    return trackIndex >= 0 ? { releaseId, trackIndex } : null
}

/**
 * Hash-адрес страницы трека.
 */
export function buildTrackHash(releaseId: string, track: Track): string {
    return `#/track/${encodeURIComponent(releaseId)}/${encodeURIComponent(getTrackSlug(track))}`
}
