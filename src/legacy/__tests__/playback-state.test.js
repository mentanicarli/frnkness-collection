// Разделение «открытого» и «играющего» релиза: засчёт прослушиваний
// и клик по треклисту не должны зависеть от того, какая страница открыта.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChartModule } from '../modules/chart'
import { createPlayerModule } from '../modules/player'

const releases = {
    a: { type: 'album', title: 'A', cover: 'a.jpg', audioPath: 'audio/a/', lyricsPath: 'l/a/', tracks: [
        { num: 1, title: 'A1', file: 'a1.mp3', lyricsFile: '01-a1.txt' },
        { num: 2, title: 'A2', file: 'a2.mp3', lyricsFile: '02-a2.txt' },
        { num: 3, title: 'A3', file: 'a3.mp3', lyricsFile: '03-a3.txt' }
    ] },
    b: { type: 'album', title: 'B', cover: 'b.jpg', audioPath: 'audio/b/', lyricsPath: 'l/b/', tracks: [
        { num: 1, title: 'B1', file: 'b1.mp3', lyricsFile: '01-b1.txt' },
        { num: 2, title: 'B2', file: 'b2.mp3', lyricsFile: '02-b2.txt' }
    ] }
}

function makeState(overrides = {}) {
    return {
        viewedReleaseId: null, currentRelease: null, currentReleaseId: null, currentTrackIndex: -1,
        playSession: 0, isPlaying: false, trackCounted: false, trackCountPending: false,
        flowModeActive: false, ...overrides
    }
}

function makeCtx(state, rpc) {
    const audio = document.createElement('audio')
    audio.play = vi.fn(() => Promise.resolve())
    audio.pause = vi.fn()
    const player = document.createElement('div')
    const ctx = {
        dom: { audio, player, playerCover: document.createElement('div'), releasePlays: null },
        state,
        perf: { pendingTrackClickGuard: null, preloadedAudio: new Set() },
        releases,
        releasePlayCountCache: {},
        utils: { buildAssetUrl: (p, f) => p + f, formatTime: () => '0:00', parseTrackKey: () => null, escapeHtml: s => s },
        getDb: async () => ({ rpc }),
        modules: {
            fullscreen: { updateFullscreen: vi.fn(), updateFsPlayPauseIcon: vi.fn() },
            colors: { updatePlayerAccent: vi.fn(), updatePageAccent: vi.fn() },
            lyrics: { loadLyrics: vi.fn(), updateKaraoke: vi.fn() }
        }
    }
    ctx.modules.chart = createChartModule(ctx)
    ctx.modules.player = createPlayerModule(ctx)
    return ctx
}

describe('incrementPlayCount', () => {
    let rpc
    beforeEach(() => { rpc = vi.fn(async () => ({ error: null })) })

    it('не отправляет ключ, если трек не выбран (индекс -1)', async () => {
        const ctx = makeCtx(makeState({ currentReleaseId: 'a', currentRelease: releases.a, currentTrackIndex: -1 }), rpc)
        await ctx.modules.chart.incrementPlayCount()
        expect(rpc).not.toHaveBeenCalled()
    })

    it('не отправляет ключ для несуществующего трека', async () => {
        const ctx = makeCtx(makeState({ currentReleaseId: 'a', currentRelease: releases.a, currentTrackIndex: 9 }), rpc)
        await ctx.modules.chart.incrementPlayCount()
        expect(rpc).not.toHaveBeenCalled()
    })

    it('засчитывает играющему треку, даже если открыт другой релиз', async () => {
        const state = makeState({ viewedReleaseId: 'b', currentReleaseId: 'a', currentRelease: releases.a, currentTrackIndex: 1 })
        const ctx = makeCtx(state, rpc)
        await ctx.modules.chart.incrementPlayCount()
        expect(rpc).toHaveBeenCalledWith('increment_play_count', { track_key_input: 'a-1' })
        expect(state.trackCounted).toBe(true)
    })

    it('ответ старого запуска не помечает засчитанным новый запуск', async () => {
        let resolveRpc
        rpc = vi.fn(() => new Promise(r => { resolveRpc = r }))
        const state = makeState({ currentReleaseId: 'a', currentRelease: releases.a, currentTrackIndex: 0, playSession: 1 })
        const ctx = makeCtx(state, rpc)
        const pending = ctx.modules.chart.incrementPlayCount()
        await vi.waitFor(() => expect(rpc).toHaveBeenCalled())
        // пока запрос в пути, запускается следующий трек
        ctx.modules.player.playTrack(1, 'next')
        resolveRpc({ error: null })
        await pending
        expect(rpc).toHaveBeenCalledWith('increment_play_count', { track_key_input: 'a-0' })
        expect(state.trackCounted).toBe(false)
        expect(state.trackCountPending).toBe(false)
    })
})

describe('открытый и играющий релиз', () => {
    it('открытие другого релиза не меняет next: играет следующий трек того же релиза', () => {
        const state = makeState()
        const ctx = makeCtx(state, vi.fn())
        ctx.modules.player.playTrackByRef('a', 1)
        state.viewedReleaseId = 'b' // как делает renderRelease('b')
        ctx.modules.player.nextTrack()
        expect(state.currentReleaseId).toBe('a')
        expect(state.currentTrackIndex).toBe(2)
        expect(ctx.dom.audio.src).toContain('audio/a/a3.mp3')
    })

    it('клик по треку открытого релиза запускает его, а не тот же индекс играющего', () => {
        const state = makeState()
        const ctx = makeCtx(state, vi.fn())
        ctx.modules.player.playTrackByRef('a', 1)
        state.viewedReleaseId = 'b'
        ctx.modules.player.handleTrackClick(1)
        expect(state.currentReleaseId).toBe('b')
        expect(state.currentTrackIndex).toBe(1)
        expect(ctx.dom.audio.src).toContain('audio/b/b2.mp3')
    })

    it('клик по играющему треку на его же странице — пауза, а не перезапуск', () => {
        const state = makeState()
        const ctx = makeCtx(state, vi.fn())
        ctx.modules.player.playTrackByRef('a', 1)
        const session = state.playSession
        state.viewedReleaseId = 'a'
        Object.defineProperty(ctx.dom.audio, 'paused', { value: false, configurable: true })
        ctx.modules.player.handleTrackClick(1)
        expect(ctx.dom.audio.pause).toHaveBeenCalled()
        expect(state.playSession).toBe(session)
    })

    it('подсветка строки — только когда открыт играющий релиз', () => {
        const state = makeState()
        const ctx = makeCtx(state, vi.fn())
        document.body.innerHTML = '<div id="tracklist">' +
            [0, 1, 2].map(i => `<div class="track-row" data-track-index="${i}"></div>`).join('') + '</div>'
        ctx.modules.player.playTrackByRef('a', 1)
        state.viewedReleaseId = 'b'
        ctx.modules.player.syncTracklistState()
        expect(document.querySelectorAll('.track-row.playing')).toHaveLength(0)
        state.viewedReleaseId = 'a'
        ctx.modules.player.syncTracklistState()
        const playing = document.querySelectorAll('.track-row.playing')
        expect(playing).toHaveLength(1)
        expect(playing[0].dataset.trackIndex).toBe('1')
    })
})
