import { reactive } from 'vue'
import type { ColorSet, LyricLine, Release } from '@/types'

export const DEFAULT_COLOR: ColorSet = {
    hex: 'rgb(103, 114, 131)',
    glow: 'rgba(103, 114, 131, 0.32)',
    soft: 'rgba(103, 114, 131, 0.18)'
}

export interface RuntimeState {
    currentRelease: Release | null
    currentReleaseId: string | null
    currentTrackIndex: number
    isPlaying: boolean
    trackCounted: boolean
    trackCountPending: boolean
    fsLyricsOpen: boolean
    currentCoverSlot: 'a' | 'b'
    animationInProgress: boolean
    parsedLyrics: LyricLine[]
    lyricsNodes: { regular: HTMLElement[]; fullscreen: HTMLElement[] }
    currentLyricIndex: number
    flowModeActive: boolean
    searchOpen: boolean
    lyricsMode: 'text' | 'karaoke'
    preferredLyricsMode: 'text' | 'karaoke'
    currentLyricsTrackIndex: number | null
    currentLyricsPlainText: string
    currentLyricsLrcRaw: string
    lyricsIndex: Array<Record<string, any>>
    lyricsIndexReady: boolean
    lyricsIndexPromise: Promise<void> | null
    colorThief: any
    db: any
}

export const runtimeState = reactive<RuntimeState>({
    currentRelease: null,
    currentReleaseId: null,
    currentTrackIndex: 0,
    isPlaying: false,
    trackCounted: false,
    trackCountPending: false,
    fsLyricsOpen: false,
    currentCoverSlot: 'a',
    animationInProgress: false,
    parsedLyrics: [],
    lyricsNodes: { regular: [], fullscreen: [] },
    currentLyricIndex: -1,
    flowModeActive: false,
    searchOpen: false,
    lyricsMode: 'karaoke',
    preferredLyricsMode: 'karaoke',
    currentLyricsTrackIndex: null,
    currentLyricsPlainText: '',
    currentLyricsLrcRaw: '',
    lyricsIndex: [],
    lyricsIndexReady: false,
    lyricsIndexPromise: null,
    colorThief: null,
    db: null
})

export const runtimeCaches = {
    colorCache: reactive<Record<string, [number, number, number]>>({}),
    colorPromiseCache: reactive<Record<string, Promise<[number, number, number]>>>({}),
    releasePlayCountCache: reactive<Record<string, number>>({})
}
