import type { Release, Track } from '@/types'

/** Пути файлов трека — по тем же правилам, что и на сайте. */
export function lyricsBase(release: Release, track: Track): string {
    return release.lyricsPath + track.lyricsFile.replace(/\.[^/.]+$/, '')
}

export const txtPath = (release: Release, track: Track) => release.lyricsPath + track.lyricsFile
export const notesPath = (release: Release, track: Track) => lyricsBase(release, track) + '.notes.json'
export const lrcPath = (release: Release, track: Track) => lyricsBase(release, track) + '.lrc'
export const audioPath = (release: Release, track: Track) => release.audioPath + track.file

/** URL файла сайта относительно admin.html (лежат рядом в корне). */
export function siteUrl(path: string): string {
    return encodeURI(`./${path}`)
}
