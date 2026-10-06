/**
 * «Что сейчас слушает» (видно только друзьям): сайт сообщает базе id
 * играющего трека. Нагрузка минимальная:
 *   — при смене трека, но не чаще раза в минуту (последний трек серии
 *     быстрых переключений уходит, когда минута пройдёт);
 *   — пока играет, раз в 2 минуты — чтобы запись не устарела (друзья
 *     видят тех, кто слушал в последние 5 минут);
 *   — на паузе ничего не шлём: через 5 минут человек пропадает сам.
 */

export const MIN_INTERVAL_MS = 60_000
export const HEARTBEAT_MS = 120_000

export interface NowPlayingDeps {
    send(trackId: string): Promise<unknown>
    now(): number
    setTimeout(fn: () => void, ms: number): unknown
    clearTimeout(handle: unknown): void
}

export function createNowPlayingReporter(deps: NowPlayingDeps) {
    let lastSentAt = -Infinity
    let lastSentTrack: string | null = null
    let current: { trackId: string | null; playing: boolean } = { trackId: null, playing: false }
    let timer: unknown = null

    function schedule(ms: number) {
        if (timer !== null) deps.clearTimeout(timer)
        timer = deps.setTimeout(() => {
            timer = null
            tick()
        }, Math.max(0, ms))
    }

    function stop() {
        if (timer !== null) deps.clearTimeout(timer)
        timer = null
    }

    function tick() {
        const { trackId, playing } = current
        if (!trackId || !playing) return stop()
        const sinceLast = deps.now() - lastSentAt
        if (sinceLast < MIN_INTERVAL_MS) return schedule(MIN_INTERVAL_MS - sinceLast)
        // Тот же трек — только раз в HEARTBEAT_MS.
        if (trackId === lastSentTrack && sinceLast < HEARTBEAT_MS) return schedule(HEARTBEAT_MS - sinceLast)
        lastSentAt = deps.now()
        lastSentTrack = trackId
        void deps.send(trackId).catch(() => undefined)
        schedule(HEARTBEAT_MS)
    }

    return {
        /** Состояние плеера изменилось (трек или пауза). */
        update(trackId: string | null, playing: boolean) {
            current = { trackId, playing }
            tick()
        },
        /** Выход из аккаунта: забыть всё. */
        reset() {
            stop()
            current = { trackId: null, playing: false }
            lastSentAt = -Infinity
            lastSentTrack = null
        }
    }
}
