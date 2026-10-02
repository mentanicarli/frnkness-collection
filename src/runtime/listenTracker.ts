/**
 * Сессии прослушивания: сколько секунд трека реально прослушано и до какой
 * секунды дошли — для статистики «дослушивают или пропускают».
 *
 * Время считается только при непрерывном воспроизведении: перемотка вперёд
 * не добавляет «прослушанных» секунд и не двигает «дошли до».
 *
 * Одна сессия — один трек от запуска до смены трека или конца. Снимок сессии
 * отправляется при смене трека, конце, скрытии вкладки и закрытии страницы;
 * в базе это одна строка (upsert по session_id). Сессии короче 3 секунд не
 * отправляются. Ошибки отправки игнорируются — сайт работает и без этого.
 */

export interface ListenPayload {
    session_id_input: string
    track_key_input: string
    listened_input: number
    max_position_input: number
    duration_input: number
    completed_input: boolean
}

export interface ListenTrackerDeps {
    audio: HTMLAudioElement
    /** Ключ играющего трека «<releaseId>-<индекс>» или null. */
    getTrackKey(): string | null
    send(payload: ListenPayload): void
    newId?: () => string
    doc?: Document
    win?: Window
}

export const MIN_LISTENED = 3
/** Шаг timeupdate больше этого — перемотка или пауза, а не воспроизведение. */
const MAX_STEP = 1.5

interface Session {
    id: string
    key: string
    listened: number
    maxPosition: number
    duration: number
    completed: boolean
    lastTime: number | null
    /** Что уже отправлено — не повторяем одинаковый снимок. */
    sentSignature: string
}

const round2 = (v: number) => Math.round(v * 100) / 100

/** UUID v4; randomUUID есть не во всех браузерах — запасной путь через getRandomValues. */
export function randomId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    const b = new Uint8Array(16)
    crypto.getRandomValues(b)
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function setupListenTracker(deps: ListenTrackerDeps) {
    const { audio } = deps
    const doc = deps.doc ?? document
    const win = deps.win ?? window
    const newId = deps.newId ?? randomId
    let session: Session | null = null

    function flush() {
        const s = session
        if (!s) return
        const duration = s.duration
        if (!(duration > 0) || duration > 1800 || s.listened < MIN_LISTENED) return
        const payload: ListenPayload = {
            session_id_input: s.id,
            track_key_input: s.key,
            listened_input: round2(Math.min(s.listened, duration)),
            max_position_input: round2(Math.min(s.maxPosition, duration)),
            duration_input: round2(duration),
            completed_input: s.completed
        }
        const signature = JSON.stringify(payload)
        if (signature === s.sentSignature) return
        s.sentSignature = signature
        try {
            deps.send(payload)
        } catch {
            // Статистика не должна ломать плеер.
        }
    }

    function start() {
        const key = deps.getTrackKey()
        if (!key) {
            session = null
            return
        }
        const t = audio.currentTime || 0
        session = {
            id: newId(),
            key,
            listened: 0,
            maxPosition: t,
            duration: Number.isFinite(audio.duration) ? audio.duration : 0,
            completed: false,
            lastTime: t,
            sentSignature: ''
        }
    }

    // Новый src — новый трек: прошлую сессию отправляем. Новая начнётся с
    // первого timeupdate: в браузере play может прийти раньше loadstart,
    // поэтому на play сессию не начинаем.
    audio.addEventListener('loadstart', () => {
        flush()
        session = null
    })
    audio.addEventListener('loadedmetadata', () => {
        if (session && Number.isFinite(audio.duration)) session.duration = audio.duration
    })
    audio.addEventListener('play', () => {
        if (session) session.lastTime = audio.currentTime
    })
    audio.addEventListener('timeupdate', () => {
        if (!session || session.key !== deps.getTrackKey()) {
            if (session) flush()
            if (audio.paused) return
            start()
        }
        const s = session
        if (!s) return
        if (Number.isFinite(audio.duration) && audio.duration > 0) s.duration = audio.duration
        const t = audio.currentTime
        if (s.lastTime !== null) {
            const step = t - s.lastTime
            if (step > 0 && step <= MAX_STEP && !audio.paused) {
                s.listened += step
                if (t > s.maxPosition) s.maxPosition = t
            }
        }
        s.lastTime = t
    })
    // Перемотка: прыжок не считается прослушиванием.
    audio.addEventListener('seeking', () => {
        if (session) session.lastTime = null
    })
    audio.addEventListener('seeked', () => {
        if (session) session.lastTime = audio.currentTime
    })
    audio.addEventListener('pause', () => {
        if (session) session.lastTime = audio.currentTime
    })
    audio.addEventListener('ended', () => {
        const s = session
        if (!s) return
        s.completed = true
        if (s.duration > 0) s.maxPosition = s.duration
        flush()
        session = null
    })

    // Вкладку скрыли (на телефоне её потом могут закрыть без pagehide) —
    // отправляем снимок; если музыка играет дальше, сессия продолжится и
    // обновит ту же строку в базе.
    doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'hidden') flush()
    })
    win.addEventListener('pagehide', () => flush())

    return { flush, current: () => session }
}

/**
 * Отправка в Supabase: fetch с keepalive (доходит и при закрытии страницы),
 * только заголовок apikey. Ошибки — тихо: если миграция ещё не применена,
 * сайт не должен ломаться.
 */
export function createListenSender(supabaseUrl: string, apiKey: string) {
    const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/record_listen_session`
    return (payload: ListenPayload) => {
        if (typeof fetch !== 'function') return
        fetch(url, {
            method: 'POST',
            keepalive: true,
            headers: { apikey: apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(() => undefined)
    }
}
