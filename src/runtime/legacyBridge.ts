export type LyricsMode = 'text' | 'karaoke'
export type PageName = 'home' | 'chart' | 'release'

// Контракт минимального публичного API legacy-слоя,
// который разрешено вызывать из Vue-компонентов.
export interface LegacyAppApi {
    setLyricsMode(mode: LyricsMode): void
    toggleFsLyrics(): void
    closeFsPlayer(): void
    seekTrackFs(event: MouseEvent): void
    prevTrack(): void
    togglePlay(): void
    nextTrack(): void
    toggleMute(): void
    seekTrack(event: MouseEvent): void
    openFsPlayer(): void
    openCurrentTrackPage(): void
    closeMiniPlayer(): void
    showPage(name: PageName): void
    toggleFlowMode(): void
    toggleSearchPanel(open?: boolean): void
    playTrackFromPage(releaseId: string, trackIndex: number): void
    handleTrackClick(trackIndex: number): void
}

declare global {
    interface Window {
        App?: Partial<LegacyAppApi>
    }
}

function invoke<K extends keyof LegacyAppApi>(
    method: K,
    ...args: Parameters<LegacyAppApi[K]>
): void {
    // Безопасный вызов: если legacy еще не инициализирован,
    // bridge не бросает исключение и просто пропускает вызов.
    const fn = window.App?.[method]
    if (typeof fn === 'function') {
        ; (fn as (...invokeArgs: Parameters<LegacyAppApi[K]>) => void)(...args)
    }
}

// Единая точка входа из Vue в legacy.
export const legacyBridge = {
    setLyricsMode(mode: LyricsMode) {
        invoke('setLyricsMode', mode)
    },
    toggleFsLyrics() {
        invoke('toggleFsLyrics')
    },
    closeFsPlayer() {
        invoke('closeFsPlayer')
    },
    seekTrackFs(event: MouseEvent) {
        invoke('seekTrackFs', event)
    },
    prevTrack() {
        invoke('prevTrack')
    },
    togglePlay() {
        invoke('togglePlay')
    },
    nextTrack() {
        invoke('nextTrack')
    },
    toggleMute() {
        invoke('toggleMute')
    },
    seekTrack(event: MouseEvent) {
        invoke('seekTrack', event)
    },
    openFsPlayer() {
        invoke('openFsPlayer')
    },
    openCurrentTrackPage() {
        invoke('openCurrentTrackPage')
    },
    closeMiniPlayer() {
        invoke('closeMiniPlayer')
    },
    showPage(name: PageName) {
        invoke('showPage', name)
    },
    toggleFlowMode() {
        invoke('toggleFlowMode')
    },
    toggleSearchPanel(open?: boolean) {
        invoke('toggleSearchPanel', open)
    },
    // Запуск трека по (релиз, индекс) — явно задаёт играющий релиз.
    playTrack(releaseId: string, trackIndex: number) {
        invoke('playTrackFromPage', releaseId, trackIndex)
    },
    // Клик по строке треклиста открытого релиза: тот же трек — пауза, другой — запуск.
    handleTrackClick(trackIndex: number) {
        invoke('handleTrackClick', trackIndex)
    }
}
