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
        expect(engine.getPlaybackInfo()).toEqual({ trackId: 'a/t2', positionMs: 31_400, durationMs: 200_000, playing: true, ready: true, rate: 1 })
    })
})

/** Слушаем seconds секунд подряд: timeupdate раз в четверть секунды, звук идёт (не пауза). */
function listen(seconds: number, from = currentTime): void {
    Object.defineProperty(audio, 'paused', { value: false, configurable: true, writable: true })
    for (let t = 0.25; t <= seconds + 1e-9; t += 0.25) {
        currentTime = from + t
        audio.dispatchEvent(new Event('timeupdate'))
    }
}
const settleCount = () => new Promise<void>((r) => setTimeout(r, 0))

describe('статистика участника комнаты', () => {
    beforeEach(() => {
        engine.attachAudio(audio)
    })

    it('гость: прослушивание засчитывается после 10 секунд его звука, тем же вызовом, что у обычного слушателя', async () => {
        player.roomRole = 'guest'
        engine.applyRemotePlayback(remote(['a/t3'], 0), true, () => 0)
        audio.dispatchEvent(new Event('canplay'))
        listen(9.5)
        await settleCount()
        expect(incrementPlayCount).not.toHaveBeenCalled()
        listen(1, 9.5)
        await settleCount()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
        expect(incrementPlayCount).toHaveBeenCalledWith('a', 2)
        // Один запуск — одно прослушивание.
        listen(30, 10.5)
        await settleCount()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
        // Следующий трек хозяина — новое прослушивание.
        engine.applyRemotePlayback(remote(['b/t2'], 0), true, () => 0)
        audio.dispatchEvent(new Event('canplay'))
        currentTime = 0
        listen(10.5, 0)
        await settleCount()
        expect(incrementPlayCount).toHaveBeenLastCalledWith('b', 1)
        expect(incrementPlayCount).toHaveBeenCalledTimes(2)
    })

    it('гость вошёл посреди трека: счёт — после 10 секунд его собственного звука, а не сразу по позиции', async () => {
        player.roomRole = 'guest'
        engine.applyRemotePlayback(remote(['a/t1'], 0), true, () => 120_000)
        audio.dispatchEvent(new Event('canplay'))
        expect(currentTime).toBeCloseTo(120)
        // Перемотка на 2:00 и первые тики: позиция уже далеко за 10 с, но слушали ещё ничего.
        listen(0.25, 120)
        listen(8, 120.25)
        await settleCount()
        expect(incrementPlayCount).not.toHaveBeenCalled()
        listen(2.5, 128.25)
        await settleCount()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
        expect(incrementPlayCount).toHaveBeenCalledWith('a', 0)
    })

    it('перемотка хозяина вперёд секунд не добавляет, назад — не даёт второго засчёта, пауза время не копит', async () => {
        player.roomRole = 'guest'
        engine.applyRemotePlayback(remote(['a/t1'], 0), true, () => 0)
        audio.dispatchEvent(new Event('canplay'))
        listen(6)
        // Хозяин перемотал на 1:30: следующий timeupdate — скачок, он не прослушивание.
        currentTime = 90
        audio.dispatchEvent(new Event('seeking'))
        audio.dispatchEvent(new Event('timeupdate'))
        await settleCount()
        expect(incrementPlayCount).not.toHaveBeenCalled()
        // Пауза: тики идут при paused — секунды не копятся.
        Object.defineProperty(audio, 'paused', { value: true, configurable: true, writable: true })
        for (let i = 0; i < 40; i++) {
            currentTime += 0.25
            audio.dispatchEvent(new Event('timeupdate'))
        }
        await settleCount()
        expect(incrementPlayCount).not.toHaveBeenCalled()
        // Доигрывает недостающие 4 секунды — засчитано.
        listen(4.5, currentTime)
        await settleCount()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
        // Хозяин вернулся в начало и играет снова тот же запуск: второго засчёта нет.
        currentTime = 0
        audio.dispatchEvent(new Event('seeking'))
        listen(30, 0)
        await settleCount()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
    })

    it('переподключение гостя (то же состояние хозяина, тот же трек) запуск не сбрасывает: ни двойного засчёта, ни потери', async () => {
        player.roomRole = 'guest'
        engine.applyRemotePlayback(remote(['a/t1', 'a/t2']), true, () => 0)
        audio.dispatchEvent(new Event('canplay'))
        listen(6)
        const session = player.playSession
        // Связь моргнула, пришло состояние с тем же треком.
        engine.applyRemotePlayback(remote(['a/t1', 'a/t2', 'a/t3']), true, () => 6000)
        expect(player.playSession).toBe(session)
        listen(5, 6)
        await settleCount()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
        engine.applyRemotePlayback(remote(['a/t1', 'a/t2', 'a/t3']), true, () => 11_000)
        listen(20, 11)
        await settleCount()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
    })

    it('хозяин считается так же, как гость: свои 10 секунд звука', async () => {
        player.roomRole = 'host'
        engine.playTrackByRef('a', 1)
        listen(9.75)
        await settleCount()
        expect(incrementPlayCount).not.toHaveBeenCalled()
        listen(0.5, 9.75)
        await settleCount()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
        expect(incrementPlayCount).toHaveBeenCalledWith('a', 1)
    })

    it('при скорости 1,04 (подстройка) секунды считаются по звуку, без потерь', async () => {
        audio.playbackRate = 1.04
        engine.playTrackByRef('a', 0)
        for (let i = 1; i <= 40; i++) {
            Object.defineProperty(audio, 'paused', { value: false, configurable: true, writable: true })
            currentTime = i * 0.26
            audio.dispatchEvent(new Event('timeupdate'))
        }
        await settleCount()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
    })
})

describe('выход из комнаты: плеер сбрасывается полностью', () => {
    function playSomething() {
        engine.attachAudio(audio)
        engine.playTrackByRef('a', 1)
        karaoke.fsOpen = true
        karaoke.fsLyricsOpen = true
        listen(3)
    }

    it('звук остановлен, очередь и трек очищены, мини-плеер и полноэкранный режим закрыты', () => {
        playSomething()
        player.roomRole = 'guest'
        expect(player.visible).toBe(true)
        player.roomRole = null
        engine.resetPlayer()
        expect(audio.pause).toHaveBeenCalled()
        expect(audio.hasAttribute('src')).toBe(false)
        expect(player).toMatchObject({
            queue: null, currentTrackId: null, currentRelease: null, currentReleaseId: null, currentTrackIndex: -1,
            isPlaying: false, visible: false, flowModeActive: false, trackCounted: false, playback: 'ok', progress: 0, currentSecond: 0
        })
        expect(Number.isNaN(player.duration)).toBe(true)
        expect(karaoke.fsOpen).toBe(false)
        expect(karaoke.fsLyricsOpen).toBe(false)
        expect(engine.getPlaybackInfo()).toMatchObject({ trackId: null, playing: false })
    })

    it('загрузка трека, начатая до выхода, после выхода ничего не перематывает и не запускает', () => {
        engine.applyRemotePlayback(remote(['a/t1']), true, () => 33_000)
        engine.resetPlayer()
        vi.mocked(audio.play).mockClear()
        currentTime = 0
        audio.dispatchEvent(new Event('canplay'))
        expect(currentTime).toBe(0)
        expect(audio.play).not.toHaveBeenCalled()
    })

    it('после сброса обычный плеер работает: любой трек включается сразу', () => {
        playSomething()
        engine.resetPlayer()
        vi.mocked(audio.play).mockClear()
        engine.playTrackByRef('b', 0)
        expect(player.currentTrackId).toBe('b/t1')
        expect(player.visible).toBe(true)
        expect(audio.src).toContain('audio/b/')
        expect(audio.play).toHaveBeenCalledTimes(1)
        expect(player.queue?.controller).toBe('local')
        engine.nextTrack()
        expect(player.currentTrackId).toBe('b/t2')
    })

    it('незавершённый засчёт не относится к новому запуску: после сброса счёт начинается с нуля', async () => {
        playSomething()
        listen(6, 3) // 9 секунд из 10: до засчёта не хватило
        engine.resetPlayer()
        engine.playTrackByRef('b', 0)
        currentTime = 0
        listen(5, 0)
        await settleCount()
        expect(incrementPlayCount).not.toHaveBeenCalled()
    })
})

describe('хозяин: старт по расписанию', () => {
    const hook = () => ({ start: vi.fn(), pending: vi.fn(() => false), cancel: vi.fn() })

    it('«играть» и новый трек отдаются комнате, звук сам не запускается', () => {
        const h = hook()
        engine.attachAudio(audio)
        engine.setHostHook(h)
        player.roomRole = 'host'
        engine.playTrackByRef('a', 0)
        expect(h.start).toHaveBeenCalledWith({ gapless: false })
        expect(audio.play).toHaveBeenCalledTimes(1) // единственный play — прогрев элемента для iPhone, он сразу ставится на паузу
        expect(audio.pause).toHaveBeenCalled()
        expect(player.isPlaying).toBe(true) // кнопка показывает «играет»
        // Комната пускает звук в назначенный момент.
        vi.mocked(audio.play).mockClear()
        void engine.playRemote()
        expect(audio.play).toHaveBeenCalledTimes(1)
        engine.setHostHook(null)
    })

    it('трек сменился сам (конец предыдущего) — старт без запаса, gapless', () => {
        const h = hook()
        engine.attachAudio(audio)
        engine.setHostHook(h)
        player.roomRole = 'host'
        engine.playTrackByRef('a', 0)
        h.start.mockClear()
        audio.dispatchEvent(new Event('ended'))
        expect(player.currentTrackId).toBe('a/t2')
        expect(h.start).toHaveBeenCalledWith({ gapless: true })
        engine.setHostHook(null)
    })

    it('пауза во время ожидания старта отменяет его у всех', () => {
        const h = hook()
        h.pending.mockReturnValue(true)
        engine.attachAudio(audio)
        engine.setHostHook(h)
        player.roomRole = 'host'
        engine.playTrackByRef('a', 0)
        h.start.mockClear()
        engine.togglePlay()
        expect(h.cancel).toHaveBeenCalledTimes(1)
        expect(h.start).not.toHaveBeenCalled()
        expect(player.isPlaying).toBe(false)
        engine.setHostHook(null)
    })

    it('гость и обычный слушатель комнаты не касаются: звук запускается сразу', () => {
        const h = hook()
        engine.attachAudio(audio)
        engine.setHostHook(h)
        player.roomRole = null
        engine.playTrackByRef('a', 0)
        expect(h.start).not.toHaveBeenCalled()
        expect(audio.play).toHaveBeenCalledTimes(1)
        engine.setHostHook(null)
    })

    it('подстройка скорости и предзагрузка следующего трека', () => {
        engine.setPlaybackRate(1.04)
        expect(audio.playbackRate).toBeCloseTo(1.04)
        engine.setPlaybackRate(Number.NaN)
        engine.setPlaybackRate(5)
        expect(audio.playbackRate).toBeCloseTo(1.04)
        expect(engine.getPlaybackInfo().rate).toBeCloseTo(1.04)
        expect(() => engine.preloadRoomTrack('a/t2')).not.toThrow()
        expect(() => engine.preloadRoomTrack('gone/none')).not.toThrow()
    })
})
