/**
 * Application Type Definitions
 */

export interface Track {
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
    tracks: Track[]
}

export interface Releases {
    [key: string]: Release
}

export interface LyricLine {
    time: number
    text: string
}

export interface SearchResult {
    type: 'release' | 'track' | 'lyric'
    releaseId: string
    title: string
    trackTitle?: string
    trackIndex: number
    line: string
    time: number
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

export interface PlayCountItem {
    track_key: string
    plays: number
}

export interface ChartTrack {
    title: string
    cover: string
    plays: number
    releaseId: string
    trackIndex: number
}
