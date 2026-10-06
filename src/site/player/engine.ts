import { SUPABASE_ANON_KEY, SUPABASE_URL, releases } from '@/config'
import { buildAssetUrl } from '@/utils/helpers'
import { findTrackById } from '@/utils/trackIds'
import { setupMediaSession } from '@/runtime/mediaSession'
import { createListenSender, setupListenTracker } from '@/runtime/listenTracker'
import { currentAccessToken } from '../session'
import { updatePageAccent, updatePlayerAccent } from '../services/colors'
import { incrementPlayCount } from '../services/stats'
import { view } from '../stores/view'
import { getAudio, setAudio } from './audio'
import { loadLyrics, updateKaraoke } from './karaoke'
import {
    type Queue,
    type QueueSource,
    createEndlessQueue,
    createListQueue,
    currentTrackId,
    jumpTo,
    nextInQueue,
    prevInQueue,
    setQueueShuffle
} from './queue'
import { karaoke, player } from './state'

/**
 * Движок плеера: очередь (./queue.ts), запуск треков, пауза, перемотка,
 * Поток, перемешивание, громкость, засчёт прослушиваний. Отрисовку делают
 * MiniPlayer.vue и FullscreenPlayer.vue по состоянию из ./state.
 */

type Direction = 'next' | 'prev' | 'fade' | null

const COUNT_AFTER_SEC = 10

/** Трек есть в каталоге (иначе — «недоступен», очередь его пропускает). */
export const isTrackAvailable = (trackId: string): boolean => findTrackById(releases, trackId) !== null

const releaseTrackIds = (releaseId: string): string[] => releases[releaseId]?.tracks.map((t) => t.id) ?? []
const catalogTrackIds = (): string[] => Object.values(releases).flatMap((r) => r.tracks.map((t) => t.id))

// ── Очередь ─────────────────────────────────────────────────────────────

function setQueue(queue: Queue | null) {
    player.queue = queue
    player.flowModeActive = queue?.source.kind === 'flow'
}

/** Сделать очередь текущей и запустить её текущий трек. */
function playFromQueue(queue: Queue, direction: Direction): void {
    const ref = findTrackById(releases, currentTrackId(queue) ?? '')
    if (!ref) return
    setQueue(queue)
    player.currentRelease = releases[ref.releaseId]
    player.currentReleaseId = ref.releaseId
    startTrack(ref.trackIndex, direction)
}

/**
 * Очередь целиком извне. Этап 4: очередь комнаты присылает хозяин —
 * с controller 'remote' кнопки «вперёд/назад» гостя её не двигают.
 */
export function replaceQueue(queue: Queue, direction: Direction = 'fade'): void {
    playFromQueue(queue, direction)
}

/**
 * Список треков (плейлист, избранное) с трека startIndex. С
 * перемешиванием — если оно включено или передано явно.
 */
export function playList(source: QueueSource, trackIds: readonly string[], startIndex = 0, options: { shuffle?: boolean } = {}): void {
    const shuffle = options.shuffle ?? player.shuffle
    if (options.shuffle !== undefined) player.shuffle = options.shuffle
    const queue = createListQueue(source, trackIds, startIndex, isTrackAvailable, { shuffle })
    if (queue) playFromQueue(queue, 'fade')
}

/** Перемешать список и начать со случайного трека. */
export function playListShuffled(source: QueueSource, trackIds: readonly string[]): void {
    const available = trackIds.map((id, i) => (isTrackAvailable(id) ? i : -1)).filter((i) => i >= 0)
    if (!available.length) return
    playList(source, trackIds, available[Math.floor(Math.random() * available.length)], { shuffle: true })
}

// ── Поток ───────────────────────────────────────────────────────────────

/** Бесконечный случайный порядок по пулу: весь каталог или избранное. */
function startEndless(source: QueueSource, pool: readonly string[]): void {
    const queue = createEndlessQueue(source, pool, isTrackAvailable)
    if (queue) playFromQueue(queue, 'fade')
}

export function startFlowMode(): void {
    startEndless({ kind: 'flow' }, catalogTrackIds())
}

/** Поток по избранному (своему или друга). */
export function startFavoritesFlow(ownerId: string, trackIds: readonly string[]): void {
    startEndless({ kind: 'favorites-flow', ownerId }, trackIds)
}

/** Выключить Поток: трек доигрывает, дальше — по его релизу. */
export function stopFlowMode(): void {
    const queue = player.queue
    if (!queue?.endless || !player.currentReleaseId) {
        player.flowModeActive = false
        return
    }
    setQueue(createListQueue({ kind: 'release', releaseId: player.currentReleaseId }, releaseTrackIds(player.currentReleaseId), player.currentTrackIndex, isTrackAvailable, { shuffle: player.shuffle }))
}

export function toggleFlowMode(): void {
    if (player.flowModeActive) stopFlowMode()
    else startFlowMode()
}

/** Перемешивание: для списков — сразу, для Потока смысла нет (и так случайно). */
export function toggleShuffle(): void {
    if (player.queue?.controller === 'remote') return
    player.shuffle = !player.shuffle
    if (player.queue && !player.queue.endless) player.queue = setQueueShuffle(player.queue, player.shuffle)
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

// Трек релиза: треклист, поиск, чарт, страница трека. Очередь — этот
// релиз; если играет Поток по каталогу — он продолжается с этого трека.
export function playTrackByRef(releaseId: string, trackIndex: number, direction: Direction = 'fade'): void {
    const release = releases[releaseId]
    const track = release?.tracks[trackIndex]
    if (!release || !track) return
    const queue = player.queue
    if (queue?.source.kind === 'flow' && queue.controller === 'local') {
        const jumped = jumpTo(queue, queue.trackIds.indexOf(track.id))
        if (jumped) return playFromQueue(jumped, direction)
    }
    const next = createListQueue({ kind: 'release', releaseId }, releaseTrackIds(releaseId), trackIndex, () => true, { shuffle: player.shuffle })
    if (next) playFromQueue(next, direction)
}

// Трек index ИГРАЮЩЕГО релиза — в той же очереди, если это очередь релиза.
export function playTrack(index: number, direction: Direction = null): void {
    const releaseId = player.currentReleaseId
    const queue = player.queue
    if (!releaseId) return
    if (queue?.source.kind === 'release' && queue.source.releaseId === releaseId) {
        const jumped = jumpTo(queue, index)
        if (jumped) return playFromQueue(jumped, direction)
    }
    playTrackByRef(releaseId, index, direction)
}

let trackStartSeq = 0

// Запуск трека index играющего релиза (player.currentRelease уже выставлен
// очередью).
function startTrack(index: number, direction: Direction): void {
    const release = player.currentRelease
    const audio = getAudio()
    const track = release?.tracks[index]
    if (!release || !track || !audio) return

    player.currentTrackId = track.id
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

    // Следующий по списку — заранее (в Потоке следующий заранее неизвестен).
    const upcoming = player.queue && !player.queue.endless ? nextInQueue(player.queue, isTrackAvailable) : null
    const upcomingRef = upcoming ? findTrackById(releases, currentTrackId(upcoming) ?? '') : null
    if (upcomingRef) preloadTrackMetadata(upcomingRef.releaseId, upcomingRef.trackIndex)

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

// «Вперёд/назад», конец трека, экран блокировки — по очереди любого
// источника. Очередь хозяина комнаты (controller 'remote') гость не двигает.
export function nextTrack(): void {
    const queue = player.queue
    if (!queue || queue.controller === 'remote') return
    const next = nextInQueue(queue, isTrackAvailable)
    if (next) playFromQueue(next, 'next')
}

export function prevTrack(): void {
    const queue = player.queue
    if (!queue || queue.controller === 'remote') return
    const prev = prevInQueue(queue, isTrackAvailable)
    if (prev) playFromQueue(prev, 'prev')
    else seekTo(0)
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
