import { watch } from 'vue'
import {
    applyRemotePlayback,
    getPlaybackInfo,
    onAudioAttached,
    getStartLatencyMs,
    holdRemote,
    pauseRemote,
    playRemote,
    preloadRoomTrack,
    resetPlayer,
    seekRemoteMs,
    setHostHook,
    setPlaybackRate,
    setRemoteQueue,
    unlockAudio,
    type HostHook,
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
export type ChangeKind = 'state' | 'seeked' | 'play' | 'pause'

export interface PlayerPort {
    info(): PlaybackInfo
    queue(): Queue | null
    /** 'guest' блокирует кнопки плеера; 'host' и null — плеер обычный. */
    setRole(role: 'host' | 'guest' | null): void
    /** Загрузить очередь и трек; когда он готов (canplay) — перемотать на targetMs() и вызвать onReady. */
    apply(queue: Queue, playing: boolean, targetMs: () => number, onReady?: () => void): RemoteApplyResult
    setQueue(queue: Queue): void
    seekMs(ms: number): void
    play(): Promise<boolean>
    pause(): void
    /** Остановить звук, не меняя вид плеера: хозяин ждёт назначенного старта (кнопка остаётся «играет»). */
    hold(): void
    /** Выход из комнаты: плеер как после загрузки страницы (тишина, пустая очередь, закрытый мини-плеер). */
    reset(): void
    /** Скорость воспроизведения (подстройка гостя под хозяина). */
    setRate(rate: number): void
    /** Заранее загрузить трек (следующий в очереди), чтобы переход был без паузы. */
    preload(trackId: string): void
    /** Сколько мс проходит от play() до звука: старт назначают на это раньше. */
    startLatencyMs(): number
    /** Хозяин: нажатие «играть» отдаётся комнате, она пускает звук по расписанию. */
    setHostHook(hook: HostHook | null): void
    /** Звук разрешают только по нажатию: вызывать до любых await. */
    unlock(): void
    /** Хозяин: что-то изменилось (трек, очередь, пауза, перемотка); kind — что именно случилось с <audio>. */
    onChange(cb: (kind: ChangeKind) => void): () => void
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
    hold: holdRemote,
    reset: resetPlayer,
    setRate: setPlaybackRate,
    preload: preloadRoomTrack,
    startLatencyMs: getStartLatencyMs,
    setHostHook,
    unlock: unlockAudio,
    onChange(cb) {
        const stopWatch = watch(() => [player.playSession, player.queue, player.isPlaying] as const, () => cb('state'))
        let detach = () => undefined as void
        const stopAudio = onAudioAttached((audio) => {
            const events = ['seeked', 'play', 'pause'] as const
            const handlers = events.map((e) => [e, () => cb(e)] as const)
            handlers.forEach(([e, h]) => audio.addEventListener(e, h))
            detach = () => handlers.forEach(([e, h]) => audio.removeEventListener(e, h))
        })
        return () => {
            stopWatch()
            stopAudio()
            detach()
        }
    }
}
