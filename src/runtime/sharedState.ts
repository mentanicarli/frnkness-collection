import type { LyricLine, Release } from '@/types'

export interface RuntimeState {
    // Релиз, страница которого открыта на экране (страница релиза или трека).
    // Нужен только интерфейсу страницы; плеер это поле не читает.
    viewedReleaseId: string | null
    // Играющий релиз и трек — состояние плеера. Открытие страниц его не меняет.
    currentRelease: Release | null
    currentReleaseId: string | null
    currentTrackIndex: number
    // Растёт при каждом запуске трека: по нему ответ на засчёт прослушивания
    // отличает «свой» запуск от следующего (в том числе повтор того же трека).
    playSession: number
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
}

// Общая модель состояния runtime.
// Намеренно обычный объект: шаблоны Vue отсюда ничего не читают, поэтому
// прокси Vue только добавлял бы накладные расходы на каждое чтение — в том
// числе в обработчике timeupdate, который ходит сюда несколько раз в секунду.
export const runtimeState: RuntimeState = {
    viewedReleaseId: null,
    currentRelease: null,
    currentReleaseId: null,
    currentTrackIndex: -1,
    playSession: 0,
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
    currentLyricsLrcRaw: ''
}

// Кэши вынесены отдельно, чтобы избежать повторных сетевых/CPU-операций.
export const runtimeCaches = {
    releasePlayCountCache: {} as Record<string, number>
}
