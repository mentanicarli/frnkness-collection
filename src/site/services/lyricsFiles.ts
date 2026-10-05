import type { Release, Track } from '@/types'
import { buildAssetUrl } from '@/utils/helpers'
import { fetchTextFile } from '@/utils/textFiles'

/**
 * Файлы текста трека (.txt и .lrc рядом с ним) и разборы (.notes.json,
 * собранные при сборке в один track-notes.json). Загрузка — через
 * fetchTextFile: один и тот же файл плеер, страница трека и поиск получают
 * одним запросом.
 */

const baseName = (track: Track) => track.lyricsFile.replace(/\.[^/.]+$/, '')

export function lrcUrl(release: Release, track: Track): string {
    return buildAssetUrl(release.lyricsPath, baseName(track) + '.lrc')
}

export function txtUrl(release: Release, track: Track): string {
    return buildAssetUrl(release.lyricsPath, track.lyricsFile)
}

/** Синхротекст трека или пустая строка. */
export function fetchTrackLrc(release: Release, track: Track): Promise<string> {
    return fetchTextFile(lrcUrl(release, track))
}

/** Текст трека или пустая строка. */
export function fetchTrackTxt(release: Release, track: Track): Promise<string> {
    return fetchTextFile(txtUrl(release, track))
}

/** Ключи файлов в собранных lyrics-index.json и track-notes.json — пути от корня. */
export function lrcKey(release: Release, track: Track): string {
    return release.lyricsPath + baseName(track) + '.lrc'
}

export function txtKey(release: Release, track: Track): string {
    return release.lyricsPath + track.lyricsFile
}

export function notesKey(release: Release, track: Track): string {
    return release.lyricsPath + baseName(track) + '.notes.json'
}

const TRACK_NOTES_URL = `${import.meta.env.BASE_URL}track-notes.json`

// Разборы и описания подгружаются одним файлом на весь сайт и кэшируются.
let notesPromise: Promise<Record<string, unknown>> | null = null

export function loadTrackNotes(): Promise<Record<string, unknown>> {
    if (!notesPromise) {
        // no-cache: дешёвая проверка по ETag, чтобы разборы из админки
        // были видны сразу, а не через 10 минут HTTP-кэша GitHub Pages.
        notesPromise = fetch(TRACK_NOTES_URL, { cache: 'no-cache' })
            .then((res) => (res.ok ? res.json() : {}))
            .then((data: unknown) => (data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}))
            .catch(() => ({}))
    }
    return notesPromise
}
