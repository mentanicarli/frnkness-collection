// Плеер в комнате: гость заблокирован (кроме громкости), команды хозяина
// применяются с пересчётом позиции после загрузки трека, а прослушивание
// гостя засчитывается так же, как у обычного слушателя.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/config', () => {
    const track = (rel: string, n: number) => ({ id: `${rel}/t${n}`, num: n, title: `${rel.toUpperCase()}${n}`, file: `${rel}${n}.mp3`, lyricsFile: `0${n}-${rel}${n}.txt` })
    return {
        SUPABASE_URL: '',
        SUPABASE_ANON_KEY: '',
        releases: {
            a: { type: 'album', title: 'A', year: '2026', cover: 'a.jpg', audioPath: 'audio/a/', lyricsPath: 'l/a/', tracks: [track('a', 1), track('a', 2), track('a', 3)] },
            b: { type: 'album', title: 'B', year: '2026', cover: 'b.jpg', audioPath: 'audio/b/', lyricsPath: 'l/b/', tracks: [track('b', 1), track('b', 2)] }
        }
    }
})
vi.mock('../services/colors', () => ({ updatePlayerAccent: vi.fn(async () => {}), updatePageAccent: vi.fn(async () => {}) }))
vi.mock('../services/stats', () => ({ incrementPlayCount: vi.fn(async () => true) }))
vi.mock('../services/lyricsFiles', () => ({
    fetchTrackLrc: vi.fn(() => new Promise<string>(() => {})),
    fetchTrackTxt: vi.fn(() => new Promise<string>(() => {}))
}))

const { incrementPlayCount } = await import('../services/stats')
const { player, karaoke } = await import('../player/state')
const { setAudio } = await import('../player/audio')
const { notice } = await import('../social/notice')
const engine = await import('../player/engine')
const { createListQueue } = await import('../player/queue')

let audio: HTMLAudioElement
let currentTime = 0
let readyState = 0

beforeEach(() => {
    vi.mocked(incrementPlayCount).mockReset().mockResolvedValue(true)
    audio = document.createElement('audio')
    audio.play = vi.fn(() => Promise.resolve())
    audio.pause = vi.fn()
    currentTime = 0
    readyState = 0
    Object.defineProperty(audio, 'currentTime', { get: () => currentTime, set: (v: number) => { currentTime = v }, configurable: true })
    Object.defineProperty(audio, 'readyState', { get: () => readyState, configurable: true })
    Object.defineProperty(audio, 'paused', { value: true, configurable: true, writable: true })
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true })
    setAudio(audio)
    Object.assign(player, {
        queue: null, shuffle: false, currentTrackId: null, currentRelease: null, currentReleaseId: null, currentTrackIndex: -1,
        playSession: 0, isPlaying: false, visible: false, flowModeActive: false, trackCounted: false, trackCountPending: false, roomRole: null
    })
    Object.assign(karaoke, { lines: [], plainText: null, mode: 'text', currentIndex: -1 })
    notice.text = ''
})

const remote = (ids: string[], pos = 0) => ({ ...createListQueue({ kind: 'release', releaseId: 'a' }, ids, pos, () => true)!, controller: 'remote' as const })

describe('гость комнаты', () => {
    it('кнопки плеера заблокированы и показывают подсказку', () => {
        engine.playTrackByRef('a', 0)
        const before = { id: player.currentTrackId, session: player.playSession, queue: player.queue }
        player.roomRole = 'guest'
        const attempts: [string, () => void][] = [
            ['пауза/играть', () => engine.togglePlay()],
            ['следующий', () => engine.nextTrack()],
            ['предыдущий', () => engine.prevTrack()],
            ['полоса прогресса', () => engine.seekToFraction(0.5)],
            ['строка караоке', () => engine.seekTo(30)],
            ['перемешать', () => engine.toggleShuffle()],
            ['Поток', () => engine.toggleFlowMode()],
            ['поток по избранному', () => engine.startFavoritesFlow('u', ['a/t1'])],
            ['трек релиза', () => engine.playTrackByRef('b', 1)],
            ['трек играющего релиза', () => engine.playTrack(2)],
            ['плейлист', () => engine.playList({ kind: 'playlist', playlistId: 'p', title: 'P' }, ['b/t1'])],
            ['плейлист вперемешку', () => engine.playListShuffled({ kind: 'playlist', playlistId: 'p', title: 'P' }, ['b/t1'])],
            ['закрыть плеер', () => engine.closeMiniPlayer()]
        ]
        for (const [name, run] of attempts) {
            notice.text = ''
            run()
            expect(notice.text, name).toBe(engine.GUEST_HINT)
            expect({ id: player.currentTrackId, session: player.playSession, queue: player.queue }, name).toEqual(before)
        }
        expect(player.visible).toBe(true)
        expect(audio.pause).not.toHaveBeenCalled()
    })

    it('громкость и «выключить звук» работают', () => {
        player.roomRole = 'guest'
        engine.setVolume(0.3)
        expect(audio.volume).toBeCloseTo(0.3)
        engine.toggleMute()
        expect(audio.muted).toBe(true)
        expect(notice.text).toBe('')
    })

    it('хозяин и обычный слушатель управляют плеером как раньше', () => {
        for (const role of [null, 'host'] as const) {
            player.roomRole = role
            engine.playTrackByRef('a', 1)
            expect(player.currentTrackId).toBe('a/t2')
            engine.nextTrack()
            expect(player.currentTrackId).toBe('a/t3')
        }
    })

    it('закончившийся трек гость не переключает сам', () => {
        engine.attachAudio(audio)
        engine.playTrackByRef('a', 0)
        player.roomRole = 'guest'
        const session = player.playSession
        audio.dispatchEvent(new Event('ended'))
        expect(player.playSession).toBe(session)
        expect(notice.text).toBe('')
        player.roomRole = null
        audio.dispatchEvent(new Event('ended'))
        expect(player.playSession).toBe(session + 1)
    })

    it('выход из аккаунта закрывает плеер, даже у гостя', () => {
        engine.playTrackByRef('a', 0)
        player.roomRole = 'guest'
        engine.closeMiniPlayer(true)
        expect(player.visible).toBe(false)
        expect(audio.pause).toHaveBeenCalled()
    })
})

describe('команда хозяина', () => {
    it('новый трек грузится на паузе, позиция считается по загрузке (canplay), а не по команде', () => {
        let wanted = 12_000
        const result = engine.applyRemotePlayback(remote(['a/t2', 'a/t3'], 0), true, () => wanted)
        expect(result).toBe('ok')
        expect(player.currentTrackId).toBe('a/t2')
        expect(player.queue?.controller).toBe('remote')
        expect(audio.src).toContain('audio/a/a2.mp3')
        expect(audio.play).not.toHaveBeenCalled()
        // Пока трек грузится, хозяин ушёл вперёд: ждём canplay и берём свежую позицию.
        wanted = 15_500
        audio.dispatchEvent(new Event('canplay'))
        expect(currentTime).toBeCloseTo(15.5)
        expect(audio.play).toHaveBeenCalledTimes(1)
    })

    it('на паузе хозяина — перематывает, но не включает', () => {
        engine.applyRemotePlayback(remote(['a/t1']), false, () => 42_000)
        audio.dispatchEvent(new Event('canplay'))
        expect(currentTime).toBeCloseTo(42)
        expect(audio.play).not.toHaveBeenCalled()
    })

    it('трек сменился раньше загрузки предыдущего: старая загрузка ничего не делает', () => {
        engine.applyRemotePlayback(remote(['a/t1']), true, () => 1000)
        engine.applyRemotePlayback(remote(['b/t1']), true, () => 9000)
        audio.dispatchEvent(new Event('canplay'))
        expect(currentTime).toBeCloseTo(9)
        expect(audio.play).toHaveBeenCalledTimes(1)
    })

    it('тот же трек не перезагружается; очередь обновляется', () => {
        engine.applyRemotePlayback(remote(['a/t1', 'a/t2']), true, () => 0)
        const session = player.playSession
        engine.applyRemotePlayback(remote(['a/t1', 'a/t2', 'a/t3']), true, () => 0)
        expect(player.playSession).toBe(session)
        expect(player.queue?.trackIds).toEqual(['a/t1', 'a/t2', 'a/t3'])
    })

    it('трека нет в каталоге (старая версия сайта) — «missing-track», без ошибки', () => {
        const result = engine.applyRemotePlayback(remote(['new-release/t1']), true, () => 0)
        expect(result).toBe('missing-track')
        expect(player.currentTrackId).toBeNull()
    })

    it('снимок плеера для хозяина', () => {
        engine.playTrackByRef('a', 1)
        currentTime = 31.4
        readyState = 4
        Object.defineProperty(audio, 'paused', { value: false, configurable: true })
        expect(engine.getPlaybackInfo()).toEqual({ trackId: 'a/t2', positionMs: 31_400, durationMs: 200_000, playing: true, ready: true })
    })
})

describe('статистика гостя', () => {
    it('прослушивание засчитывается гостю после 10 секунд с его user_id (обычным увеличением счётчика)', async () => {
        engine.attachAudio(audio)
        player.roomRole = 'guest'
        engine.applyRemotePlayback(remote(['a/t3'], 0), true, () => 0)
        audio.dispatchEvent(new Event('canplay'))
        Object.defineProperty(audio, 'paused', { value: false, configurable: true })
        // Первые секунды не засчитываются…
        currentTime = 5
        audio.dispatchEvent(new Event('timeupdate'))
        await Promise.resolve()
        expect(incrementPlayCount).not.toHaveBeenCalled()
        // …на 10-й — да, тем же вызовом, что у обычного слушателя (в нём уходит токен гостя → user_id).
        currentTime = 10.2
        audio.dispatchEvent(new Event('timeupdate'))
        await Promise.resolve()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
        expect(incrementPlayCount).toHaveBeenCalledWith('a', 2)
        // Один запуск — одно прослушивание.
        currentTime = 20
        audio.dispatchEvent(new Event('timeupdate'))
        await Promise.resolve()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
        // Следующий трек хозяина — новое прослушивание.
        engine.applyRemotePlayback(remote(['b/t2'], 0), true, () => 0)
        audio.dispatchEvent(new Event('canplay'))
        currentTime = 12
        audio.dispatchEvent(new Event('timeupdate'))
        await Promise.resolve()
        expect(incrementPlayCount).toHaveBeenLastCalledWith('b', 1)
    })
})
