import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createListenSender, setupListenTracker, type ListenPayload } from '../listenTracker'

class FakeAudio extends EventTarget {
    paused = true
    currentTime = 0
    duration = NaN
    fire(type: string) {
        this.dispatchEvent(new Event(type))
    }
}

let audio: FakeAudio
let key: string | null
let sent: ListenPayload[]
let ids: number
let doc: EventTarget & { visibilityState: string }
let win: EventTarget

function setup() {
    return setupListenTracker({
        audio: audio as unknown as HTMLAudioElement,
        getTrackKey: () => key,
        send: (p) => sent.push(p),
        newId: () => `id-${++ids}`,
        doc: doc as unknown as Document,
        win: win as unknown as Window
    })
}

// Воспроизведение: timeupdate в начале и дальше шагами по 0.25 с.
function play(from: number, to: number) {
    audio.currentTime = from
    audio.paused = false
    audio.fire('play')
    audio.fire('timeupdate')
    for (let t = from + 0.25; t <= to + 1e-9; t += 0.25) {
        audio.currentTime = Math.round(t * 100) / 100
        audio.fire('timeupdate')
    }
}

function newTrack(k: string, duration = 200) {
    key = k
    audio.fire('loadstart')
    audio.currentTime = 0
    audio.duration = duration
    audio.fire('loadedmetadata')
}

beforeEach(() => {
    audio = new FakeAudio()
    key = null
    sent = []
    ids = 0
    doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    win = new EventTarget()
})

describe('сессии прослушивания', () => {
    it('смена трека отправляет прошлую сессию: прослушано, дошли до, длительность', () => {
        setup()
        newTrack('faaa-0')
        play(0, 30)
        newTrack('boxik-0')
        expect(sent).toEqual([
            { session_id_input: 'id-1', track_key_input: 'faaa-0', listened_input: 30, max_position_input: 30, duration_input: 200, completed_input: false }
        ])
    })

    it('перемотка вперёд не считается прослушанной', () => {
        const t = setup()
        newTrack('faaa-0')
        play(0, 10)
        audio.fire('seeking')
        audio.currentTime = 150
        audio.fire('seeked')
        play(150, 160)
        t.flush()
        expect(sent[0]).toMatchObject({ listened_input: 20, max_position_input: 160 })
    })

    it('скачок времени без seeking (пропуск по сети) тоже не считается', () => {
        const t = setup()
        newTrack('faaa-0')
        play(0, 5)
        audio.currentTime = 120
        audio.fire('timeupdate')
        t.flush()
        expect(sent[0]).toMatchObject({ listened_input: 5, max_position_input: 5 })
    })

    it('конец трека — дослушан', () => {
        setup()
        newTrack('faaa-0', 60)
        play(0, 59.75)
        audio.fire('ended')
        expect(sent[0]).toMatchObject({ completed_input: true, max_position_input: 60, duration_input: 60 })
    })

    it('короче 3 секунд — не отправляется', () => {
        setup()
        newTrack('faaa-0')
        play(0, 2.5)
        newTrack('boxik-0')
        expect(sent).toEqual([])
    })

    it('скрытие вкладки — снимок той же сессии; продолжение обновляет ту же запись', () => {
        setup()
        newTrack('faaa-0')
        play(0, 10)
        doc.visibilityState = 'hidden'
        doc.dispatchEvent(new Event('visibilitychange'))
        // Музыка играет в фоне дальше.
        for (let tm = 10.25; tm <= 40; tm += 0.25) {
            audio.currentTime = tm
            audio.fire('timeupdate')
        }
        win.dispatchEvent(new Event('pagehide'))
        expect(sent.map((p) => [p.session_id_input, p.listened_input])).toEqual([
            ['id-1', 10],
            ['id-1', 40]
        ])
    })

    it('одинаковый снимок не отправляется дважды', () => {
        const t = setup()
        newTrack('faaa-0')
        play(0, 10)
        t.flush()
        t.flush()
        win.dispatchEvent(new Event('pagehide'))
        expect(sent).toHaveLength(1)
    })

    it('пауза: время на паузе не идёт', () => {
        const t = setup()
        newTrack('faaa-0')
        play(0, 10)
        audio.paused = true
        audio.fire('pause')
        audio.fire('timeupdate')
        play(10, 12)
        t.flush()
        expect(sent[0].listened_input).toBe(12)
    })

    it('повтор того же трека с начала — новая сессия', () => {
        setup()
        newTrack('faaa-0')
        play(0, 10)
        newTrack('faaa-0')
        play(0, 5)
        newTrack('boxik-0')
        expect(sent.map((p) => p.session_id_input)).toEqual(['id-1', 'id-2'])
    })

    it('в браузере play может прийти раньше loadstart — сессия всё равно считается', () => {
        const t = setup()
        key = 'faaa-0'
        audio.duration = 200
        audio.paused = false
        audio.fire('play') // раньше loadstart
        audio.fire('loadstart')
        audio.currentTime = 0
        audio.fire('timeupdate')
        for (let tm = 0.25; tm <= 10; tm += 0.25) {
            audio.currentTime = tm
            audio.fire('timeupdate')
        }
        t.flush()
        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatchObject({ track_key_input: 'faaa-0', listened_input: 10 })
    })

    it('ошибка отправки не ломает плеер', () => {
        const t = setupListenTracker({
            audio: audio as unknown as HTMLAudioElement,
            getTrackKey: () => 'faaa-0',
            send: () => {
                throw new Error('нет сети')
            },
            newId: () => 'x',
            doc: doc as unknown as Document,
            win: win as unknown as Window
        })
        newTrack('faaa-0')
        play(0, 10)
        expect(() => t.flush()).not.toThrow()
    })
})

describe('отправка', () => {
    it('fetch keepalive, только apikey, ошибки глушатся', async () => {
        const calls: [string, RequestInit][] = []
        vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
            calls.push([url, init])
            return Promise.reject(new Error('404'))
        })
        createListenSender('https://x.supabase.co/', 'sb_publishable_k')({
            session_id_input: 's',
            track_key_input: 'faaa-0',
            listened_input: 10,
            max_position_input: 10,
            duration_input: 100,
            completed_input: false
        })
        await Promise.resolve()
        expect(calls[0][0]).toBe('https://x.supabase.co/rest/v1/rpc/record_listen_session')
        expect(calls[0][1]).toMatchObject({ method: 'POST', keepalive: true, headers: { apikey: 'sb_publishable_k', 'Content-Type': 'application/json' } })
        vi.unstubAllGlobals()
    })
})
