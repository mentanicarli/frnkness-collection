import { shallowReactive } from 'vue'
import { SocialError } from '../social/api'
import type { RoomApi, RoomInfo, RoomMember, RoomView } from './api'
import type { ChannelEvents, ChannelFactory, PresenceEntry, RoomChannel } from './channel'
import type { ServerClock } from './clock'
import { rlog } from './log'
import type { PlayerPort } from './port'
import {
    CLOCK_RESYNC_MS,
    CONNECT_ATTEMPTS,
    CONNECT_BACKOFF_MS,
    LINK_DOWN_REOPEN_MS,
    HEARTBEAT_MS,
    HOST_RESYNC_MS,
    HOST_STALE_MS,
    type HostState,
    type HostWatch,
    type PlaybackTarget,
    type RoomPlayerState,
    decideSeek,
    expectedPositionMs,
    hostOnline,
    parseRoomState,
    roomTopic,
    snapshotState,
    stepHostWatch,
    toPlayerQueue,
    upcomingTrackIds
} from './sync'

/**
 * Комната: один контроллер на вкладку. Хозяин играет обычным плеером — всё,
 * что он включает, сохраняется в базе (room_set_state) и рассылается по каналу;
 * гость повторяет это у себя, подстраиваясь под часы сервера.
 *
 * Состояние для экранов — `room` (реактивное). Контроллер не знает ни про Vue-
 * компоненты, ни про настоящий <audio>, ни про сеть: всё приходит через deps,
 * поэтому его проверяют тестами с подделками (src/site/__tests__/roomsController.test.ts).
 */

export interface RoomDeps {
    api: RoomApi
    channel: ChannelFactory
    port: PlayerPort
    clock: ServerClock
    me(): { id: string } | null
    notify(text: string, error?: boolean): void
    /** Вкладка снова на экране. */
    onVisible(cb: () => void): () => void
    /** Вкладку закрывают или перезагружают (pagehide). */
    onHide(cb: () => void): () => void
}

export interface RoomUiState {
    status: 'idle' | 'connecting' | 'live' | 'error'
    roomId: string | null
    title: string
    epoch: number
    ownerId: string | null
    isOwner: boolean
    members: RoomMember[]
    /** Кто сейчас в канале (по Presence). */
    online: string[]
    hostState: HostState
    /** Номер попытки подключения (1…CONNECT_ATTEMPTS), пока статус 'connecting'. */
    attempt: number
    /** Канал оборвался, клиент возвращается: показываем «Переподключаемся…». */
    linkDown: boolean
    /** Участник в базе, но в этой вкладке не подключён (перезагрузка): нужно нажатие. */
    needsConnect: boolean
    /** Браузер не пустил звук без нажатия. */
    needsGesture: boolean
    /** У хозяина трек, которого нет в этой версии сайта. */
    outdated: boolean
    playing: boolean
    nowTrackId: string | null
    nextTrackIds: string[]
    /** Следующий трек неизвестен заранее (Поток). */
    nextRandom: boolean
}

const initialState = (): RoomUiState => ({
    status: 'idle',
    roomId: null,
    title: '',
    epoch: 0,
    ownerId: null,
    isOwner: false,
    members: [],
    online: [],
    hostState: 'online',
    attempt: 0,
    linkDown: false,
    needsConnect: false,
    needsGesture: false,
    outdated: false,
    playing: false,
    nowTrackId: null,
    nextTrackIds: [],
    nextRandom: false
})

export const createRoomState = (): RoomUiState => shallowReactive(initialState())

const PUBLISH_DEBOUNCE_MS = 150
const REFRESH_DEBOUNCE_MS = 1500
const PLAY_RETRY_MS = 3000
const TICK_MS = 1000
const NEXT_SHOWN = 5

interface Session {
    view: RoomView
    role: 'host' | 'guest'
    epoch: number
    channel: RoomChannel | null
    presence: Map<string, PresenceEntry>
    /** Последний применённый номер состояния: старые и повторные команды отбрасываются. */
    lastSeq: number
    target: PlaybackTarget | null
    /** Состояние устарело (хозяин пропал): не играем, пока не придёт новое. */
    stale: boolean
    /** Хозяин сообщил, что закрывает вкладку: считаем его ушедшим, не дожидаясь Presence. */
    hostBye: boolean
    downTimer: ReturnType<typeof setTimeout> | null
    /** Серверное время (мс), когда мы в последний раз слышали хозяина. */
    hostSeenMs: number
    watch: HostWatch
    lastSeekAt: number | null
    lastPlayAttemptAt: number
    publishTimer: ReturnType<typeof setTimeout> | null
    publishing: boolean
    dirty: boolean
    refreshTimer: ReturnType<typeof setTimeout> | null
    refreshing: boolean
    /** Пока шёл запрос, попросили обновить ещё раз: данные могли устареть. */
    refreshAgain: boolean
    timers: ReturnType<typeof setInterval>[]
    offs: (() => void)[]
    closing: boolean
}

export function createRoomController(deps: RoomDeps, state: RoomUiState = createRoomState()) {
    const { api, port, clock } = deps
    let session: Session | null = null
    /** Номер попытки подключения: устаревшие (человек успел нажать другое) бросаются. */
    let startToken = 0
    let restoring = false

    // ── Состояние для экранов ──────────────────────────────────────────

    function showView(view: RoomView): void {
        state.roomId = view.id
        state.title = view.title
        state.epoch = view.epoch
        state.ownerId = view.owner.id
        state.isOwner = view.is_owner
        state.members = view.members
    }

    function resetState(): void {
        Object.assign(state, initialState())
    }

    function showPlayback(ps: RoomPlayerState | null): void {
        state.playing = Boolean(ps?.playing)
        state.nowTrackId = ps?.track_id ?? null
        state.nextTrackIds = ps?.queue ? upcomingTrackIds(ps.queue, NEXT_SHOWN) : []
        state.nextRandom = Boolean(ps?.queue?.endless)
    }

    // ── Сеанс ──────────────────────────────────────────────────────────

    async function stopSession(announce?: string): Promise<void> {
        const s = session
        if (!s) return
        session = null
        s.closing = true
        s.timers.forEach((t) => clearInterval(t))
        s.offs.forEach((off) => off())
        if (s.publishTimer) clearTimeout(s.publishTimer)
        if (s.refreshTimer) clearTimeout(s.refreshTimer)
        if (s.downTimer) clearTimeout(s.downTimer)
        port.setRole(null)
        if (s.role === 'guest') port.release()
        await s.channel?.stop().catch(() => undefined)
        if (announce) deps.notify(announce)
    }

    /** Выйти из комнаты на этой вкладке (в базе всё уже сделано или не нужно). */
    async function leaveLocal(announce?: string): Promise<void> {
        startToken++
        await stopSession(announce)
        resetState()
    }

    function newSession(view: RoomView): Session {
        return {
            view,
            role: view.is_owner ? 'host' : 'guest',
            epoch: view.epoch,
            channel: null,
            presence: new Map(),
            lastSeq: 0,
            target: null,
            stale: false,
            hostBye: false,
            downTimer: null,
            hostSeenMs: view.owner_seen_ms,
            watch: { absentSince: Date.now() },
            lastSeekAt: null,
            lastPlayAttemptAt: 0,
            publishTimer: null,
            publishing: false,
            dirty: false,
            refreshTimer: null,
            refreshing: false,
            refreshAgain: false,
            timers: [],
            offs: [],
            closing: false
        }
    }

    const current = (s: Session): boolean => session === s && !s.closing

    async function startSession(view: RoomView): Promise<void> {
        const token = ++startToken
        await stopSession()
        const me = deps.me()
        if (!me) return
        const s = newSession(view)
        session = s
        showView(view)
        state.status = 'connecting'
        state.needsConnect = false
        state.needsGesture = false
        state.outdated = false
        state.online = []
        state.hostState = 'online'
        showPlayback(null)
        port.setRole(s.role)
        rlog('вход в комнату', view.id, s.role, `эпоха ${view.epoch}`)
        try {
            // Часы сверяем параллельно с подключением: каждая секунда ожидания заметна.
            await Promise.all([clock.sync(), connectWithRetry(s, me.id, token)])
        } catch (e) {
            if (token === startToken && current(s)) {
                rlog('подключение не удалось после всех попыток', String(e))
                state.status = 'error'
                deps.notify('Не удалось подключиться к комнате — проверь интернет и нажми «Подключиться»', true)
                await stopSession()
                state.needsConnect = true
            }
            return
        }
        if (token !== startToken || !current(s)) return
        state.status = 'live'
        state.attempt = 0
        rlog('в комнате', view.id, s.role)
        startTimers(s)
        if (s.role === 'host') await hostEnter(s)
        else guestEnter(s)
    }

    async function openChannel(s: Session, userId: string): Promise<void> {
        const events: ChannelEvents = {
            onBroadcast: (event, payload) => onBroadcast(s, event, payload),
            onPresence: (users) => onPresence(s, users),
            onReconnect: () => void onReconnect(s),
            onDown: () => onDown(s)
        }
        const channel = deps.channel(roomTopic(s.view.id, s.epoch), userId, events)
        s.channel = channel
        await channel.start()
        await channel.track({ role: s.role })
    }

    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

    /**
     * Войти в канал с повторами: первый вход в приватный канал на настоящем
     * Realtime бывает неудачным (токен ещё не дошёл, сервер «просыпается»).
     * Каждая попытка — новый канал; всё это время статус «Подключаемся…».
     */
    async function connectWithRetry(s: Session, userId: string, token: number): Promise<void> {
        let last: unknown = null
        for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
            if (token !== startToken || !current(s)) throw new Error('отменено')
            const delay = CONNECT_BACKOFF_MS[Math.min(attempt - 1, CONNECT_BACKOFF_MS.length - 1)]
            if (delay) await wait(delay)
            if (token !== startToken || !current(s)) throw new Error('отменено')
            state.attempt = attempt
            try {
                rlog('попытка подключения', attempt, 'из', CONNECT_ATTEMPTS)
                await openChannel(s, userId)
                return
            } catch (e) {
                last = e
                rlog('попытка', attempt, 'не удалась:', String(e instanceof Error ? e.message : e))
                const failed = s.channel
                s.channel = null
                await failed?.stop().catch(() => undefined)
            }
        }
        throw last ?? new Error('канал не открылся')
    }

    /** Канал оборвался: клиент сам пробует вернуться; не вернулся за LINK_DOWN_REOPEN_MS — открываем заново. */
    function onDown(s: Session): void {
        if (!current(s)) return
        rlog('связь оборвалась, ждём возвращения')
        state.linkDown = true
        if (s.downTimer) return
        s.downTimer = setTimeout(() => {
            s.downTimer = null
            if (!current(s) || !state.linkDown) return
            const me = deps.me()
            if (!me) return
            rlog('связь не вернулась, открываем канал заново')
            const old = s.channel
            s.channel = null
            void (async () => {
                await old?.stop().catch(() => undefined)
                try {
                    await connectWithRetry(s, me.id, startToken)
                    state.linkDown = false
                    await onReconnect(s)
                } catch {
                    rlog('не удалось открыть канал заново')
                    if (current(s)) onDown(s)
                }
            })()
        }, LINK_DOWN_REOPEN_MS)
    }

    function startTimers(s: Session): void {
        s.timers.push(setInterval(() => void heartbeat(s), HEARTBEAT_MS))
        s.timers.push(setInterval(() => void clock.sync(), CLOCK_RESYNC_MS))
        if (s.role === 'host') {
            s.timers.push(setInterval(() => schedulePublish(s, true), HOST_RESYNC_MS))
            // Вкладку закрывают: гости не ждут, пока Presence заметит, а сразу начинают отсчёт.
            s.offs.push(deps.onHide(() => void s.channel?.send('bye', { epoch: s.epoch })))
        } else {
            s.timers.push(setInterval(() => tick(s), TICK_MS))
        }
        s.offs.push(deps.onVisible(() => void onVisible(s)))
    }

    // ── Сердцебиение и обновление ──────────────────────────────────────

    async function heartbeat(s: Session): Promise<void> {
        if (!current(s)) return
        try {
            const hb = await api.heartbeat(s.view.id)
            if (!current(s)) return
            if (!hb.member) {
                if (hb.closed) return void (await leaveLocal('Комната закрыта'))
                const info = await api.info(s.view.id).catch(() => null)
                return void (await leaveLocal(info && !info.closed && info.kicked ? 'Тебя выгнали из комнаты' : 'Ты больше не в этой комнате'))
            }
            if (hb.epoch !== undefined && hb.epoch !== s.epoch) await rekey(s, hb.epoch)
        } catch {
            // Сеть моргнула — следующее сердцебиение через 45 секунд.
        }
    }

    /** Свежие данные комнаты: участники, название, состояние. */
    async function refresh(s: Session): Promise<void> {
        if (!current(s)) return
        if (s.refreshing) {
            s.refreshAgain = true
            return
        }
        s.refreshing = true
        try {
            const view = await api.get(s.view.id)
            if (!current(s)) return
            s.view = view
            showView(view)
            if (view.epoch !== s.epoch) await rekey(s, view.epoch)
            if (s.role === 'guest') {
                s.hostSeenMs = Math.max(s.hostSeenMs, view.owner_seen_ms)
                const ps = parseRoomState(view.state)
                if (ps && view.at_ms !== null) applyState(s, ps, view.seq, view.at_ms, false)
            }
        } catch (e) {
            if (current(s) && e instanceof SocialError && e.code === 'P0002') await leaveLocal('Комната закрыта')
        } finally {
            s.refreshing = false
            if (s.refreshAgain) {
                s.refreshAgain = false
                void refresh(s)
            }
        }
    }

    function scheduleRefresh(s: Session): void {
        if (s.refreshTimer || !current(s)) return
        s.refreshTimer = setTimeout(() => {
            s.refreshTimer = null
            void refresh(s)
        }, REFRESH_DEBOUNCE_MS)
    }

    async function onVisible(s: Session): Promise<void> {
        if (!current(s)) return
        await clock.sync()
        await refresh(s)
        if (!current(s)) return
        if (s.role === 'host') schedulePublish(s, true)
        else reconcile(s, true)
    }

    async function onReconnect(s: Session): Promise<void> {
        if (!current(s)) return
        rlog('связь вернулась')
        state.linkDown = false
        if (s.downTimer) {
            clearTimeout(s.downTimer)
            s.downTimer = null
        }
        await s.channel?.track({ role: s.role }).catch(() => undefined)
        await refresh(s)
        if (current(s) && s.role === 'host') schedulePublish(s, true)
    }

    /** Новая эпоха (кого-то выгнали): переезд на новый топик. */
    async function rekey(s: Session, epoch: number): Promise<void> {
        const me = deps.me()
        if (!current(s) || !me || epoch === s.epoch) return
        s.epoch = epoch
        state.epoch = epoch
        const old = s.channel
        s.channel = null
        s.presence = new Map()
        await old?.stop().catch(() => undefined)
        if (!current(s)) return
        try {
            await connectWithRetry(s, me.id, startToken)
        } catch {
            deps.notify('Не удалось переподключиться к комнате', true)
        }
    }

    // ── Presence и сообщения ───────────────────────────────────────────

    function onPresence(s: Session, users: Map<string, PresenceEntry>): void {
        if (!current(s)) return
        const before = state.online.join(',')
        s.presence = users
        state.online = [...users.keys()].sort()
        // Пришёл или ушёл человек — обновляем список участников из базы.
        if (state.online.join(',') !== before) scheduleRefresh(s)
        if (s.role === 'guest') evaluateHost(s)
    }

    function onBroadcast(s: Session, event: string, payload: unknown): void {
        if (!current(s) || s.role !== 'guest' || !payload || typeof payload !== 'object') return
        const p = payload as Record<string, unknown>
        if (event === 'state') {
            const seq = p.seq
            const at = p.at
            const ps = parseRoomState(p.state)
            if (typeof seq !== 'number' || typeof at !== 'number' || !ps) return
            s.hostSeenMs = clock.now()
            s.hostBye = false
            applyState(s, ps, seq, at, true)
        } else if (event === 'kick') {
            const epoch = Number(p.epoch)
            if (p.user_id === deps.me()?.id) void leaveLocal('Тебя выгнали из комнаты')
            else if (Number.isInteger(epoch) && epoch > s.epoch) void rekey(s, epoch).then(() => refresh(s))
        } else if (event === 'bye') {
            rlog('хозяин закрывает вкладку')
            s.hostBye = true
            evaluateHost(s)
        } else if (event === 'close') {
            void leaveLocal('Хозяин закрыл комнату')
        }
    }

    // ── Гость ──────────────────────────────────────────────────────────

    function guestEnter(s: Session): void {
        // Хозяин молчит дольше минуты — не играем устаревшее состояние.
        s.stale = clock.now() - s.view.owner_seen_ms >= HOST_STALE_MS
        const ps = parseRoomState(s.view.state)
        if (ps && s.view.at_ms !== null) applyState(s, ps, s.view.seq, s.view.at_ms, false)
        evaluateHost(s)
    }

    function evaluateHost(s: Session): void {
        if (!current(s) || s.role !== 'guest') return
        const online = !s.hostBye && hostOnline(s.presence.has(s.view.owner.id), clock.now() - s.hostSeenMs)
        const step = stepHostWatch(s.watch, online, Date.now())
        s.watch = step.watch
        if (step.state === state.hostState) return
        state.hostState = step.state
        if (step.state === 'away') {
            // Хозяина давно нет: пауза всем, прежнее состояние не продолжаем.
            s.stale = true
            if (port.info().playing) port.pause()
            state.playing = false
        }
    }

    /** Состояние от хозяина (broadcast или room_get). Старые номера отбрасываются. */
    function applyState(s: Session, ps: RoomPlayerState, seq: number, atMs: number, fresh: boolean): void {
        if (seq <= s.lastSeq) return
        s.lastSeq = seq
        s.target = { posMs: ps.pos_ms, atMs, playing: ps.playing }
        // Новое состояние пришло от хозяина лично — он вернулся.
        if (fresh) s.stale = false
        showPlayback(ps)
        if (!ps.queue || !ps.track_id) {
            port.pause()
            return
        }
        const queue = toPlayerQueue(ps.queue, 'remote')
        if (port.info().trackId !== ps.track_id) {
            // Позицию считаем, когда трек загрузится, а не сейчас.
            const result = port.apply(queue, ps.playing && !s.stale && state.hostState !== 'away', () =>
                expectedPositionMs(s.target ?? { posMs: ps.pos_ms, atMs, playing: ps.playing }, clock.now(), port.info().durationMs)
            )
            if (result === 'missing-track') {
                if (!state.outdated) deps.notify('Обнови страницу: у хозяина трек, которого нет в твоей версии сайта')
                state.outdated = true
            } else {
                state.outdated = false
            }
            return
        }
        state.outdated = false
        port.setQueue(queue)
        reconcile(s, true)
    }

    function tick(s: Session): void {
        evaluateHost(s)
        reconcile(s, false)
    }

    /** Подогнать звук под состояние хозяина: играть/пауза и подкрутка позиции. */
    function reconcile(s: Session, force: boolean): void {
        if (!current(s) || s.role !== 'guest' || !s.target) return
        const info = port.info()
        const target = s.target
        if (state.hostState === 'away' || s.stale || !target.playing) {
            if (info.playing) port.pause()
            state.playing = false
            // На паузе хозяина тоже стоим в той же точке.
            if (!target.playing && info.trackId === state.nowTrackId && !s.stale && state.hostState !== 'away') {
                const verdict = decideSeek(info.positionMs, target.posMs, { now: Date.now(), lastSeekAt: s.lastSeekAt, force: true })
                if (verdict.seek) {
                    port.seekMs(verdict.toMs)
                    s.lastSeekAt = Date.now()
                }
            }
            return
        }
        if (info.trackId !== state.nowTrackId || !info.ready) return // трек ещё загружается
        const expected = expectedPositionMs(target, clock.now(), info.durationMs)
        // Трек у хозяина уже доиграл, следующего ещё нет: стоим, а не начинаем заново.
        if (info.durationMs !== null && expected >= info.durationMs - 300) {
            if (info.playing) port.pause()
            return
        }
        const verdict = decideSeek(info.positionMs, expected, { now: Date.now(), lastSeekAt: s.lastSeekAt, force })
        if (verdict.seek) {
            port.seekMs(verdict.toMs)
            s.lastSeekAt = Date.now()
        }
        state.playing = true
        if (!info.playing && Date.now() - s.lastPlayAttemptAt >= PLAY_RETRY_MS) {
            s.lastPlayAttemptAt = Date.now()
            void port.play().then((ok) => {
                if (current(s)) state.needsGesture = !ok
            })
        }
    }

    // ── Хозяин ─────────────────────────────────────────────────────────

    async function hostEnter(s: Session): Promise<void> {
        const view = s.view
        const saved = parseRoomState(view.state)
        const info = port.info()
        const restoring = !info.trackId && Boolean(saved?.queue) && view.at_ms !== null
        if (restoring && saved?.queue && view.at_ms !== null) {
            // Перезагрузка хозяина: возвращаем то, что играло, но на паузе — с того
            // места, где он последний раз был на связи.
            const seenAt = Math.min(view.owner_seen_ms, view.server_ms)
            const pos = expectedPositionMs({ posMs: saved.pos_ms, atMs: view.at_ms, playing: saved.playing }, Math.max(seenAt, view.at_ms))
            port.apply(toPlayerQueue(saved.queue, 'local'), false, () => pos)
        }
        s.lastSeq = view.seq
        s.offs.push(port.onChange(() => schedulePublish(s, false)))
        // Восстановленный трек ещё грузится и стоит в начале: первое сохранение —
        // когда плеер дойдёт до нужной позиции (по его событию), иначе гости
        // на миг прыгнули бы к началу. Страховка — рассылка каждые 15 секунд.
        if (!restoring) await publish(s)
    }

    function schedulePublish(s: Session, immediate: boolean): void {
        if (!current(s) || s.role !== 'host') return
        if (immediate) {
            void publish(s)
            return
        }
        if (s.publishTimer) return
        s.publishTimer = setTimeout(() => {
            s.publishTimer = null
            void publish(s)
        }, PUBLISH_DEBOUNCE_MS)
    }

    /** Сохранить состояние в базе (seq и время выдаёт сервер) и разослать. Запросы идут по очереди. */
    async function publish(s: Session): Promise<void> {
        if (!current(s) || s.role !== 'host') return
        if (s.publishing) {
            s.dirty = true
            return
        }
        s.publishing = true
        try {
            do {
                s.dirty = false
                const info = port.info()
                // Пока запрос летит до сервера, трек уходит вперёд — прибавляем полпути.
                const ps = snapshotState(port.queue(), info.positionMs + (info.playing ? clock.rttMs() / 2 : 0), info.playing)
                const saved = await api.setState(s.view.id, ps)
                if (!current(s)) return
                s.lastSeq = saved.seq
                showPlayback(ps)
                await s.channel?.send('state', { seq: saved.seq, at: saved.at_ms, epoch: saved.epoch, state: ps })
            } while (s.dirty && current(s))
        } catch (e) {
            if (current(s) && e instanceof SocialError && e.code === 'P0002') void leaveLocal('Комната закрыта')
            // Прочие ошибки: следующее изменение или рассылка через 15 секунд попробует снова.
        } finally {
            s.publishing = false
        }
    }

    // ── Действия человека ──────────────────────────────────────────────

    function needSession(role?: 'host' | 'guest'): Session {
        if (!session || session.closing || (role && session.role !== role)) throw new SocialError('Ты не в комнате')
        return session
    }

    /**
     * После входа в аккаунт (и позже, если не вышло): вернуться в свою комнату.
     * Хозяин подключается сам; гость видит «Подключиться» (звук — только по нажатию).
     * Запрос повторяется: сразу после загрузки страницы сеть и токен бывают не готовы.
     */
    async function restore(): Promise<void> {
        if (session || restoring || !deps.me()) return
        restoring = true
        try {
            let view: RoomView | null = null
            for (let attempt = 1; attempt <= 4; attempt++) {
                try {
                    view = await api.my()
                    rlog('моя комната:', view ? `${view.id} (${view.is_owner ? 'хозяин' : 'гость'})` : 'нет')
                    break
                } catch (e) {
                    rlog('не удалось узнать свою комнату, попытка', attempt, String(e))
                    if (attempt < 4) await wait(1000 * attempt)
                    if (!deps.me()) return
                }
            }
            if (!view || session || !deps.me()) return
            showView(view)
            if (view.is_owner) await startSession(view)
            else state.needsConnect = true
        } finally {
            restoring = false
        }
    }

    async function create(title: string): Promise<RoomView> {
        const view = await api.create(title)
        await startSession(view)
        return view
    }

    /** Нажатие «Подключиться»: первым делом (до await) — разблокировка звука. */
    async function join(roomId: string): Promise<RoomView> {
        port.unlock()
        const view = await api.join(roomId)
        await startSession(view)
        return view
    }

    /** Тот же вход для участника, который уже в комнате (после перезагрузки). */
    async function connect(): Promise<void> {
        if (state.roomId) await join(state.roomId)
    }

    /** Включить звук, если браузер не пустил. */
    function enableSound(): void {
        port.unlock()
        const s = session
        if (!s || s.role !== 'guest') return
        s.lastPlayAttemptAt = 0
        state.needsGesture = false
        reconcile(s, true)
    }

    /** Гость выходит из комнаты. */
    async function leave(): Promise<void> {
        if (!state.roomId) return
        if (session?.role === 'host') throw new SocialError('Хозяин не выходит из комнаты, а закрывает её')
        await api.leave()
        await leaveLocal()
    }

    /** Хозяин закрывает комнату: сначала всем сообщаем (после закрытия канал уже не примет). */
    async function close(): Promise<void> {
        const s = needSession('host')
        await s.channel?.send('close', { epoch: s.epoch })
        await api.close(s.view.id)
        await leaveLocal()
    }

    async function kick(userId: string): Promise<void> {
        const s = needSession('host')
        const { epoch } = await api.kick(s.view.id, userId)
        state.members = state.members.filter((m) => m.id !== userId)
        // Сообщение уходит по старому топику, где выгнанный ещё подключён.
        await s.channel?.send('kick', { user_id: userId, epoch })
        await rekey(s, epoch)
        await refresh(s)
        schedulePublish(s, true)
    }

    async function invite(userId: string): Promise<void> {
        const s = needSession('host')
        await api.invite(s.view.id, userId)
    }

    /** Свежий список участников (по просьбе экрана). */
    async function reload(): Promise<void> {
        if (session) await refresh(session)
    }

    /** Выход из аккаунта: просто всё забыть. */
    async function reset(): Promise<void> {
        startToken++
        await stopSession()
        resetState()
    }

    function info(roomId: string): Promise<RoomInfo> {
        return api.info(roomId)
    }

    return { state, restore, create, join, connect, enableSound, leave, close, kick, invite, reload, reset, info }
}

export type RoomController = ReturnType<typeof createRoomController>
