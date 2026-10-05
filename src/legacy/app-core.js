/**
 * Legacy runtime приложения — тонкий оркестратор.
 *
 * Импортирует модули из src/legacy/modules/ и собирает window.App.
 * Вся бизнес-логика живёт в модулях; здесь только инициализация и склейка.
 */
import * as colors from '../site/services/colors'
import { getDb } from '../site/services/stats'
import { createFullscreenModule } from './modules/fullscreen'
import { createLyricsModule } from './modules/lyrics'
import { createPlayerModule } from './modules/player'
import { createChartModule } from './modules/chart'
import { search, setSearchOpen } from '../site/stores/search'
import { createUiModule } from './modules/ui'
import { createRouterModule } from './modules/router'

export function initLegacyApp(deps = {}) {
    if (window.__legacyAppInitialized) return
    window.__legacyAppInitialized = true

    const {
        config = {},
        shared = {},
        utils = {}
    } = deps

    const {
        PROMO_RELEASE_ID = '',
        SHOW_NEW_RELEASE_PROMO = true,
        ANNOUNCE = null,
        releases = {}
    } = config

    const {
        runtimeState = {},
        runtimeCaches = {}
    } = shared

    const state = runtimeState
    const releasePlayCountCache = runtimeCaches.releasePlayCountCache || {}

    // ── DOM cache ──────────────────────────────────────────────────────

    const dom = {}
    const perf = {
        lastProgressPercent: -1,
        lastSecond: -1,
        preloadedAudio: new Set(),
        pendingTrackClickGuard: null,
        fsLyricsToggleGuardUntil: 0
    }

    function cacheDomElements() {
        const $ = id => document.getElementById(id)
        dom.audio = $('audio-player')
        if (dom.audio) dom.audio.preload = 'auto'
        dom.player = $('player')
        dom.progress = $('progress-bar')
        dom.iconPlay = $('icon-play')
        dom.iconPause = $('icon-pause')
        dom.volumeSlider = $('volume-slider')
        dom.volWave1 = $('vol-wave-1')
        dom.volWave2 = $('vol-wave-2')
        dom.playPauseBtn = $('play-pause-btn')
        dom.playerCover = $('player-cover')
        dom.lyricsBtn = $('lyrics-btn')
        dom.fsPlayer = $('fullscreen-player')
        dom.fsBg = $('fs-bg')
        dom.fsCoverA = $('fs-cover-a')
        dom.fsCoverB = $('fs-cover-b')
        dom.fsPlayBtn = $('fs-play-btn')
        dom.fsIconPlay = $('fs-icon-play')
        dom.fsIconPause = $('fs-icon-pause')
        dom.fsProgress = $('fs-progress-bar')
        dom.fsTimeCurrent = $('fs-time-current')
        dom.fsTimeTotal = $('fs-time-total')
        dom.fsTitle = $('fs-track-title')
        dom.fsLyricsToggle = $('fs-lyrics-toggle')
        dom.fsLyricsBody = $('fs-lyrics-body')
        dom.fsLyricsTitle = $('fs-lyrics-title')
        dom.fsVolumeSlider = $('fs-volume-slider')
        dom.fsVolWave1 = $('fs-vol-wave-1')
        dom.fsVolWave2 = $('fs-vol-wave-2')
        dom.tracklist = $('tracklist')
        dom.playerTrack = $('player-track')
        dom.fsLyricsModeSwitch = $('fs-lyrics-mode-switch')
        dom.fsLyricsModeText = $('fs-lyrics-mode-text')
        dom.fsLyricsModeKaraoke = $('fs-lyrics-mode-karaoke')

        if (dom.tracklist && !dom.tracklist.dataset.pointerBound) {
            dom.tracklist.dataset.pointerBound = 'true'
            dom.tracklist.addEventListener('pointerdown', (event) => {
                if (event.pointerType === 'mouse') return
                const target = event.target
                if (!(target instanceof Element)) return
                if (target.closest('.lyrics-action-btn')) return
                const row = target.closest('.track-row')
                if (!row) return
                const indexRaw = row.getAttribute('data-track-index')
                const index = Number(indexRaw)
                if (!Number.isInteger(index) || index < 0) return
                const now = performance.now()
                // Гард гасит синтетический click после этого pointerdown — только
                // для той же строки того же (открытого) релиза.
                perf.pendingTrackClickGuard = { releaseId: state.viewedReleaseId, index, expiresAt: now + 450 }
                modules.player.handleTrackClick(index, 'pointer')
                event.preventDefault()
            }, { passive: false })
        }
    }

    // ── Build context & modules ─────────────────────────────────────────

    const ctx = {
        dom,
        state,
        getDb,
        perf,
        releases,
        releasePlayCountCache,
        PROMO_RELEASE_ID,
        SHOW_NEW_RELEASE_PROMO,
        ANNOUNCE,
        utils,
        modules: {}
    }

    const modules = ctx.modules

    modules.colors = colors
    modules.fullscreen = createFullscreenModule(ctx)
    modules.lyrics = createLyricsModule(ctx)
    modules.player = createPlayerModule(ctx)
    modules.chart = createChartModule(ctx)
    modules.ui = createUiModule(ctx)
    modules.router = createRouterModule(ctx)

    // ── window.App ─────────────────────────────────────────────────────

    window.App = {
        openRelease: id => modules.router.goRelease(id),
        // Кнопка «Текст» в строке треклиста: трек открытого релиза.
        openTrackPage: i => modules.router.goTrack(state.viewedReleaseId, i),
        openCurrentTrackPage: () => modules.router.goCurrentTrack(),
        playTrackFromPage: (r, i) => modules.player.playTrackByRef(r, i, 'fade'),
        handleTrackClick: (i, src) => modules.player.handleTrackClick(i, src),
        setLyricsMode: m => modules.lyrics.setLyricsMode(m),
        toggleFlowMode: () => modules.player.toggleFlowMode(),
        startFlowMode: () => modules.player.startFlowMode(),
        stopFlowMode: () => modules.player.stopFlowMode(),
        openFsPlayer: () => modules.fullscreen.openFsPlayer(),
        closeFsPlayer: () => modules.fullscreen.closeFsPlayer(),
        toggleFsLyrics: () => modules.fullscreen.toggleFsLyrics(),
        togglePlay: () => modules.player.togglePlay(),
        prevTrack: () => modules.player.prevTrack(),
        nextTrack: () => modules.player.nextTrack(),
        seekTo: t => modules.player.seekTo(t),
        seekTrack: e => modules.player.seekTrack(e),
        seekTrackFs: e => modules.player.seekTrackFs(e),
        showPage: n => {
            if (n === 'home') modules.router.goHome()
            else if (n === 'chart') modules.router.goChart()
            else modules.ui.showPage(n)
        },
        // Строка из поиска с таймкодом: трек с этого места, полноэкранный плеер в караоке.
        playLyricAt: (r, i, time) => {
            modules.player.playTrackByRef(r, i, 'fade')
            modules.player.seekTo(time)
            modules.lyrics.revealKaraokeAt(time)
            modules.fullscreen.openFsLyrics()
        },
        toggleMute: () => modules.player.toggleMute(),
        closeMiniPlayer: () => modules.player.closeMiniPlayer()
    }

    // ── Keyboard shortcuts ─────────────────────────────────────────────

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (dom.fsPlayer && dom.fsPlayer.classList.contains('open')) modules.fullscreen.closeFsPlayer()
            else if (search.open) setSearchOpen(false)
        }
        const activeTag = document.activeElement ? document.activeElement.tagName : ''
        if (e.key === ' ' && !['BUTTON', 'INPUT', 'TEXTAREA'].includes(activeTag)) {
            e.preventDefault()
            modules.player.togglePlay()
        }
    })

    // ── Экран блокировки (Media Session) ───────────────────────────────

    // Кнопки на экране блокировки, в шторке и на наушниках делают то же, что
    // кнопки плеера: «следующий» в Потоке — случайный трек.
    function setupLockScreenControls() {
        if (typeof utils.setupMediaSession !== 'function' || !dom.audio) return
        utils.setupMediaSession({
            audio: dom.audio,
            getNowPlaying: () => {
                const release = state.currentRelease
                const track = release && release.tracks[state.currentTrackIndex]
                return track ? { title: track.title, album: release.title, cover: release.cover } : null
            },
            play: () => { if (dom.audio.paused) modules.player.togglePlay() },
            pause: () => { if (!dom.audio.paused) modules.player.togglePlay() },
            next: () => modules.player.nextTrack(),
            prev: () => modules.player.prevTrack(),
            seek: time => { dom.audio.currentTime = time }
        })
    }

    // ── Сессии прослушивания (дослушивают или пропускают) ──────────────

    function setupListenSessions() {
        if (typeof utils.setupListenTracker !== 'function' || typeof utils.sendListenSession !== 'function' || !dom.audio) return
        utils.setupListenTracker({
            audio: dom.audio,
            getTrackKey: () => {
                const release = state.currentRelease
                const index = state.currentTrackIndex
                if (!release || !state.currentReleaseId || !Number.isInteger(index) || !release.tracks[index]) return null
                return `${state.currentReleaseId}-${index}`
            },
            send: utils.sendListenSession
        })
    }

    // ── Init ───────────────────────────────────────────────────────────

    function init() {
        // Инициализируем динамические поля state, которые нужны lyrics-модулю.
        state.lyricsNodes = { regular: [], fullscreen: [] }
        state.karaokeHardStart = false

        cacheDomElements()
        modules.router.start()
        modules.player.updateFlowButtonState()
        modules.ui.initStaggerAnimation()
        modules.player.setupAudioEvents()
        modules.player.setupVolumeControls()
        setupLockScreenControls()
        setupListenSessions()

        // Прогрев первых обложек через requestIdleCallback.
        modules.player.runWhenIdle(() => {
            const firstItems = Object.values(releases).slice(0, 5)
            firstItems.forEach(release => {
                const img = new Image()
                img.decoding = 'async'
                img.src = release.cover
            })
        })
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init)
    } else {
        init()
    }
}
