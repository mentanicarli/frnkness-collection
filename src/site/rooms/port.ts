import { watch } from 'vue'
import {
    applyRemotePlayback,
    getPlaybackInfo,
    onAudioAttached,
    pauseRemote,
    playRemote,
    releaseRemote,
    seekRemoteMs,
    setRemoteQueue,
    unlockAudio,
    type PlaybackInfo,
    type RemoteApplyResult
} from '../player/engine'
import type { Queue } from '../player/queue'
import { player } from '../player/state'

/**
 * Связь комнат с плеером сайта: всё, что комнате нужно от плеера, — здесь.
 * Контроллер (./store.ts) работает с этим интерфейсом, поэтому в тестах
 * вместо настоящего <audio> подставляется подделка.
 */
export interface PlayerPort {
    info(): PlaybackInfo
    queue(): Queue | null
    /** 'guest' блокирует кнопки плеера; 'host' и null — плеер обычный. */
    setRole(role: 'host' | 'guest' | null): void
    apply(queue: Queue, playing: boolean, targetMs: () => number): RemoteApplyResult
    setQueue(queue: Queue): void
    seekMs(ms: number): void
    play(): Promise<boolean>
    pause(): void
    /** Гость вышел: замолчать и убрать чужую очередь. */
    release(): void
    /** Звук разрешают только по нажатию: вызывать до любых await. */
    unlock(): void
    /** Хозяин: что-то изменилось (трек, очередь, пауза, перемотка). */
    onChange(cb: () => void): () => void
}

export const playerPort: PlayerPort = {
    info: getPlaybackInfo,
    queue: () => player.queue,
    setRole: (role) => {
        player.roomRole = role
    },
    apply: applyRemotePlayback,
    setQueue: setRemoteQueue,
    seekMs: seekRemoteMs,
    play: playRemote,
    pause: pauseRemote,
    release: releaseRemote,
    unlock: unlockAudio,
    onChange(cb) {
        const stopWatch = watch(() => [player.playSession, player.queue, player.isPlaying] as const, () => cb())
        let detach = () => undefined as void
        const stopAudio = onAudioAttached((audio) => {
            const events = ['seeked', 'play', 'pause'] as const
            events.forEach((e) => audio.addEventListener(e, cb))
            detach = () => events.forEach((e) => audio.removeEventListener(e, cb))
        })
        return () => {
            stopWatch()
            stopAudio()
            detach()
        }
    }
}
