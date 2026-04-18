import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import type { Release, LyricLine, ColorSet } from '@/types'

const DEFAULT_COLOR: ColorSet = {
    hex: 'rgb(103, 114, 131)',
    glow: 'rgba(103, 114, 131, 0.32)',
    soft: 'rgba(103, 114, 131, 0.18)'
}

export const useAppStore = defineStore('app', () => {
    // State
    const currentRelease = ref<Release | null>(null)
    const currentReleaseId = ref<string | null>(null)
    const currentTrackIndex = ref(0)
    const isPlaying = ref(false)
    const trackCounted = ref(false)
    const trackCountPending = ref(false)
    const fsLyricsOpen = ref(false)
    const currentCoverSlot = ref<'a' | 'b'>('a')
    const animationInProgress = ref(false)

    // Lyrics state
    const parsedLyrics = ref<LyricLine[]>([])
    const currentLyricIndex = ref(-1)
    const lyricsMode = ref<'text' | 'karaoke'>('karaoke')
    const preferredLyricsMode = ref<'text' | 'karaoke'>('karaoke')
    const currentLyricsTrackIndex = ref<number | null>(null)
    const currentLyricsPlainText = ref('')
    const currentLyricsLrcRaw = ref('')
    const lyricsIndexReady = ref(false)
    const lyricsIndex = ref<any[]>([])

    // Flow mode
    const flowModeActive = ref(false)

    // Search
    const searchOpen = ref(false)

    // Caching
    const colorCache = reactive<Record<string, [number, number, number]>>({})
    const colorPromiseCache = reactive<Record<string, Promise<[number, number, number]>>>({})
    const releasePlayCountCache = reactive<Record<string, number>>({})

    // UI state
    const pageAccentColor = ref(DEFAULT_COLOR)
    const playerAccentColor = ref(DEFAULT_COLOR)

    // Supabase client
    const dbClient = ref<any>(null)
    const colorThief = ref<any>(null)

    // Setters
    const setCurrentTrack = (releaseId: string, trackIndex: number) => {
        currentReleaseId.value = releaseId
        currentTrackIndex.value = trackIndex
        trackCounted.value = false
        trackCountPending.value = false
    }

    const setIsPlaying = (playing: boolean) => {
        isPlaying.value = playing
    }

    const setFlowMode = (active: boolean) => {
        flowModeActive.value = active
    }

    const setLyricsMode = (mode: 'text' | 'karaoke') => {
        if (!['text', 'karaoke'].includes(mode)) return
        if (mode === 'karaoke' && parsedLyrics.value.length === 0) return
        lyricsMode.value = mode
        preferredLyricsMode.value = mode
    }

    const setPageAccent = (colors: ColorSet) => {
        pageAccentColor.value = colors
    }

    const setPlayerAccent = (colors: ColorSet) => {
        playerAccentColor.value = colors
    }

    const invalidateReleasePlayCount = (releaseId: string) => {
        delete releasePlayCountCache[releaseId]
    }

    return {
        // State
        currentRelease,
        currentReleaseId,
        currentTrackIndex,
        isPlaying,
        trackCounted,
        trackCountPending,
        fsLyricsOpen,
        currentCoverSlot,
        animationInProgress,
        parsedLyrics,
        currentLyricIndex,
        lyricsMode,
        preferredLyricsMode,
        currentLyricsTrackIndex,
        currentLyricsPlainText,
        currentLyricsLrcRaw,
        lyricsIndexReady,
        lyricsIndex,
        flowModeActive,
        searchOpen,
        colorCache,
        colorPromiseCache,
        releasePlayCountCache,
        pageAccentColor,
        playerAccentColor,
        dbClient,
        colorThief,
        // Actions
        setCurrentTrack,
        setIsPlaying,
        setFlowMode,
        setLyricsMode,
        setPageAccent,
        setPlayerAccent,
        invalidateReleasePlayCount
    }
})
