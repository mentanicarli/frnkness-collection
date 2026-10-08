// Сторож воспроизведения: запуск звука в жесте, отказ браузера, обрыв сети, повторы, журнал.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { player } from '../player/state'
import { RETRY_DELAYS_MS, START_TIMEOUT_MS, STALL_TIMEOUT_MS, classifyPlayError, createPlaybackGuard, describeMediaError } from '../player/playbackGuard'

let audio: HTMLAudioElement
let report: ReturnType<typeof vi.fn>
let guard: ReturnType<typeof createPlaybackGuard>
let online = true

const domError = (name: string) => Object.assign(new Error(name), { name })

function setup(play: () => Promise<void>) {
    audio = document.createElement('audio')
    audio.play = vi.fn(play)
    audio.load = vi.fn()
    audio.src = 'https://example.test/audio/a.mp3'
    audio.pause = vi.fn()
    report = vi.fn()
    online = true
    guard = createPlaybackGuard({ audio, getTrackKey: () => 'rel-0', report, online: () => online })
}

const fire = (name: string) => audio.dispatchEvent(new Event(name))
const setMediaError = (code: number) => Object.defineProperty(audio, 'error', { value: { code }, configurable: true })
const setPaused = (paused: boolean) => Object.defineProperty(audio, 'paused', { value: paused, configurable: true })

beforeEach(() => {
    vi.useFakeTimers()
    Object.assign(player, { isPlaying: false, playback: 'ok', currentTrackId: 'rel/t1' })
})
afterEach(() => {
    guard?.destroy()
    vi.useRealTimers()
})

describe('классификация ошибок', () => {
    it('различает отказ браузера, неподдерживаемый файл и прерванный запуск', () => {
        expect(classifyPlayError(domError('NotAllowedError'))).toBe('blocked')
        expect(classifyPlayError(domError('NotSupportedError'))).toBe('unsupported')
        expect(classifyPlayError(domError('AbortError'))).toBe('aborted')
        expect(classifyPlayError(new Error('x'))).toBe('other')
        expect(describeMediaError(2)).toContain('сеть')
        expect(describeMediaError(undefined)).toBe('ошибка плеера')
    })
})

describe('запуск', () => {
    it('play() вызывается синхронно, до любого await', () => {
        setup(() => Promise.resolve())
        void guard.play()
        expect(audio.play).toHaveBeenCalledTimes(1)
    })

    it('успех: играет, статус «ok»', async () => {
        setup(() => Promise.resolve())
        await expect(guard.play()).resolves.toBe(true)
        expect(player.isPlaying).toBe(true)
        expect(player.playback).toBe('ok')
        expect(report).not.toHaveBeenCalled()
    })

    it('браузер не разрешил: «Нажми, чтобы играть» и запись в журнал, без повторов', async () => {
        setup(() => Promise.reject(domError('NotAllowedError')))
        await expect(guard.play()).resolves.toBe(false)
        expect(player.playback).toBe('tap')
        expect(player.isPlaying).toBe(false)
        expect(report).toHaveBeenCalledTimes(1)
        expect(report.mock.calls[0][0]).toMatch(/Не удалось начать воспроизведение: браузер не разрешил/)
        expect(report.mock.calls[0][0]).toContain('rel-0')
        await vi.advanceTimersByTimeAsync(20_000)
        expect(audio.play).toHaveBeenCalledTimes(1)
    })

    it('прерванный запуск (AbortError) — не отказ', async () => {
        setup(() => Promise.reject(domError('AbortError')))
        await guard.play()
        expect(player.playback).toBe('ok')
        expect(report).not.toHaveBeenCalled()
    })

    it('нажатие после «tap» запускает заново и сбрасывает статус', async () => {
        let allow = false
        setup(() => (allow ? Promise.resolve() : Promise.reject(domError('NotAllowedError'))))
        await guard.play()
        expect(player.playback).toBe('tap')
        allow = true
        await expect(guard.play()).resolves.toBe(true)
        expect(player.playback).toBe('ok')
        expect(player.isPlaying).toBe(true)
    })
})

describe('обрыв сети', () => {
    it('ошибка файла: три повтора с задержками 1, 3 и 7 с, затем «Нажми, чтобы играть» и запись в журнал', async () => {
        setup(() => Promise.resolve())
        await guard.play()
        setMediaError(2)
        fire('error')
        expect(player.playback).toBe('retrying')
        expect(audio.play).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0])
        expect(audio.play).toHaveBeenCalledTimes(2)
        expect(audio.load).toHaveBeenCalled()

        fire('error')
        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1])
        expect(audio.play).toHaveBeenCalledTimes(3)

        fire('error')
        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[2])
        expect(audio.play).toHaveBeenCalledTimes(4)

        fire('error')
        expect(player.playback).toBe('tap')
        expect(player.isPlaying).toBe(false)
        expect(report).toHaveBeenCalledTimes(1)
        expect(report.mock.calls[0][0]).toMatch(/Не удалось начать воспроизведение: сеть/)
    })

    it('повтор помог: статус «ok», журнал пуст', async () => {
        setup(() => Promise.resolve())
        await guard.play()
        setMediaError(2)
        fire('error')
        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0])
        fire('playing')
        expect(player.playback).toBe('ok')
        expect(player.isPlaying).toBe(true)
        expect(report).not.toHaveBeenCalled()
    })

    it('буфер остановился на 8 секунд — повтор; пошёл звук раньше — нет', async () => {
        setup(() => Promise.resolve())
        await guard.play()
        fire('waiting')
        await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS - 100)
        fire('timeupdate')
        await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS)
        expect(player.playback).toBe('ok')

        fire('waiting')
        await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 10)
        expect(player.playback).toBe('retrying')
    })

    it('звук не начался за 10 секунд после play() — повтор', async () => {
        setup(() => new Promise<void>(() => undefined))
        void guard.play()
        setPaused(true)
        await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS + 10)
        expect(player.playback).toBe('retrying')
    })

    it('без сети повтор ждёт её возвращения', async () => {
        const handlers: Record<string, () => void> = {}
        setup(() => Promise.resolve())
        guard.destroy()
        online = false
        guard = createPlaybackGuard({
            audio,
            getTrackKey: () => 'rel-0',
            report,
            online: () => online,
            win: { addEventListener: ((n: string, h: () => void) => { handlers[n] = h }) as never, removeEventListener: vi.fn() }
        })
        await guard.play()
        setMediaError(2)
        fire('error')
        expect(handlers.online).toBeTypeOf('function')
        online = true
        handlers.online()
        await vi.advanceTimersByTimeAsync(0)
        expect(audio.play).toHaveBeenCalledTimes(2)
    })
})

describe('пауза и смена трека', () => {
    it('пауза не от нас (звонок, наушники) — сторож ничего не возобновляет', async () => {
        setup(() => Promise.resolve())
        await guard.play()
        fire('pause')
        expect(player.isPlaying).toBe(false)
        setMediaError(2)
        fire('error')
        await vi.advanceTimersByTimeAsync(20_000)
        expect(audio.play).toHaveBeenCalledTimes(1)
    })

    it('пользовательская пауза гасит повторы', async () => {
        setup(() => Promise.resolve())
        await guard.play()
        fire('waiting')
        guard.userPause()
        await vi.advanceTimersByTimeAsync(20_000)
        expect(audio.play).toHaveBeenCalledTimes(1)
    })

    it('новый трек отменяет повторы прошлого', async () => {
        setup(() => Promise.resolve())
        await guard.play()
        setMediaError(2)
        fire('error')
        guard.reset()
        await vi.advanceTimersByTimeAsync(20_000)
        expect(audio.play).toHaveBeenCalledTimes(1)
        expect(player.playback).toBe('ok')
    })

    it('тишина разблокировки комнаты (трека нет) не включает «играет»', () => {
        setup(() => Promise.resolve())
        player.currentTrackId = null
        fire('playing')
        expect(player.isPlaying).toBe(false)
    })
})
