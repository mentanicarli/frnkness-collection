import type { ColorSet, LyricLine, Release } from '@/types'

// Базовый акцент, который используется до вычисления цвета из обложки.
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
    // Временные any: зависимости приходят из legacy/CDN и будут типизированы позже.
    colorThief: any
    db: any
}

// Общая модель состояния runtime.
// Намеренно обычный объект: шаблоны Vue отсюда ничего не читают, поэтому
// прокси Vue только добавлял бы накладные расходы на каждое чтение — в том
// числе в обработчике timeupdate, который ходит сюда несколько раз в секунду.
export const runtimeState: RuntimeState = {
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
}

// Кэши вынесены отдельно, чтобы избежать повторных сетевых/CPU-операций.
export const runtimeCaches = {
    colorCache: {} as Record<string, [number, number, number]>,
    colorPromiseCache: {} as Record<string, Promise<[number, number, number]>>,
    releasePlayCountCache: {} as Record<string, number>
}
