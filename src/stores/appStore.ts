import { defineStore } from 'pinia'
import { ref, toRef } from 'vue'
import type { ColorSet } from '@/types'
import { DEFAULT_COLOR, runtimeCaches, runtimeState } from '@/runtime/sharedState'

export const useAppStore = defineStore('app', () => {
    // Shared runtime state (single source of truth)
    const currentRelease = toRef(runtimeState, 'currentRelease')
    const currentReleaseId = toRef(runtimeState, 'currentReleaseId')
    const currentTrackIndex = toRef(runtimeState, 'currentTrackIndex')
    const isPlaying = toRef(runtimeState, 'isPlaying')
    const trackCounted = toRef(runtimeState, 'trackCounted')
    const trackCountPending = toRef(runtimeState, 'trackCountPending')
    const fsLyricsOpen = toRef(runtimeState, 'fsLyricsOpen')
    const currentCoverSlot = toRef(runtimeState, 'currentCoverSlot')
    const animationInProgress = toRef(runtimeState, 'animationInProgress')
    const parsedLyrics = toRef(runtimeState, 'parsedLyrics')
    const currentLyricIndex = toRef(runtimeState, 'currentLyricIndex')
    const lyricsMode = toRef(runtimeState, 'lyricsMode')
    const preferredLyricsMode = toRef(runtimeState, 'preferredLyricsMode')
    const currentLyricsTrackIndex = toRef(runtimeState, 'currentLyricsTrackIndex')
    const currentLyricsPlainText = toRef(runtimeState, 'currentLyricsPlainText')
    const currentLyricsLrcRaw = toRef(runtimeState, 'currentLyricsLrcRaw')
    const lyricsIndexReady = toRef(runtimeState, 'lyricsIndexReady')
    const lyricsIndex = toRef(runtimeState, 'lyricsIndex')
    const flowModeActive = toRef(runtimeState, 'flowModeActive')
    const searchOpen = toRef(runtimeState, 'searchOpen')

    // Shared caches
    const colorCache = runtimeCaches.colorCache
    const colorPromiseCache = runtimeCaches.colorPromiseCache
    const releasePlayCountCache = runtimeCaches.releasePlayCountCache

    // UI state
    const pageAccentColor = ref(DEFAULT_COLOR)
    const playerAccentColor = ref(DEFAULT_COLOR)

    // Supabase client
    const dbClient = toRef(runtimeState, 'db')
    const colorThief = toRef(runtimeState, 'colorThief')

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
