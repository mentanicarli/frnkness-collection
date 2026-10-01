/**
 * Управление с экрана блокировки, из шторки и кнопками наушников —
 * Media Session API. Где API нет, ничего не делает.
 *
 * Модуль не знает о плеере сайта: что играет и как переключать треки,
 * ему передают снаружи (app-core). Так его можно проверить тестом.
 */

export interface NowPlaying {
    title: string
    album: string
    /** Путь к обложке, как в releases.json (относительный). */
    cover: string
}

export interface MediaSessionDeps {
    audio: HTMLAudioElement
    getNowPlaying(): NowPlaying | null
    play(): void
    pause(): void
    next(): void
    prev(): void
    /** Перемотка без автозапуска (на паузе остаёмся на паузе). */
    seek(time: number): void
    nav?: Navigator
    baseUrl?: string
    now?: () => number
}

export const ARTIST = 'frnk ness'
export const SEEK_STEP = 10
const ARTWORK_SIZES = ['96x96', '128x128', '192x192', '256x256', '384x384', '512x512']
/** Не чаще раза в столько мс обновлять позицию по timeupdate. */
const POSITION_INTERVAL = 1000

export function artworkFor(cover: string, baseUrl: string): MediaImage[] {
    const src = new URL(cover, baseUrl).href
    const type = /\.png$/i.test(cover) ? 'image/png' : 'image/jpeg'
    // Обложка одна — объявляем её под разными размерами, система выберет сама.
    return ARTWORK_SIZES.map((sizes) => ({ src, sizes, type }))
}

export function setupMediaSession(deps: MediaSessionDeps): { refresh(): void } | null {
    const nav = deps.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined)
    const maybeSession = nav && 'mediaSession' in nav ? nav.mediaSession : null
    if (!maybeSession) return null
    const session: MediaSession = maybeSession
    const { audio } = deps
    const now = deps.now ?? (() => Date.now())
    const baseUrl = deps.baseUrl ?? document.baseURI
    let lastKey = ''
    let lastPositionAt = 0

    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
        try {
            session.setActionHandler(action, handler)
        } catch {
            // Браузер не поддерживает это действие — пропускаем.
        }
    }

    function updateMetadata() {
        const np = deps.getNowPlaying()
        if (!np || typeof MediaMetadata === 'undefined') return
        const key = `${np.title}\u0000${np.album}\u0000${np.cover}`
        if (key === lastKey) return
        lastKey = key
        try {
            session.metadata = new MediaMetadata({
                title: np.title,
                artist: ARTIST,
                album: np.album,
                artwork: artworkFor(np.cover, baseUrl)
            })
        } catch {
            // Некорректные данные не должны ломать плеер.
        }
    }

    function updatePosition(force = false) {
        if (typeof session.setPositionState !== 'function') return
        const t = now()
        if (!force && t - lastPositionAt < POSITION_INTERVAL) return
        const duration = audio.duration
        if (!Number.isFinite(duration) || duration <= 0) return
        lastPositionAt = t
        try {
            session.setPositionState({
                duration,
                playbackRate: audio.playbackRate || 1,
                position: Math.min(Math.max(0, audio.currentTime || 0), duration)
            })
        } catch {
            // Например, позиция на мгновение больше длительности при смене трека.
        }
    }

    function updateState() {
        session.playbackState = audio.paused ? 'paused' : 'playing'
    }

    const clamp = (t: number) => {
        const d = Number.isFinite(audio.duration) ? audio.duration : Infinity
        return Math.min(Math.max(0, t), d)
    }

    setHandler('play', () => deps.play())
    setHandler('pause', () => deps.pause())
    setHandler('previoustrack', () => deps.prev())
    setHandler('nexttrack', () => deps.next())
    setHandler('seekto', (details) => {
        if (details.seekTime === undefined || details.seekTime === null) return
        deps.seek(clamp(details.seekTime))
        updatePosition(true)
    })
    setHandler('seekbackward', (details) => {
        deps.seek(clamp((audio.currentTime || 0) - (details.seekOffset || SEEK_STEP)))
        updatePosition(true)
    })
    setHandler('seekforward', (details) => {
        deps.seek(clamp((audio.currentTime || 0) + (details.seekOffset || SEEK_STEP)))
        updatePosition(true)
    })

    // Смена трека — новый src: обновляем карточку сразу, ещё до загрузки.
    audio.addEventListener('loadstart', () => {
        updateMetadata()
        lastPositionAt = 0
    })
    audio.addEventListener('loadedmetadata', () => updatePosition(true))
    audio.addEventListener('play', () => {
        updateMetadata()
        updateState()
        updatePosition(true)
    })
    audio.addEventListener('pause', () => {
        updateState()
        updatePosition(true)
    })
    audio.addEventListener('seeked', () => updatePosition(true))
    audio.addEventListener('ratechange', () => updatePosition(true))
    audio.addEventListener('timeupdate', () => updatePosition())

    return {
        refresh() {
            lastKey = ''
            updateMetadata()
            updateState()
            updatePosition(true)
        }
    }
}
