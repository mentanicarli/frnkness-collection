import { player } from './state'

/**
 * Сторож воспроизведения: запускает <audio>, замечает, что звук не пошёл
 * (браузер не разрешил, сеть оборвалась, файл не отдался), и не молчит об
 * этом: пробует ещё раз, потом показывает «Нажми, чтобы играть», а причину
 * отправляет в журнал ошибок.
 *
 * play() вызывается СИНХРОННО из обработчика нажатия (iOS не разрешает звук,
 * если перед ним был await); всё остальное — после.
 */

/** Задержки перед повторами: 1, 3 и 7 секунд. */
export const RETRY_DELAYS_MS = [1000, 3000, 7000] as const
/** Сколько ждать начала звука после play(), прежде чем считать запуск зависшим. */
export const START_TIMEOUT_MS = 10_000
/** Сколько терпим остановку буфера посреди трека. */
export const STALL_TIMEOUT_MS = 8000

export type PlayFailure = 'blocked' | 'unsupported' | 'aborted' | 'other'

/** Причина отказа промиса play(). */
export function classifyPlayError(err: unknown): PlayFailure {
    const name = (err as { name?: string } | null)?.name
    if (name === 'NotAllowedError') return 'blocked'
    if (name === 'NotSupportedError') return 'unsupported'
    if (name === 'AbortError') return 'aborted'
    return 'other'
}

const MEDIA_ERRORS: Record<number, string> = {
    1: 'загрузка прервана',
    2: 'сеть',
    3: 'файл не раскодировался',
    4: 'файл недоступен или не поддерживается'
}

export function describeMediaError(code: number | undefined): string {
    return (code && MEDIA_ERRORS[code]) || 'ошибка плеера'
}

export interface PlaybackGuardDeps {
    audio: HTMLAudioElement
    /** Ключ играющего трека «<релиз>-<индекс>» — для журнала. */
    getTrackKey(): string | null
    /** Записать в журнал ошибок сайта. */
    report(message: string): void
    online?(): boolean
    win?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

export interface PlaybackGuard {
    /** Запуск по нажатию. Вызывать синхронно в обработчике. Результат: true — пошёл, false — нет. */
    play(): Promise<boolean>
    /** Человек (или система) поставил паузу: не пытаться продолжать. */
    userPause(): void
    /** Новый трек: забыть всё про прошлый. */
    reset(): void
    destroy(): void
}

export function createPlaybackGuard(deps: PlaybackGuardDeps): PlaybackGuard {
    const { audio } = deps
    const isOnline = deps.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
    const win = deps.win ?? (typeof window !== 'undefined' ? window : undefined)

    // Нужно ли сейчас играть (человек не ставил на паузу).
    let want = false
    let attempts = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let startTimer: ReturnType<typeof setTimeout> | null = null
    let stallTimer: ReturnType<typeof setTimeout> | null = null
    let waitingOnline = false
    // Растёт при каждом новом треке: поздний ответ старого запуска игнорируется.
    let epoch = 0

    function clearTimers() {
        if (retryTimer) clearTimeout(retryTimer)
        if (startTimer) clearTimeout(startTimer)
        if (stallTimer) clearTimeout(stallTimer)
        retryTimer = startTimer = stallTimer = null
        if (waitingOnline) {
            win?.removeEventListener('online', onOnline)
            waitingOnline = false
        }
    }

    function note(reason: string) {
        const key = deps.getTrackKey() ?? '-'
        deps.report(
            `Не удалось начать воспроизведение: ${reason} [трек ${key}, readyState ${audio.readyState}, networkState ${audio.networkState}, ${isOnline() ? 'онлайн' : 'офлайн'}, попытка ${attempts + 1}]`
        )
    }

    function giveUp(reason: string) {
        clearTimers()
        want = false
        player.isPlaying = false
        player.playback = 'tap'
        note(reason)
    }

    function onOnline() {
        waitingOnline = false
        if (!want || player.playback === 'ok') return
        if (retryTimer) clearTimeout(retryTimer)
        retryTimer = null
        void restart()
    }

    function scheduleRetry(reason: string) {
        if (!want) return
        if (retryTimer) return
        if (attempts >= RETRY_DELAYS_MS.length) return giveUp(`${reason} (после ${attempts} повторов)`)
        // Первую неудачу в журнал не пишем: чаще всего повтор помогает. Пишем, если не помог.
        player.playback = 'retrying'
        const delay = RETRY_DELAYS_MS[attempts]
        attempts += 1
        if (!isOnline() && win) {
            // Без сети повторять бессмысленно: ждём её возвращения.
            if (!waitingOnline) {
                waitingOnline = true
                win.addEventListener('online', onOnline, { once: true })
            }
        }
        const myEpoch = epoch
        retryTimer = setTimeout(() => {
            retryTimer = null
            if (myEpoch !== epoch || !want) return
            void restart()
        }, delay)
    }

    /** Перечитать текущий файл с того же места. */
    function reloadKeepingPosition() {
        const at = audio.currentTime
        audio.load()
        if (at > 0) {
            const restore = () => {
                audio.removeEventListener('loadedmetadata', restore)
                try { audio.currentTime = at } catch { /* позиция недоступна */ }
            }
            audio.addEventListener('loadedmetadata', restore)
        }
    }

    /** Повтор после неудачи: файл перечитываем, если он не загружен. */
    function restart(): Promise<boolean> {
        if (audio.src && (audio.error || audio.networkState === 3 /* NETWORK_NO_SOURCE */ || audio.readyState < 2)) reloadKeepingPosition()
        return start()
    }

    function armStartTimer() {
        if (startTimer) clearTimeout(startTimer)
        const myEpoch = epoch
        startTimer = setTimeout(() => {
            startTimer = null
            if (myEpoch !== epoch || !want) return
            if (!audio.paused && audio.readyState >= 3) return
            scheduleRetry('звук не начался за 10 секунд')
        }, START_TIMEOUT_MS)
    }

    function start(): Promise<boolean> {
        const myEpoch = epoch
        want = true
        let promise: Promise<void> | undefined
        try {
            promise = audio.play() as Promise<void> | undefined
        } catch (err) {
            return Promise.resolve(fail(err, myEpoch))
        }
        armStartTimer()
        if (!promise || typeof promise.then !== 'function') {
            player.isPlaying = true
            return Promise.resolve(true)
        }
        return promise.then(
            () => {
                if (myEpoch === epoch) {
                    player.isPlaying = true
                    player.playback = 'ok'
                }
                return true
            },
            (err) => fail(err, myEpoch)
        )
    }

    function fail(err: unknown, myEpoch: number): boolean {
        if (myEpoch !== epoch) return false
        const kind = classifyPlayError(err)
        if (kind === 'aborted') {
            // Запуск прервал новый файл или пауза — не отказ.
            return false
        }
        if (kind === 'blocked') {
            // Браузер хочет нажатия: повторять без жеста бесполезно.
            clearTimers()
            want = false
            player.isPlaying = false
            player.playback = 'tap'
            note('браузер не разрешил звук без нажатия')
            return false
        }
        const detail = kind === 'unsupported' ? 'файл недоступен или не поддерживается' : `${(err as { name?: string } | null)?.name ?? 'ошибка'}`
        player.isPlaying = false
        scheduleRetry(detail)
        return false
    }

    function begin(): Promise<boolean> {
        attempts = 0
        clearTimers()
        // Предыдущая попытка не удалась: файл перечитываем, а не просим play() на мёртвом источнике.
        const recovering = player.playback !== 'ok'
        if (audio.src && (audio.error || audio.networkState === 3 || (recovering && audio.readyState < 3))) reloadKeepingPosition()
        player.playback = 'ok'
        return start()
    }

    // ── События <audio> ──

    const onPlaying = () => {
        if (!player.currentTrackId) return // тишина разблокировки комнаты
        attempts = 0
        if (startTimer) clearTimeout(startTimer)
        if (stallTimer) clearTimeout(stallTimer)
        startTimer = stallTimer = null
        player.isPlaying = true
        player.playback = 'ok'
    }
    const onProgress = () => {
        if (stallTimer) clearTimeout(stallTimer)
        stallTimer = null
    }
    const onWaiting = () => {
        if (!want || !player.currentTrackId || stallTimer) return
        const myEpoch = epoch
        stallTimer = setTimeout(() => {
            stallTimer = null
            if (myEpoch !== epoch || !want || audio.readyState >= 3) return
            scheduleRetry('буфер остановился (связь)')
        }, STALL_TIMEOUT_MS)
    }
    const onError = () => {
        if (!want || !player.currentTrackId) return
        const code = audio.error?.code
        if (code === 1) return
        player.isPlaying = false
        scheduleRetry(describeMediaError(code))
    }
    const onPause = () => {
        // Пауза не от нас (звонок, наушники, система): сторож ничего не возобновляет.
        // Браузер сам «ставит на паузу» при сбое загрузки — это обрыв, а не пауза: им занимаются повторы.
        if (audio.ended || !player.currentTrackId || audio.error || retryTimer || player.playback !== 'ok') return
        want = false
        clearTimers()
        player.isPlaying = false
    }

    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('timeupdate', onProgress)
    audio.addEventListener('canplay', onProgress)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('stalled', onWaiting)
    audio.addEventListener('error', onError)
    audio.addEventListener('pause', onPause)

    return {
        play: begin,
        userPause() {
            want = false
            clearTimers()
            player.playback = 'ok'
        },
        reset() {
            epoch += 1
            attempts = 0
            clearTimers()
            player.playback = 'ok'
        },
        destroy() {
            clearTimers()
            audio.removeEventListener('playing', onPlaying)
            audio.removeEventListener('timeupdate', onProgress)
            audio.removeEventListener('canplay', onProgress)
            audio.removeEventListener('waiting', onWaiting)
            audio.removeEventListener('stalled', onWaiting)
            audio.removeEventListener('error', onError)
            audio.removeEventListener('pause', onPause)
        }
    }
}
