/**
 * Базовые доменные типы приложения.
 */

export interface Track {
    /** Постоянный id «<releaseId>/<slug>»; не меняется никогда. */
    id: string
    num: number
    title: string
    file: string
    lyricsFile: string
}

export interface Release {
    type: 'album' | 'single'
    title: string
    year: string
    cover: string
    audioPath: string
    lyricsPath: string
    lyricsBookPath?: string
    videoUrl?: string
    releaseDate?: string
    upcoming?: boolean
    tracks: Track[]
}

export interface Releases {
    [key: string]: Release
}

export interface LyricLine {
    time: number
    text: string
}

export interface TrackRef {
    releaseId: string
    trackIndex: number
}

export interface ColorSet {
    hex: string
    glow: string
    soft: string
}

export interface ChartTrack {
    title: string
    cover: string
    plays: number
    releaseId: string
    trackIndex: number
}

/** Анонс будущего релиза (ещё нет в каталоге). */
export interface Announce {
    enabled: boolean
    title: string
    /** Путь к обложке в images/. */
    cover: string
    /**
     * ISO с +03:00, например 2026-11-01T18:00:00+03:00. Нет поля — дата не
     * объявлена: на главной «Скоро» без таймера, анонс сам не исчезает.
     */
    releaseAt?: string
    text?: string
    url?: string
}

export interface SiteSettings {
    promo: {
        enabled: boolean
        releaseId: string
    }
    /** Необязательный блок: в старых site.json его нет. */
    announce?: Announce
}
