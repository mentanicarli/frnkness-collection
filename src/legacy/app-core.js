/**
 * Legacy runtime приложения — тонкий оркестратор.
 *
 * Импортирует модули из src/legacy/modules/ и собирает window.App.
 * Вся бизнес-логика живёт в модулях; здесь только инициализация и склейка.
 */
import { createColorsModule } from './modules/colors'
import { createFullscreenModule } from './modules/fullscreen'
import { createLyricsModule } from './modules/lyrics'
import { createPlayerModule } from './modules/player'
import { createChartModule } from './modules/chart'
import { createSearchModule } from './modules/search'
import { createUiModule } from './modules/ui'

export function initLegacyApp(deps = {}) {
    if (window.__legacyAppInitialized) return
    window.__legacyAppInitialized = true

    const {
        config = {},
        shared = {},
        utils = {}
    } = deps

    const {
        SUPABASE_URL = '',
        SUPABASE_ANON_KEY = '',
        createSupabaseClient = null,
        PROMO_RELEASE_ID = '',
        releases = {}
    } = config

    const {
        DEFAULT_COLOR = { hex: 'rgb(103, 114, 131)', glow: 'rgba(103, 114, 131, 0.32)', soft: 'rgba(103, 114, 131, 0.18)' },
        runtimeState = {},
        runtimeCaches = {}
    } = shared

    const state = runtimeState
    const colorCache = runtimeCaches.colorCache || {}
    const colorPromiseCache = runtimeCaches.colorPromiseCache || {}
    const releasePlayCountCache = runtimeCaches.releasePlayCountCache || {}

    // ── DOM cache ──────────────────────────────────────────────────────

    const dom = {}
    const perf = {
        lastProgressPercent: -1,
        lastSecond: -1,
        searchCache: new Map(),
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
        dom.lyricsPanel = $('lyrics-panel')
        dom.downloadContainer = $('download-container')
        dom.downloadBtn = $('download-lyrics-btn')
        dom.lyricsContent = $('lyrics-content')
        dom.videoContainer = $('video-container')
        dom.videoIframe = $('video-iframe')
        dom.volumeSlider = $('volume-slider')
        dom.volWave1 = $('vol-wave-1')
        dom.volWave2 = $('vol-wave-2')
        dom.playPauseBtn = $('play-pause-btn')
        dom.playerCover = $('player-cover')
        dom.lyricsBtn = $('lyrics-btn')
        dom.lyricsBtnMobile = $('lyrics-btn-mobile')
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
        dom.albumsGrid = $('albums-grid')
        dom.singlesGrid = $('singles-grid')
        dom.chartList = $('chart-list')
        dom.tracklist = $('tracklist')
        dom.playerTrack = $('player-track')
        dom.releaseCover = $('release-cover')
        dom.releaseTitle = $('release-title')
        dom.releaseMeta = $('release-meta')
        dom.releasePlays = $('release-plays')
        dom.flowModeBtn = $('flow-mode-btn')
        dom.flowModeLabel = $('flow-mode-label')
        dom.homePromo = $('home-promo')
        dom.searchInput = $('global-search')
        dom.searchResults = $('search-results')
        dom.searchPanel = $('header-search-panel')
        dom.searchToggle = $('search-toggle-btn')
        dom.searchBackdrop = $('search-backdrop')
        dom.albumsSection = dom.albumsGrid ? dom.albumsGrid.closest('section') : null
        dom.singlesSection = dom.singlesGrid ? dom.singlesGrid.closest('section') : null
        dom.lyricsModeSwitch = $('lyrics-mode-switch')
        dom.lyricsModeText = $('lyrics-mode-text')
        dom.lyricsModeKaraoke = $('lyrics-mode-karaoke')
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
                perf.pendingTrackClickGuard = { index, expiresAt: now + 450 }
                modules.player.handleTrackClick(index, 'pointer')
                event.preventDefault()
            }, { passive: false })
        }
    }

    // ── Build context & modules ─────────────────────────────────────────

    const ctx = {
        dom,
        state,
        perf,
        releases,
        DEFAULT_COLOR,
        colorCache,
        colorPromiseCache,
        releasePlayCountCache,
        PROMO_RELEASE_ID,
        utils,
        modules: {}
    }

    const modules = ctx.modules

    modules.colors = createColorsModule(ctx)
    modules.fullscreen = createFullscreenModule(ctx)
    modules.lyrics = createLyricsModule(ctx)
    modules.player = createPlayerModule(ctx)
    modules.chart = createChartModule(ctx)
    modules.search = createSearchModule(ctx)
    modules.ui = createUiModule(ctx)

    // ── window.App ─────────────────────────────────────────────────────

    window.App = {
        openRelease: id => modules.ui.openRelease(id),
        handleTrackClick: (i, src) => modules.player.handleTrackClick(i, src),
        showLyrics: i => modules.lyrics.showLyrics(i),
        setLyricsMode: m => modules.lyrics.setLyricsMode(m),
        toggleFlowMode: () => modules.player.toggleFlowMode(),
        startFlowMode: () => modules.player.startFlowMode(),
        stopFlowMode: () => modules.player.stopFlowMode(),
        openFsPlayer: () => modules.fullscreen.openFsPlayer(),
        closeFsPlayer: () => modules.fullscreen.closeFsPlayer(),
        closeLyrics: () => modules.lyrics.closeLyrics(),
        toggleLyrics: () => modules.lyrics.toggleLyrics(),
        toggleFsLyrics: () => modules.fullscreen.toggleFsLyrics(),
        togglePlay: () => modules.player.togglePlay(),
        prevTrack: () => modules.player.prevTrack(),
        nextTrack: () => modules.player.nextTrack(),
        seekTo: t => modules.player.seekTo(t),
        seekTrack: e => modules.player.seekTrack(e),
        seekTrackFs: e => modules.player.seekTrackFs(e),
        showPage: n => modules.ui.showPage(n),
        playChart: (r, i) => modules.chart.playChart(r, i),
        openSearchResult: (t, r, i, time) => modules.search.openSearchResult(t, r, i, time),
        toggleSearchPanel: s => modules.search.toggleSearchPanel(s),
        toggleMute: () => modules.player.toggleMute(),
        closeMiniPlayer: () => modules.player.closeMiniPlayer()
    }

    // ── Keyboard shortcuts ─────────────────────────────────────────────

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (dom.fsPlayer && dom.fsPlayer.classList.contains('open')) modules.fullscreen.closeFsPlayer()
            else if (dom.searchPanel && dom.searchPanel.classList.contains('open')) modules.search.toggleSearchPanel(false)
            else modules.lyrics.closeLyrics()
        }
        if (e.key === ' ' && !['BUTTON', 'INPUT'].includes(document.activeElement.tagName)) {
            e.preventDefault()
            modules.player.togglePlay()
        }
    })

    // ── Init ───────────────────────────────────────────────────────────

    function init() {
        if (SUPABASE_URL && SUPABASE_ANON_KEY && typeof createSupabaseClient === 'function') {
            state.db = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY)
        }

        // Инициализируем динамические поля state, которые нужны lyrics-модулю.
        state.lyricsNodes = { regular: [], fullscreen: [] }
        state.karaokeHardStart = false

        cacheDomElements()
        modules.ui.renderHome()
        modules.search.initGlobalSearch()
        modules.player.updateFlowButtonState()
        modules.ui.initStaggerAnimation()
        modules.player.setupAudioEvents()
        modules.player.setupVolumeControls()
        modules.ui.initParticles()

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
