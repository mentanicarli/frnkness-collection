import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ARTIST, artworkFor, setupMediaSession, type MediaSessionDeps, type NowPlaying } from '../mediaSession'

// Поддельные MediaSession и <audio>: в jsdom их нет.
class FakeSession {
    metadata: unknown = null
    playbackState = 'none'
    handlers = new Map<string, (d: any) => void>()
    positions: MediaPositionState[] = []
    setActionHandler(action: string, handler: ((d: any) => void) | null) {
        if (action === 'seekto' && this.noSeekTo) throw new Error('not supported')
        if (handler) this.handlers.set(action, handler)
    }
    setPositionState(state: MediaPositionState) {
        this.positions.push(state)
    }
    noSeekTo = false
}

class FakeAudio extends EventTarget {
    paused = true
    currentTime = 0
    duration = NaN
    playbackRate = 1
    fire(type: string) {
        this.dispatchEvent(new Event(type))
    }
}

class FakeMetadata {
    constructor(public init: MediaMetadataInit) {}
}

let session: FakeSession
let audio: FakeAudio
let nowPlaying: NowPlaying | null
let clock: number
let calls: string[]

function setup(extra: Partial<MediaSessionDeps> = {}) {
    return setupMediaSession({
        audio: audio as unknown as HTMLAudioElement,
        getNowPlaying: () => nowPlaying,
        play: () => calls.push('play'),
        pause: () => calls.push('pause'),
        next: () => calls.push('next'),
        prev: () => calls.push('prev'),
        seek: (t) => {
            calls.push(`seek:${t}`)
            audio.currentTime = t
        },
        nav: { mediaSession: session } as unknown as Navigator,
        baseUrl: 'https://frnkness.ru/',
        now: () => clock,
        ...extra
    })
}

beforeEach(() => {
    session = new FakeSession()
    audio = new FakeAudio()
    nowPlaying = { title: 'ГОУТЫ', album: 'Злая Ностальгия', cover: 'images/album4-cover.jpg' }
    clock = 1000
    calls = []
    vi.stubGlobal('MediaMetadata', FakeMetadata)
})

describe('Media Session', () => {
    it('без API — ничего не делает', () => {
        expect(setup({ nav: {} as Navigator })).toBeNull()
    })

    it('карточка трека: название, артист, релиз, обложка с абсолютным URL', () => {
        setup()
        audio.fire('loadstart')
        const meta = session.metadata as FakeMetadata
        expect(meta.init.title).toBe('ГОУТЫ')
        expect(meta.init.artist).toBe(ARTIST)
        expect(meta.init.album).toBe('Злая Ностальгия')
        const art = meta.init.artwork!
        expect(art.length).toBeGreaterThan(1)
        expect(new Set(art.map((a) => a.src))).toEqual(new Set(['https://frnkness.ru/images/album4-cover.jpg']))
        expect(art.map((a) => a.sizes)).toContain('512x512')
    })

    it('смена трека обновляет карточку', () => {
        setup()
        audio.fire('loadstart')
        nowPlaying = { title: 'Маканочки', album: 'Злая Ностальгия', cover: 'images/album4-cover.jpg' }
        audio.fire('loadstart')
        expect((session.metadata as FakeMetadata).init.title).toBe('Маканочки')
    })

    it('кнопки: play, pause, следующий, предыдущий', () => {
        setup()
        session.handlers.get('play')!({})
        session.handlers.get('pause')!({})
        session.handlers.get('nexttrack')!({})
        session.handlers.get('previoustrack')!({})
        expect(calls).toEqual(['play', 'pause', 'next', 'prev'])
    })

    it('перемотка: ±10 с по умолчанию, в границах трека, seekto', () => {
        setup()
        audio.duration = 120
        audio.currentTime = 5
        session.handlers.get('seekbackward')!({})
        expect(audio.currentTime).toBe(0)
        session.handlers.get('seekforward')!({})
        session.handlers.get('seekforward')!({ seekOffset: 30 })
        expect(audio.currentTime).toBe(40)
        session.handlers.get('seekto')!({ seekTime: 500 })
        expect(audio.currentTime).toBe(120)
        session.handlers.get('seekto')!({ seekTime: 61.5 })
        expect(calls[calls.length - 1]).toBe('seek:61.5')
    })

    it('playbackState по событиям play/pause', () => {
        setup()
        audio.paused = false
        audio.fire('play')
        expect(session.playbackState).toBe('playing')
        audio.paused = true
        audio.fire('pause')
        expect(session.playbackState).toBe('paused')
    })

    it('позиция: сразу после загрузки и перемотки, по timeupdate — не чаще раза в секунду', () => {
        setup()
        audio.fire('timeupdate') // длительность неизвестна — не отправляем
        expect(session.positions).toHaveLength(0)
        audio.duration = 200
        audio.fire('loadedmetadata')
        expect(session.positions).toHaveLength(1)
        audio.currentTime = 1
        clock += 300
        audio.fire('timeupdate')
        clock += 300
        audio.fire('timeupdate')
        expect(session.positions).toHaveLength(1)
        clock += 500
        audio.fire('timeupdate')
        expect(session.positions).toHaveLength(2)
        audio.currentTime = 90
        audio.fire('seeked')
        expect(session.positions[session.positions.length - 1]).toEqual({ duration: 200, playbackRate: 1, position: 90 })
    })

    it('неподдерживаемое действие не ломает остальные', () => {
        session.noSeekTo = true
        setup()
        expect(session.handlers.has('seekto')).toBe(false)
        expect(session.handlers.has('nexttrack')).toBe(true)
    })

    it('png-обложка', () => {
        expect(artworkFor('images/x.png', 'https://frnkness.ru/')[0]).toMatchObject({ src: 'https://frnkness.ru/images/x.png', type: 'image/png' })
    })
})
