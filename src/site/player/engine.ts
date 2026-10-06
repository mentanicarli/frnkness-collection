import { SUPABASE_ANON_KEY, SUPABASE_URL, releases } from '@/config'
import type { TrackRef } from '@/types'
import { buildAssetUrl } from '@/utils/helpers'
import { getAllTrackRefs, isSameTrackRef } from '@/utils/lyrics'
import { setupMediaSession } from '@/runtime/mediaSession'
import { createListenSender, setupListenTracker } from '@/runtime/listenTracker'
import { currentAccessToken } from '../session'
import { updatePageAccent, updatePlayerAccent } from '../services/colors'
import { incrementPlayCount } from '../services/stats'
import { view } from '../stores/view'
import { getAudio, setAudio } from './audio'
import { loadLyrics, updateKaraoke } from './karaoke'
import { karaoke, player } from './state'

/**
 * Движок плеера: запуск треков, пауза, перемотка, Поток, громкость,
 * засчёт прослушиваний. Отрисовку делают MiniPlayer.vue и
 * FullscreenPlayer.vue по состоянию из ./state.
 */

type Direction = 'next' | 'prev' | 'fade' | null

const COUNT_AFTER_SEC = 10

// ── Поток ───────────────────────────────────────────────────────────────

function pickRandomTrackRef(exclude: TrackRef | null = null): TrackRef | null {
    const refs = getAllTrackRefs(releases).filter((ref) => !exclude || !isSameTrackRef(ref, exclude))
    return refs.length ? refs[Math.floor(Math.random() * refs.length)] : null
}

export function startFlowMode(): void {
    const next = pickRandomTrackRef()
    if (!next) return
    player.flowModeActive = true
    playTrackByRef(next.releaseId, next.trackIndex, 'fade')
}

export function stopFlowMode(): void {
    player.flowModeActive = false
}

export function toggleFlowMode(): void {
    if (player.flowModeActive) stopFlowMode()
    else startFlowMode()
}

function playFlowNext(direction: Direction = 'next') {
    const current = player.currentReleaseId !== null
        ? { releaseId: player.currentReleaseId, trackIndex: player.currentTrackIndex }
        : null
    const next = pickRandomTrackRef(current)
    if (next) playTrackByRef(next.releaseId, next.trackIndex, direction)
}

// ── Предзагрузка ────────────────────────────────────────────────────────

const preloadedAudio = new Set<string>()

function preloadTrackMetadata(releaseId: string, trackIndex: number) {
    const release = releases[releaseId]
    const track = release?.tracks[trackIndex]
    if (!release || !track) return
    const src = buildAssetUrl(release.audioPath, track.file)
    if (preloadedAudio.has(src)) return
    if (preloadedAudio.size > 14) {
        const oldest = preloadedAudio.values().next().value
        if (oldest) preloadedAudio.delete(oldest)
    }
    const probe = new Audio()
    probe.preload = 'metadata'
    probe.src = src
    preloadedAudio.add(src)
}

export function runWhenIdle(fn: () => void): void {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 800 })
    else setTimeout(fn, 16)
}

// ── Воспроизведение ─────────────────────────────────────────────────────

// Единственная точка запуска трека из другого релиза: явно задаёт
// играющий релиз. Треклист, поиск, чарт, страница трека и Поток идут сюда.
export function playTrackByRef(releaseId: string, trackIndex: number, direction: Direction = 'fade'): void {
    const release = releases[releaseId]
    if (!release || !release.tracks[trackIndex]) return
    player.currentRelease = release
    player.currentReleaseId = releaseId
    playTrack(trackIndex, direction)
}

let trackStartSeq = 0

// Запуск трека index ИГРАЮЩЕГО релиза (next/prev/ended). Чтобы сменить
// релиз, используйте playTrackByRef.
export function playTrack(index: number, direction: Direction = null): void {
    const release = player.currentRelease
    const audio = getAudio()
    const track = release?.tracks[index]
    if (!release || !track || !audio) return

    player.currentTrackIndex = index
    player.playSession += 1
    player.trackCounted = false
    player.trackCountPending = false
    karaoke.hardStart = true

    audio.src = buildAssetUrl(release.audioPath, track.file)
    setMiniPlayerVisible(true)
    player.trackStart = { n: ++trackStartSeq, cover: release.cover, direction }

    void updatePlayerAccent(release.cover)
    // Акцент страницы — по играющему релизу, только если на экране не
    // открыт другой релиз (иначе страница B перекрасилась бы в цвета A).
    if (!view.viewedReleaseId || view.viewedReleaseId === player.currentReleaseId) {
        void updatePageAccent(release.cover)
    }

    if (player.currentReleaseId) {
        preloadTrackMetadata(player.currentReleaseId, (index + 1) % release.tracks.length)
    }

    const playPromise = audio.play()
    if (playPromise && typeof playPromise.then === 'function') {
        playPromise
            .then(() => { player.isPlaying = true })
            .catch((err) => {
                player.isPlaying = false
                console.log('Play error:', err)
            })
    } else {
        player.isPlaying = true
    }

    void loadLyrics(index)
}

export function togglePlay(): void {
    const audio = getAudio()
    if (!audio) return
    if (audio.paused) {
        void audio.play()
        player.isPlaying = true
        setMiniPlayerVisible(true)
    } else {
        audio.pause()
        player.isPlaying = false
    }
}

export function nextTrack(): void {
    if (player.flowModeActive) {
        playFlowNext('next')
        return
    }
    const release = player.currentRelease
    if (release) playTrack((player.currentTrackIndex + 1) % release.tracks.length, 'next')
}

export function prevTrack(): void {
    const release = player.currentRelease
    if (release) {
        playTrack(player.currentTrackIndex === 0 ? release.tracks.length - 1 : player.currentTrackIndex - 1, 'prev')
    }
}

/** Перемотка по клику на полосе прогресса: fraction — доля от 0 до 1. */
export function seekToFraction(fraction: number): void {
    const audio = getAudio()
    if (!audio || !audio.duration) return
    audio.currentTime = fraction * audio.duration
}

/** Перемотка к времени со старта воспроизведения (клик по строке караоке, поиск). */
export function seekTo(time: number): void {
    const audio = getAudio()
    if (!audio || !Number.isFinite(time) || time < 0) return

    const applySeek = () => {
        audio.currentTime = time
        if (karaoke.mode === 'karaoke') updateKaraoke()
        if (audio.paused) {
            const resume = audio.play()
            if (resume && typeof resume.then === 'function') {
                resume.then(() => { player.isPlaying = true }).catch(() => { player.isPlaying = false })
            } else {
                player.isPlaying = true
            }
        }
    }

    if (audio.readyState >= 1 || Number.isFinite(audio.duration)) {
        applySeek()
        return
    }
    const onMetadata = () => {
        audio.removeEventListener('loadedmetadata', onMetadata)
        applySeek()
    }
    audio.addEventListener('loadedmetadata', onMetadata)
}

// ── Треклист ────────────────────────────────────────────────────────────

let pendingTrackClickGuard: { releaseId: string | null; index: number; expiresAt: number } | null = null

/**
 * Касание строки треклиста (не мышью): трек запускается сразу, а
 * синтетический click следом гасится — только для той же строки того же
 * (открытого) релиза.
 */
export function handleTrackPointer(index: number): void {
    pendingTrackClickGuard = { releaseId: view.viewedReleaseId, index, expiresAt: performance.now() + 450 }
    handleTrackClick(index, 'pointer')
}

// Клик по строке треклиста: index — трек ОТКРЫТОГО релиза.
// Тот же трек, что играет, — пауза/продолжить, любой другой — запуск.
export function handleTrackClick(index: number, source: 'click' | 'pointer' = 'click'): void {
    const releaseId = view.viewedReleaseId
    if (!releaseId) return
    if (source === 'click' && pendingTrackClickGuard) {
        const guard = pendingTrackClickGuard
        const now = performance.now()
        if (guard.releaseId === releaseId && guard.index === index && now <= guard.expiresAt) {
            pendingTrackClickGuard = null
            return
        }
        if (now > guard.expiresAt) pendingTrackClickGuard = null
    }
    if (player.currentReleaseId === releaseId && player.currentTrackIndex === index) togglePlay()
    else playTrackByRef(releaseId, index, 'fade')
}

// ── Засчёт прослушивания ────────────────────────────────────────────────

export async function countPlay(): Promise<void> {
    if (!player.currentReleaseId || player.trackCounted || player.trackCountPending) return
    // Всё, что входит в ключ, фиксируем до await: пока идёт запрос,
    // может заиграть другой трек.
    const releaseId = player.currentReleaseId
    const trackIndex = player.currentTrackIndex
    const session = player.playSession
    // Защита от мусорных ключей: «release--1» база прочитала бы как
    // старый 1-based формат и засчитала бы первому треку релиза.
    if (!releases[releaseId]?.tracks[trackIndex] || !Number.isInteger(trackIndex) || trackIndex < 0) return
    const isSameSession = () => player.playSession === session
    player.trackCountPending = true
    try {
        const ok = await incrementPlayCount(releaseId, trackIndex)
        // Флаг относится к запуску, который засчитывали: новый запуск
        // (даже того же трека) должен засчитаться сам.
        if (ok && isSameSession()) player.trackCounted = true
    } finally {
        if (isSameSession()) player.trackCountPending = false
    }
}

// ── Мини-плеер и громкость ──────────────────────────────────────────────

function setMiniPlayerVisible(visible: boolean) {
    player.visible = visible
}

export function closeMiniPlayer(): void {
    getAudio()?.pause()
    player.isPlaying = false
    setMiniPlayerVisible(false)
}

export function setVolume(value: number): void {
    const audio = getAudio()
    if (!audio || !Number.isFinite(value)) return
    audio.volume = value
    audio.muted = false
    player.muted = false
    player.sliderValue = value
}

export function toggleMute(): void {
    const audio = getAudio()
    if (!audio) return
    audio.muted = !audio.muted
    player.muted = audio.muted
    player.sliderValue = audio.muted ? 0 : (audio.volume || 0.5)
}

// ── Подключение <audio> ─────────────────────────────────────────────────

/** Ключ играющего трека в статистике: «<releaseId>-<индекс>». */
export function currentStatsKey(): string | null {
    const release = player.currentRelease
    const index = player.currentTrackIndex
    if (!release || !player.currentReleaseId || !Number.isInteger(index) || !release.tracks[index]) return null
    return `${player.currentReleaseId}-${index}`
}

/** Вызывает MiniPlayer.vue при монтировании, один раз за жизнь страницы. */
export function attachAudio(audio: HTMLAudioElement): void {
    setAudio(audio)
    audio.preload = 'auto'
    audio.volume = player.sliderValue

    let lastProgress = -1
    let lastSecond = -1
    audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return
        const currentTime = audio.currentTime
        // Шаг 0,2% и целые секунды — без лишних перерисовок.
        const progress = Math.round((currentTime / audio.duration) * 100 * 5) / 5
        if (progress !== lastProgress) {
            lastProgress = progress
            player.progress = progress
        }
        const second = Math.floor(currentTime)
        if (second !== lastSecond) {
            lastSecond = second
            player.currentSecond = second
        }
        updateKaraoke()
        if (currentTime >= COUNT_AFTER_SEC && !player.trackCounted && !player.trackCountPending) void countPlay()
    })
    audio.addEventListener('loadedmetadata', () => { player.duration = audio.duration })
    audio.addEventListener('ended', nextTrack)

    // Кнопки на экране блокировки, в шторке и на наушниках делают то же, что
    // кнопки плеера: «следующий» в Потоке — случайный трек.
    setupMediaSession({
        audio,
        getNowPlaying: () => {
            const release = player.currentRelease
            const track = release?.tracks[player.currentTrackIndex]
            return release && track ? { title: track.title, album: release.title, cover: release.cover } : null
        },
        play: () => { if (audio.paused) togglePlay() },
        pause: () => { if (!audio.paused) togglePlay() },
        next: nextTrack,
        prev: prevTrack,
        seek: (time) => { audio.currentTime = time }
    })

    // Сессии прослушивания (дослушивают или пропускают).
    setupListenTracker({
        audio,
        getTrackKey: currentStatsKey,
        send: createListenSender(SUPABASE_URL, SUPABASE_ANON_KEY, currentAccessToken)
    })
}
