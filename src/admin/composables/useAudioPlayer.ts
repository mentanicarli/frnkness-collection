import { ref, type Ref } from 'vue'

/**
 * Плеер админки — общий для «Караоке» и «Текстов». Состояние и действия
 * здесь, разметка — в components/AudioPlayer.vue.
 *
 * rewindOnResume: после паузы повторный запуск откатывает на REWIND_SEC
 * назад, чтобы не пропустить слово. Если на паузе перемотали — откат не
 * нужен, играем с выбранного места.
 */
export const REWIND_SEC = 2

export interface AudioPlayer {
    audio: Ref<HTMLAudioElement | null>
    playing: Ref<boolean>
    currentTime: Ref<number>
    duration: Ref<number>
    rate: Ref<number>
    error: Ref<boolean>
    rewindOnResume: Ref<boolean>
    togglePlay: () => void
    pause: () => void
    seekTo: (t: number) => void
    seekBy: (d: number) => void
    setRate: (r: number) => void
    /** Новый трек: остановить и сбросить время. */
    reset: () => void
    /** Обработчики событий <audio> — вешает компонент. */
    on: {
        loadedmetadata: () => void
        play: () => void
        pause: () => void
        ended: () => void
        error: () => void
        timeupdate: () => void
    }
}

export function useAudioPlayer(options: { rewindOnResume?: boolean } = {}): AudioPlayer {
    const audio = ref<HTMLAudioElement | null>(null)
    const playing = ref(false)
    const currentTime = ref(0)
    const duration = ref(0)
    const rate = ref(1)
    const error = ref(false)
    const rewindOnResume = ref(options.rewindOnResume ?? false)
    // Где поставили на паузу; null — не на паузе пользователем (или перемотали).
    let pausedAt: number | null = null

    function syncTime() {
        currentTime.value = audio.value?.currentTime ?? 0
    }

    function tick() {
        const el = audio.value
        if (!el) return
        currentTime.value = el.currentTime
        if (!el.paused) requestAnimationFrame(tick)
    }

    function seekTo(t: number) {
        const el = audio.value
        if (!el) return
        el.currentTime = Math.max(0, Math.min(t, el.duration || t))
        currentTime.value = el.currentTime
    }

    function togglePlay() {
        const el = audio.value
        if (!el) return
        if (!el.paused) {
            el.pause()
            return
        }
        if (rewindOnResume.value && pausedAt !== null && Math.abs(el.currentTime - pausedAt) < 0.05) seekTo(pausedAt - REWIND_SEC)
        pausedAt = null
        el.play().catch(() => (error.value = true))
    }

    function pause() {
        audio.value?.pause()
    }

    function setRate(r: number) {
        rate.value = r
        if (audio.value) {
            audio.value.playbackRate = r
            // После смены src браузер берёт скорость отсюда.
            audio.value.defaultPlaybackRate = r
        }
    }

    function reset() {
        audio.value?.pause()
        playing.value = false
        currentTime.value = 0
        duration.value = 0
        error.value = false
        pausedAt = null
    }

    return {
        audio,
        playing,
        currentTime,
        duration,
        rate,
        error,
        rewindOnResume,
        togglePlay,
        pause,
        seekTo,
        seekBy: (d: number) => seekTo((audio.value?.currentTime ?? 0) + d),
        setRate,
        reset,
        on: {
            loadedmetadata: () => {
                duration.value = audio.value?.duration || 0
                if (audio.value) audio.value.playbackRate = rate.value
            },
            play: () => {
                playing.value = true
                error.value = false
                tick()
            },
            pause: () => {
                playing.value = false
                pausedAt = audio.value && !audio.value.ended ? audio.value.currentTime : null
            },
            ended: () => {
                playing.value = false
                pausedAt = null
            },
            error: () => (error.value = true),
            timeupdate: () => {
                syncTime()
                // Перемотали на паузе — откатывать некуда, играем с нового места.
                const el = audio.value
                if (pausedAt !== null && el && el.paused && Math.abs(el.currentTime - pausedAt) >= 0.05) pausedAt = null
            }
        }
    }
}
