// Плеер: «открытый» и «играющий» релиз, засчёт прослушиваний, касание
// треклиста, загрузка текста и подсветка строк караоке.
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

// Ответы на запросы текстов задаёт тест.
const files = new Map<string, { promise: Promise<string>; resolve: (v: string) => void }>()
function file(url: string) {
    if (!files.has(url)) {
        let resolve!: (v: string) => void
        const promise = new Promise<string>((r) => { resolve = r })
        files.set(url, { promise, resolve })
    }
    return files.get(url)!
}
vi.mock('../services/lyricsFiles', () => ({
    fetchTrackLrc: vi.fn((r: { lyricsPath: string }, t: { lyricsFile: string }) => file(r.lyricsPath + t.lyricsFile.replace('.txt', '.lrc')).promise),
    fetchTrackTxt: vi.fn((r: { lyricsPath: string }, t: { lyricsFile: string }) => file(r.lyricsPath + t.lyricsFile).promise)
}))

const { incrementPlayCount } = await import('../services/stats')
const { fetchTrackLrc, fetchTrackTxt } = await import('../services/lyricsFiles')
const { player, karaoke, isTrackHighlighted } = await import('../player/state')
const { setAudio } = await import('../player/audio')
const { view } = await import('../stores/view')
const engine = await import('../player/engine')
const lyrics = await import('../player/karaoke')

let audio: HTMLAudioElement

beforeEach(() => {
    vi.mocked(incrementPlayCount).mockReset().mockResolvedValue(true)
    files.clear()
    audio = document.createElement('audio')
    audio.play = vi.fn(() => Promise.resolve())
    audio.pause = vi.fn()
    audio.load = vi.fn()
    setAudio(audio)
    Object.assign(player, {
        queue: null, shuffle: false, currentTrackId: null,
        currentRelease: null, currentReleaseId: null, currentTrackIndex: -1, playSession: 0, isPlaying: false,
        visible: false, flowModeActive: false, trackCounted: false, trackCountPending: false
    })
    Object.assign(karaoke, { lines: [], plainText: null, mode: 'karaoke', currentIndex: -1, gradient: false, hardStart: false })
    view.viewedReleaseId = null
})

const setPaused = (paused: boolean) => Object.defineProperty(audio, 'paused', { value: paused, configurable: true })

describe('засчёт прослушивания', () => {
    it('не отправляет ключ, если трек не выбран или его нет', async () => {
        Object.assign(player, { currentReleaseId: 'a', currentTrackIndex: -1 })
        await engine.countPlay()
        Object.assign(player, { currentReleaseId: 'a', currentTrackIndex: 9 })
        await engine.countPlay()
        expect(incrementPlayCount).not.toHaveBeenCalled()
    })

    it('засчитывает играющему треку, даже если открыт другой релиз', async () => {
        engine.playTrackByRef('a', 1)
        view.viewedReleaseId = 'b'
        await engine.countPlay()
        expect(incrementPlayCount).toHaveBeenCalledWith('a', 1)
        expect(player.trackCounted).toBe(true)
        // Второй раз тот же запуск не засчитывается.
        await engine.countPlay()
        expect(incrementPlayCount).toHaveBeenCalledTimes(1)
    })

    it('ответ старого запуска не помечает засчитанным новый запуск', async () => {
        let resolve!: (v: boolean) => void
        vi.mocked(incrementPlayCount).mockImplementation(() => new Promise((r) => { resolve = r }))
        engine.playTrackByRef('a', 0)
        const pending = engine.countPlay()
        expect(player.trackCountPending).toBe(true)
        // пока запрос в пути, запускается следующий трек
        engine.playTrack(1, 'next')
        resolve(true)
        await pending
        expect(incrementPlayCount).toHaveBeenCalledWith('a', 0)
        expect(player.trackCounted).toBe(false)
        expect(player.trackCountPending).toBe(false)
    })

    it('база недоступна — не засчитано, попытка повторится', async () => {
        vi.mocked(incrementPlayCount).mockResolvedValue(false)
        engine.playTrackByRef('a', 0)
        await engine.countPlay()
        expect(player.trackCounted).toBe(false)
        expect(player.trackCountPending).toBe(false)
    })
})

describe('открытый и играющий релиз', () => {
    it('открытие другого релиза не меняет next: играет следующий трек того же релиза', () => {
        engine.playTrackByRef('a', 1)
        view.viewedReleaseId = 'b'
        engine.nextTrack()
        expect(player.currentReleaseId).toBe('a')
        expect(player.currentTrackIndex).toBe(2)
        expect(audio.src).toContain('audio/a/a3.mp3')
    })

    it('prev с первого трека — последний трек релиза', () => {
        engine.playTrackByRef('a', 0)
        engine.prevTrack()
        expect(player.currentTrackIndex).toBe(2)
    })

    it('клик по треку открытого релиза запускает его, а не тот же индекс играющего', () => {
        engine.playTrackByRef('a', 1)
        view.viewedReleaseId = 'b'
        engine.handleTrackClick(1)
        expect(player.currentReleaseId).toBe('b')
        expect(player.currentTrackIndex).toBe(1)
        expect(audio.src).toContain('audio/b/b2.mp3')
    })

    it('клик по играющему треку на его же странице — пауза, а не перезапуск', () => {
        engine.playTrackByRef('a', 1)
        const session = player.playSession
        view.viewedReleaseId = 'a'
        setPaused(false)
        engine.handleTrackClick(1)
        expect(audio.pause).toHaveBeenCalled()
        expect(player.isPlaying).toBe(false)
        expect(player.playSession).toBe(session)
    })

    it('касание строки запускает трек, синтетический click следом не ставит паузу', () => {
        view.viewedReleaseId = 'a'
        engine.handleTrackPointer(2)
        const session = player.playSession
        setPaused(false)
        engine.handleTrackClick(2, 'click')
        expect(player.playSession).toBe(session)
        expect(audio.pause).not.toHaveBeenCalled()
    })

    it('подсветка строки — только когда открыт играющий релиз и виден мини-плеер', () => {
        engine.playTrackByRef('a', 1)
        expect(isTrackHighlighted('b', 1)).toBe(false)
        expect(isTrackHighlighted('a', 0)).toBe(false)
        expect(isTrackHighlighted('a', 1)).toBe(true)
        engine.closeMiniPlayer()
        expect(isTrackHighlighted('a', 1)).toBe(false)
    })
})

describe('очередь: источники', () => {
    const ended = () => engine.nextTrack()

    it('плейлист: треки разных релизов по порядку, недоступный пропускается, по кругу', () => {
        engine.playList({ kind: 'playlist', playlistId: 'p', title: 'Мой' }, ['b/t2', 'gone/x', 'a/t1', 'a/t3'])
        expect(player.currentTrackId).toBe('b/t2')
        expect(player.currentReleaseId).toBe('b')
        ended()
        expect(player.currentTrackId).toBe('a/t1')
        expect(player.currentReleaseId).toBe('a')
        expect(player.currentTrackIndex).toBe(0)
        ended()
        ended()
        expect(player.currentTrackId).toBe('b/t2')
        engine.prevTrack()
        expect(player.currentTrackId).toBe('a/t3')
        expect(player.queue?.source).toEqual({ kind: 'playlist', playlistId: 'p', title: 'Мой' })
    })

    it('избранное с выбранного трека; открытие релиза не меняет очередь', () => {
        engine.playList({ kind: 'favorites', ownerId: 'u' }, ['a/t2', 'b/t1'], 1)
        view.viewedReleaseId = 'a'
        engine.nextTrack()
        expect(player.currentTrackId).toBe('a/t2')
    })

    it('Поток: включается кнопкой, «вперёд» — случайный трек каталога, не тот же', () => {
        engine.startFlowMode()
        expect(player.flowModeActive).toBe(true)
        const seen = new Set<string>()
        let prev = player.currentTrackId
        for (let i = 0; i < 30; i++) {
            engine.nextTrack()
            expect(player.currentTrackId).not.toBe(prev)
            prev = player.currentTrackId
            seen.add(prev!)
        }
        expect(seen.size).toBeGreaterThan(2)
    })

    it('Поток: трек из треклиста не выключает Поток; выключение — дальше по релизу', () => {
        engine.startFlowMode()
        engine.playTrackByRef('a', 1)
        expect(player.flowModeActive).toBe(true)
        expect(player.currentTrackId).toBe('a/t2')
        engine.stopFlowMode()
        expect(player.flowModeActive).toBe(false)
        expect(player.currentTrackId).toBe('a/t2')
        engine.nextTrack()
        expect(player.currentTrackId).toBe('a/t3')
    })

    it('Поток по избранному — только из избранного', () => {
        engine.startFavoritesFlow('u', ['a/t1', 'b/t2'])
        expect(player.flowModeActive).toBe(false)
        for (let i = 0; i < 10; i++) {
            expect(['a/t1', 'b/t2']).toContain(player.currentTrackId)
            engine.nextTrack()
        }
    })

    it('перемешивание: включается посреди релиза, все треки за круг, выключение — обычный порядок', () => {
        engine.playTrackByRef('a', 0)
        engine.toggleShuffle()
        expect(player.shuffle).toBe(true)
        const lap = [player.currentTrackId]
        for (let i = 0; i < 2; i++) {
            engine.nextTrack()
            lap.push(player.currentTrackId)
        }
        expect([...lap].sort()).toEqual(['a/t1', 'a/t2', 'a/t3'])
        engine.toggleShuffle()
        engine.playTrackByRef('a', 0)
        engine.nextTrack()
        expect(player.currentTrackId).toBe('a/t2')
    })

    it('«Перемешать» в плейлисте — случайный старт и включённое перемешивание', () => {
        engine.playListShuffled({ kind: 'playlist', playlistId: 'p', title: 'x' }, ['a/t1', 'a/t2', 'b/t1'])
        expect(player.shuffle).toBe(true)
        expect(player.queue?.shuffle).toBe(true)
        expect(['a/t1', 'a/t2', 'b/t1']).toContain(player.currentTrackId)
    })

    it('очередь хозяина комнаты (remote): кнопки гостя её не двигают', async () => {
        const { createListQueue } = await import('../player/queue')
        const q = createListQueue({ kind: 'playlist', playlistId: 'room', title: 'Комната' }, ['a/t1', 'a/t2'], 0, () => true)!
        engine.replaceQueue({ ...q, controller: 'remote' })
        engine.nextTrack()
        engine.prevTrack()
        engine.toggleShuffle()
        expect(player.currentTrackId).toBe('a/t1')
        expect(player.shuffle).toBe(false)
    })
})

describe('текст и караоке', () => {
    it('.lrc и .txt запрашиваются параллельно', () => {
        engine.playTrackByRef('a', 0)
        expect(fetchTrackLrc).toHaveBeenCalled()
        expect(fetchTrackTxt).toHaveBeenCalled()
        expect(files.has('l/a/01-a1.lrc')).toBe(true)
        expect(files.has('l/a/01-a1.txt')).toBe(true)
    })

    it('поздний ответ прошлого трека не перезаписывает текст текущего', async () => {
        engine.playTrackByRef('a', 0)
        engine.playTrack(1, 'next')
        file('l/a/02-a2.lrc').resolve('')
        file('l/a/02-a2.txt').resolve('текст второго')
        await vi.waitFor(() => expect(karaoke.plainText).toBe('текст второго'))
        file('l/a/01-a1.lrc').resolve('')
        file('l/a/01-a1.txt').resolve('текст первого')
        await new Promise((r) => setTimeout(r, 0))
        expect(karaoke.plainText).toBe('текст второго')
    })

    it('без текста — заглушка; без .lrc — режим «текст»', async () => {
        const done = lyrics.loadLyrics(-1)
        await done
        engine.playTrackByRef('a', 0)
        file('l/a/01-a1.lrc').resolve('')
        file('l/a/01-a1.txt').resolve('   ')
        await vi.waitFor(() => expect(karaoke.plainText).toBe('Текст будет позже...'))
        expect(karaoke.mode).toBe('text')
        expect(karaoke.lines).toEqual([])
    })

    it('караоке: жёсткий старт на первой строке, дальше — по времени', async () => {
        engine.playTrackByRef('a', 0)
        file('l/a/01-a1.lrc').resolve('[00:05.00]Первая\n[00:10.00]Вторая\n[00:20.00]Третья')
        file('l/a/01-a1.txt').resolve('Первая\nВторая\nТретья')
        await vi.waitFor(() => expect(karaoke.lines).toHaveLength(3))
        expect(karaoke.mode).toBe('karaoke')
        expect(karaoke.currentIndex).toBe(0)
        expect(karaoke.gradient).toBe(false)

        Object.defineProperty(audio, 'currentTime', { value: 12, configurable: true, writable: true })
        lyrics.updateKaraoke()
        expect(karaoke.currentIndex).toBe(1)
        expect(karaoke.gradient).toBe(true)
        expect(karaoke.hardStart).toBe(false)

        audio.currentTime = 25
        lyrics.updateKaraoke()
        expect(karaoke.currentIndex).toBe(2)
        audio.currentTime = 6
        lyrics.updateKaraoke()
        expect(karaoke.currentIndex).toBe(0)
    })

    it('режим «караоке» недоступен без .lrc', () => {
        karaoke.lines = []
        karaoke.mode = 'text'
        lyrics.setLyricsMode('karaoke')
        expect(karaoke.mode).toBe('text')
    })
})

describe('громкость', () => {
    it('выключение звука показывает 0, включение — прежнюю громкость', () => {
        engine.setVolume(0.3)
        expect(player.sliderValue).toBe(0.3)
        engine.toggleMute()
        expect(player.muted).toBe(true)
        expect(player.sliderValue).toBe(0)
        engine.toggleMute()
        expect(player.sliderValue).toBeCloseTo(0.3)
    })
})

describe('запуск звука на телефоне', () => {
    it('нажатие на строку запускает play() сразу, без ожидания чего-либо', () => {
        view.viewedReleaseId = 'a'
        engine.handleTrackClick(1)
        // Синхронно, в том же вызове: iOS не даёт звук, если перед play() был await.
        expect(audio.play).toHaveBeenCalledTimes(1)
        expect(player.currentTrackId).toBe('a/t2')
    })

    it('браузер не разрешил звук: статус «нажми, чтобы играть», а не «играет»', async () => {
        audio.play = vi.fn(() => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })))
        view.viewedReleaseId = 'a'
        engine.handleTrackClick(0)
        await new Promise((r) => setTimeout(r, 0))
        expect(player.isPlaying).toBe(false)
        expect(player.playback).toBe('tap')
    })

    it('нажатие на кнопку воспроизведения в состоянии «tap» запускает звук заново', async () => {
        audio.play = vi.fn(() => Promise.resolve())
        view.viewedReleaseId = 'a'
        engine.handleTrackClick(0)
        await new Promise((r) => setTimeout(r, 0))
        player.playback = 'tap'
        player.isPlaying = false
        setPaused(false) // как при зависшей загрузке: элемент «играет», звука нет
        engine.togglePlay()
        await new Promise((r) => setTimeout(r, 0))
        expect(audio.pause).not.toHaveBeenCalled()
        expect(player.isPlaying).toBe(true)
        expect(player.playback).toBe('ok')
    })

    it('«Играть следующим» ставит трек после текущего и не трогает очередь хозяина комнаты', () => {
        view.viewedReleaseId = 'a'
        engine.handleTrackClick(0)
        expect(engine.canPlayNext()).toBe(true)
        expect(engine.playNext('b/t2')).toBe(true)
        engine.nextTrack()
        expect(player.currentTrackId).toBe('b/t2')
        player.queue = { ...player.queue!, controller: 'remote' }
        expect(engine.playNext('b/t1')).toBe(false)
    })
})
