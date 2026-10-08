import { shallowReactive } from 'vue'
import { SocialError } from '../social/api'
import type { RoomApi, RoomInfo, RoomMember, RoomView } from './api'
import type { ChannelEvents, ChannelFactory, PresenceEntry, RoomChannel } from './channel'
import type { ServerClock } from './clock'
import { rlog } from './log'
import type { ChangeKind, PlayerPort } from './port'
import { REACTION_EVENT, type ReactionEmoji, type ReactionItem, createReactionHub, isReactionEmoji, parseReaction, reactionTopic } from './reactions'
import {
    CLOCK_RESYNC_MS,
    CONNECT_ATTEMPTS,
    CONNECT_BACKOFF_MS,
    GUEST_CHECK_MS,
    LINK_DOWN_REOPEN_MS,
    HEARTBEAT_MS,
    HOST_BEACON_MS,
    HOST_RESYNC_MS,
    HOST_STALE_MS,
    SEEK_DETECT_MS,
    type CommandStamp,
    type HostState,
    type HostWatch,
    type PlaybackTarget,
    type RoomPlayerState,
    type StartPlan,
    decideDrift,
    decideSeek,
    expectedPositionMs,
    hostOnline,
    isNewerCommand,
    msUntilStart,
    parseBeacon,
    parseRoomState,
    planStart,
    resumeSeq,
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
    /** Летящие сейчас реакции (не больше REACTIONS_ON_SCREEN). */
    reactions: readonly ReactionItem[]
    /** Канал реакций открыт: кнопки можно нажимать. */
    reactionsReady: boolean
    /** Цифры синхронизации для отладочной панели (RoomDebug.vue). */
    debug: SyncDebug
}

export interface SyncDebug {
    /** Сдвиг часов устройства относительно сервера (serverNow = Date.now() + offsetMs). */
    offsetMs: number
    /** Задержка запрос-ответ до сервера (лучшая проба). */
    rttMs: number
    /** Гость: на сколько мс его позиция впереди (+) или позади (−) хозяина. null — не играет. */
    driftMs: number | null
    /** Текущая скорость звука (1 — обычная; подстройка — 0,96…1,04). */
    rate: number
    /** Гость: сколько шло последнее сообщение от хозяина (по часам сервера, приблизительно). */
    netMs: number | null
    /** Гость: на сколько мс запоздал последний назначенный старт (0 — вовремя). */
    startLateMs: number | null
    /** Номер последней команды хозяина. */
    seq: number
}

const initialDebug = (): SyncDebug => ({ offsetMs: 0, rttMs: 0, driftMs: null, rate: 1, netMs: null, startLateMs: null, seq: 0 })

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
    nextRandom: false,
    reactions: [],
    reactionsReady: false,
    debug: initialDebug()
})

export const createRoomState = (): RoomUiState => shallowReactive(initialState())

const REFRESH_DEBOUNCE_MS = 1500
const PLAY_RETRY_MS = 3000
const NEXT_SHOWN = 5

/** Что хозяин сообщил гостям последним: положение трека в серверный момент at. */
interface Announced {
    trackId: string | null
    playing: boolean
    posMs: number
    at: number
    queueRef: unknown
}

interface Session {
    view: RoomView
    role: 'host' | 'guest'
    epoch: number
    channel: RoomChannel | null
    presence: Map<string, PresenceEntry>
    /** Последняя применённая команда хозяина: старые и повторные сообщения отбрасываются. */
    applied: CommandStamp
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
    /** Хозяин: номер последней команды (растёт сам, после перезагрузки — с сохранённого в базе). */
    cmdSeq: number
    /** Хозяин: сколько маячков отправлено в рамках последней команды. */
    beat: number
    /** Хозяин: что сказано гостям (для распознавания паузы, перемотки и смены трека). */
    announced: Announced | null
    /** Хозяин: назначенный старт, до которого звук держим на паузе. */
    plan: (StartPlan & { trackId: string }) | null
    planTimer: ReturnType<typeof setTimeout> | null
    /** Гость: таймер назначенного старта. */
    startTimer: ReturnType<typeof setTimeout> | null
    /** Хозяин: запись в базу идёт параллельно рассылке; здесь последнее, что ещё не записано. */
    persistPending: RoomPlayerState | null
    persisting: boolean
    refreshTimer: ReturnType<typeof setTimeout> | null
    refreshing: boolean
    /** Пока шёл запрос, попросили обновить ещё раз: данные могли устареть. */
    refreshAgain: boolean
    timers: ReturnType<typeof setInterval>[]
    offs: (() => void)[]
    closing: boolean
    /** Канал реакций (топик roomfx:…): отдельный от канала команд, лучшее из возможного — комнате не мешает. */
    fx: RoomChannel | null
    fxTimer: ReturnType<typeof setTimeout> | null
    fxAttempt: number
}

export function createRoomController(deps: RoomDeps, state: RoomUiState = createRoomState()) {
    const { api, port, clock } = deps
    let session: Session | null = null
    /** Номер попытки подключения: устаревшие (человек успел нажать другое) бросаются. */
    let startToken = 0
    let restoring = false

    // Реакции: что летит на экране и кого пускать (частота, потолок, участник).
    const hub = createReactionHub({
        now: () => Date.now(),
        random: () => Math.random(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        // Ник берём из списка участников, а не из сообщения: чужому тексту не верим.
        nickOf: (userId) => state.members.find((m) => m.id === userId)?.nick ?? null,
        onChange: (items) => {
            state.reactions = items
        }
    })

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
        if (s.planTimer) clearTimeout(s.planTimer)
        if (s.startTimer) clearTimeout(s.startTimer)
        s.plan = null
        if (s.refreshTimer) clearTimeout(s.refreshTimer)
        if (s.downTimer) clearTimeout(s.downTimer)
        port.setHostHook(null)
        port.setRole(null)
        if (s.role === 'guest') port.reset()
        await stopReactions(s)
        hub.clear()
        await s.channel?.stop().catch(() => undefined)
        if (announce) deps.notify(announce)
    }

    /**
     * Выйти из комнаты на этой вкладке (в базе всё уже сделано или не нужно):
     * кнопка «Выйти», кик, закрытие хозяином или админом, закрытие по простою.
     * Плеер сбрасывается полностью — и у гостя, и у хозяина.
     */
    async function leaveLocal(announce?: string): Promise<void> {
        startToken++
        await stopSession(announce)
        port.reset()
        resetState()
    }

    function newSession(view: RoomView): Session {
        return {
            view,
            role: view.is_owner ? 'host' : 'guest',
            epoch: view.epoch,
            channel: null,
            presence: new Map(),
            applied: { seq: 0, beat: -1 },
            target: null,
            stale: false,
            hostBye: false,
            downTimer: null,
            hostSeenMs: view.owner_seen_ms,
            watch: { absentSince: Date.now() },
            lastSeekAt: null,
            lastPlayAttemptAt: 0,
            cmdSeq: 0,
            beat: 0,
            announced: null,
            plan: null,
            planTimer: null,
            startTimer: null,
            persistPending: null,
            persisting: false,
            refreshTimer: null,
            refreshing: false,
            refreshAgain: false,
            timers: [],
            offs: [],
            closing: false,
            fx: null,
            fxTimer: null,
            fxAttempt: 0
        }
    }

    const current = (s: Session): boolean => session === s && !s.closing

    // ── Реакции ────────────────────────────────────────────────────────
    // Отдельный канал (топик roomfx:…): в него пишут все участники. Он не
    // влияет на комнату: не открылся — просто нет реакций, остальное работает.

    const FX_RETRY_MS = 8000
    const FX_ATTEMPTS = 5

    async function stopReactions(s: Session): Promise<void> {
        if (s.fxTimer) clearTimeout(s.fxTimer)
        s.fxTimer = null
        const ch = s.fx
        s.fx = null
        if (session === s || !session) state.reactionsReady = false
        await ch?.stop().catch(() => undefined)
    }

    function onReaction(s: Session, event: string, payload: unknown): void {
        if (!current(s) || event !== REACTION_EVENT) return
        const reaction = parseReaction(payload)
        // Свои реакции приходят только локально (self: false), ещё раз — не показываем.
        if (!reaction || reaction.from === deps.me()?.id) return
        // Отправителя ещё нет в нашем списке (только что вошёл): эту реакцию
        // отбрасываем, но список обновляем — следующие уже покажутся.
        if (!state.members.some((m) => m.id === reaction.from)) return scheduleRefresh(s)
        hub.show(reaction.from, reaction.emoji)
    }

    async function startReactions(s: Session): Promise<void> {
        const me = deps.me()
        if (!current(s) || !me) return
        await stopReactions(s)
        if (!current(s)) return
        const channel = deps.channel(reactionTopic(s.view.id, s.epoch), me.id, {
            onBroadcast: (event, payload) => onReaction(s, event, payload),
            onPresence: () => undefined,
            onReconnect: () => undefined,
            onDown: () => undefined
        })
        try {
            await channel.start()
        } catch (e) {
            rlog('реакции: канал не открылся', String(e instanceof Error ? e.message : e))
            await channel.stop().catch(() => undefined)
            if (current(s) && s.fxAttempt < FX_ATTEMPTS) {
                s.fxAttempt++
                s.fxTimer = setTimeout(() => {
                    s.fxTimer = null
                    void startReactions(s)
                }, FX_RETRY_MS)
            }
            return
        }
        if (!current(s)) {
            await channel.stop().catch(() => undefined)
            return
        }
        s.fx = channel
        s.fxAttempt = 0
        state.reactionsReady = true
    }

    /** Нажатие на эмодзи. Лишние нажатия (частота, потолок на экране) молча игнорируются. */
    function react(emoji: ReactionEmoji): void {
        const s = session
        const me = deps.me()
        if (!s || !current(s) || !me || !s.fx || state.status !== 'live' || !isReactionEmoji(emoji)) return
        if (!hub.show(me.id, emoji)) return
        void s.fx.send(REACTION_EVENT, { from: me.id, emoji })
    }

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
        state.debug = initialDebug()
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
        void startReactions(s)
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
        s.timers.push(setInterval(() => void clock.sync().then(() => showClock()), CLOCK_RESYNC_MS))
        if (s.role === 'host') {
            // Маячок «я здесь» — гостям, чтобы сверять звук; запись в базу — реже.
            s.timers.push(setInterval(() => beacon(s), HOST_BEACON_MS))
            s.timers.push(setInterval(() => persistSnapshot(s), HOST_RESYNC_MS))
            // Вкладку закрывают: гости не ждут, пока Presence заметит, а сразу начинают отсчёт.
            s.offs.push(deps.onHide(() => void s.channel?.send('bye', { epoch: s.epoch })))
        } else {
            s.timers.push(setInterval(() => tick(s), GUEST_CHECK_MS))
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
                if (ps && view.at_ms !== null) applyState(s, ps, { seq: ps.cseq ?? view.seq, beat: 0 }, ps.at_ms ?? view.at_ms, false)
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
        if (s.role === 'host') beacon(s)
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
        // Канал вернулся: хозяин напоминает гостям полное состояние (они могли пропустить команду).
        if (current(s) && s.role === 'host') announceNow(s)
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
        // Реакции переезжают на топик новой эпохи вместе с комнатой.
        s.fxAttempt = 0
        void startReactions(s)
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
            const ps = parseRoomState(p.state)
            const at = ps?.at_ms ?? p.at
            const seq = ps?.cseq ?? p.seq
            if (typeof seq !== 'number' || typeof at !== 'number' || !ps) return
            noteDelivery(s, p.sent)
            s.hostSeenMs = clock.now()
            s.hostBye = false
            applyState(s, ps, { seq, beat: 0 }, at, true)
        } else if (event === 'hb') {
            const b = parseBeacon(p)
            if (b) applyBeacon(s, b)
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

    function showClock(): void {
        state.debug = { ...state.debug, offsetMs: clock.offsetMs(), rttMs: clock.rttMs() }
    }

    /** Сколько шло сообщение хозяина (часы сервера у обоих, так что это честная оценка). */
    function noteDelivery(s: Session, sent: unknown): void {
        if (typeof sent !== 'number' || !Number.isFinite(sent)) return
        state.debug = { ...state.debug, netMs: Math.round(clock.now() - sent), offsetMs: clock.offsetMs(), rttMs: clock.rttMs(), seq: s.applied.seq }
    }

    // ── Гость ──────────────────────────────────────────────────────────

    function guestEnter(s: Session): void {
        // Хозяин молчит дольше минуты — не играем устаревшее состояние.
        s.stale = clock.now() - s.view.owner_seen_ms >= HOST_STALE_MS
        const ps = parseRoomState(s.view.state)
        if (ps && s.view.at_ms !== null) applyState(s, ps, { seq: ps.cseq ?? s.view.seq, beat: 0 }, ps.at_ms ?? s.view.at_ms, false)
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
            cancelGuestStart(s)
            if (port.info().playing) port.pause()
            state.playing = false
        }
    }

    function cancelGuestStart(s: Session): void {
        if (s.startTimer) clearTimeout(s.startTimer)
        s.startTimer = null
    }

    /**
     * Команда хозяина (broadcast или room_get): трек, очередь, позиция и — если она
     * в будущем — назначенный старт. Старые номера отбрасываются.
     */
    function applyState(s: Session, ps: RoomPlayerState, stamp: CommandStamp, atMs: number, fresh: boolean): void {
        if (!isNewerCommand(stamp, s.applied)) return
        s.applied = stamp
        s.target = { posMs: ps.pos_ms, atMs, playing: ps.playing }
        state.debug = { ...state.debug, seq: stamp.seq }
        // Новое состояние пришло от хозяина лично — он вернулся.
        if (fresh) s.stale = false
        showPlayback(ps)
        if (!ps.queue || !ps.track_id) {
            cancelGuestStart(s)
            port.pause()
            return
        }
        const queue = toPlayerQueue(ps.queue, 'remote')
        const next = upcomingTrackIds(ps.queue, 1)[0]
        if (next) port.preload(next)
        if (port.info().trackId !== ps.track_id) {
            cancelGuestStart(s)
            // Позицию считаем, когда трек загрузится, а не сейчас; играть или ждать
            // назначенного старта решает reconcile — он же вызывается, когда трек готов.
            const result = port.apply(queue, false, () => expectedPositionMs(s.target ?? { posMs: ps.pos_ms, atMs, playing: ps.playing }, clock.now(), port.info().durationMs), () => reconcile(s, true))
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

    /** Маячок хозяина: где он сейчас. Нужен, чтобы звук не расходился между командами. */
    function applyBeacon(s: Session, b: ReturnType<typeof parseBeacon> & object): void {
        if (!isNewerCommand(b, s.applied)) return
        // Маячок про трек, о котором мы не знаем (команду потеряли): берём состояние из базы.
        if (!s.target || b.track_id !== state.nowTrackId) {
            scheduleRefresh(s)
            return
        }
        s.applied = { seq: b.seq, beat: b.beat }
        noteDelivery(s, b.sent)
        s.hostSeenMs = clock.now()
        s.hostBye = false
        s.stale = false
        s.target = { posMs: b.pos_ms, atMs: b.at, playing: b.playing }
        reconcile(s, false)
    }

    function tick(s: Session): void {
        evaluateHost(s)
        reconcile(s, false)
    }

    /** Звук гостя начинается: позиция — на момент, когда звук реально пойдёт (с поправкой на запуск). */
    function startPlayback(s: Session): void {
        const target = s.target
        if (!target) return
        const info = port.info()
        const latency = port.startLatencyMs()
        const expected = expectedPositionMs(target, clock.now() + latency, info.durationMs)
        if (Math.abs(info.positionMs - expected) > 40) {
            port.seekMs(expected)
            s.lastSeekAt = Date.now()
        }
        state.playing = true
        s.lastPlayAttemptAt = Date.now()
        void port.play().then((ok) => {
            if (current(s)) state.needsGesture = !ok
        })
    }

    /** Назначенный старт: ждём момент T (с запасом на запуск звука) и пускаем звук. */
    function armGuestStart(s: Session): void {
        if (!s.target) return
        cancelGuestStart(s)
        const wait = msUntilStart(s.target.atMs, clock.now(), port.startLatencyMs())
        if (wait <= 0) {
            fireGuestStart(s)
            return
        }
        // Сначала грубое ожидание, в конце — точное: таймеры браузера неточны на длинных отрезках.
        s.startTimer = setTimeout(() => {
            s.startTimer = null
            armGuestStart(s)
        }, wait > 60 ? wait - 30 : wait)
    }

    function fireGuestStart(s: Session): void {
        if (!current(s) || s.role !== 'guest' || !s.target?.playing || s.stale || state.hostState === 'away') return
        const info = port.info()
        if (info.trackId !== state.nowTrackId || !info.ready) return // трек ещё грузится: его готовность вызовет reconcile
        const late = clock.now() + port.startLatencyMs() - s.target.atMs
        state.debug = { ...state.debug, startLateMs: Math.max(0, Math.round(late)) }
        startPlayback(s)
    }

    /** Подогнать звук под состояние хозяина: играть/пауза, ждать назначенного старта, выравнивать скорость. */
    function reconcile(s: Session, force: boolean): void {
        if (!current(s) || s.role !== 'guest' || !s.target) return
        const info = port.info()
        const target = s.target
        if (state.hostState === 'away' || s.stale || !target.playing) {
            cancelGuestStart(s)
            if (info.playing) port.pause()
            if (info.rate !== 1) port.setRate(1)
            state.playing = false
            state.debug = { ...state.debug, driftMs: null, rate: 1 }
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
        const now = clock.now()
        state.playing = true

        // Старт назначен на будущее: до него стоим в начальной точке, в момент T пускаем звук.
        if (now < target.atMs - port.startLatencyMs()) {
            if (info.playing) port.pause()
            if (info.rate !== 1) port.setRate(1)
            if (Math.abs(info.positionMs - target.posMs) > 50) {
                port.seekMs(target.posMs)
                s.lastSeekAt = Date.now()
            }
            state.debug = { ...state.debug, driftMs: null, rate: 1 }
            armGuestStart(s)
            return
        }

        const expected = expectedPositionMs(target, now, info.durationMs)
        // Трек у хозяина уже доиграл, следующего ещё нет: стоим, а не начинаем заново.
        if (info.durationMs !== null && expected >= info.durationMs - 300) {
            if (info.playing) port.pause()
            return
        }
        if (!info.playing) {
            // Время пришло, а звука нет: запускаем (повторно — не чаще раза в PLAY_RETRY_MS).
            if (Date.now() - s.lastPlayAttemptAt >= PLAY_RETRY_MS) startPlayback(s)
            return
        }
        // Играем: выравниваем скоростью, а при большом расхождении перематываем.
        const diff = info.positionMs - expected
        const verdict = decideDrift(diff, expected, { now: Date.now(), lastSeekAt: s.lastSeekAt, currentRate: info.rate, force })
        if (verdict.action === 'seek') {
            port.seekMs(verdict.toMs)
            s.lastSeekAt = Date.now()
        }
        if (verdict.rate !== info.rate) port.setRate(verdict.rate)
        state.debug = { ...state.debug, driftMs: Math.round(diff), rate: verdict.rate, offsetMs: clock.offsetMs(), rttMs: clock.rttMs() }
    }

    // ── Хозяин ─────────────────────────────────────────────────────────

    async function hostEnter(s: Session): Promise<void> {
        const view = s.view
        const saved = parseRoomState(view.state)
        const info = port.info()
        const restoring = !info.trackId && Boolean(saved?.queue) && view.at_ms !== null
        // Номера команд продолжаются с сохранённого в базе, а не с нуля: иначе гости, уже видевшие
        // более поздние номера, отбросили бы всё, что хозяин пошлёт после перезагрузки.
        s.cmdSeq = resumeSeq(view.seq, saved)
        if (restoring && saved?.queue && view.at_ms !== null) {
            // Перезагрузка хозяина: возвращаем то, что играло, но на паузе — с того
            // места, где он последний раз был на связи.
            const seenAt = Math.min(view.owner_seen_ms, view.server_ms)
            const at = saved.at_ms ?? view.at_ms
            const pos = expectedPositionMs({ posMs: saved.pos_ms, atMs: at, playing: saved.playing }, Math.max(seenAt, at))
            port.apply(toPlayerQueue(saved.queue, 'local'), false, () => pos)
        }
        port.setHostHook({
            start: (opts) => scheduleStart(s, opts.gapless),
            pending: () => Boolean(s.plan),
            cancel: () => cancelPlan(s)
        })
        s.offs.push(port.onChange((kind) => onHostChange(s, kind)))
        // Восстановленный трек ещё грузится и стоит в начале: первое сообщение — когда плеер
        // дойдёт до нужной позиции (по его событию), иначе гости на миг прыгнули бы к началу.
        if (!restoring) announceNow(s)
    }

    /** Разослать состояние гостям сразу, не дожидаясь базы; запись в базу идёт параллельно. */
    function command(s: Session, ps: RoomPlayerState): void {
        const at = ps.at_ms ?? clock.now()
        s.announced = { trackId: ps.track_id, playing: ps.playing, posMs: ps.pos_ms, at, queueRef: port.queue() }
        s.beat = 0
        showPlayback(ps)
        state.debug = { ...state.debug, seq: s.cmdSeq, offsetMs: clock.offsetMs(), rttMs: clock.rttMs() }
        void s.channel?.send('state', { seq: ps.cseq, beat: 0, at, sent: clock.now(), epoch: s.epoch, state: ps })
        persist(s, ps)
    }

    /** Сообщить гостям, что происходит у хозяина прямо сейчас (пауза, смена очереди, возврат связи). */
    function announceNow(s: Session): void {
        if (!current(s) || s.role !== 'host') return
        const info = port.info()
        command(s, snapshotState(port.queue(), info.positionMs, info.playing, { atMs: clock.now(), cseq: ++s.cmdSeq }))
    }

    /**
     * Хозяин запускает звук (трек, «играть», перемотка во время игры): всем, включая его
     * самого, назначается общий момент старта — «сейчас + запас». До него звук держим на
     * паузе, трек за это время успевает загрузиться.
     */
    function scheduleStart(s: Session, gapless: boolean): void {
        if (!current(s) || s.role !== 'host') return
        const info = port.info()
        if (!info.trackId) return
        cancelPlanTimer(s)
        port.hold()
        const plan = planStart(clock.now(), info.positionMs, { gapless, rttMs: clock.rttMs() })
        s.plan = { ...plan, trackId: info.trackId }
        command(s, snapshotState(port.queue(), plan.posMs, true, { atMs: plan.startAt, cseq: ++s.cmdSeq }))
        armHostStart(s)
    }

    function cancelPlanTimer(s: Session): void {
        if (s.planTimer) clearTimeout(s.planTimer)
        s.planTimer = null
    }

    function armHostStart(s: Session): void {
        cancelPlanTimer(s)
        const plan = s.plan
        if (!plan) return
        const wait = msUntilStart(plan.startAt, clock.now(), port.startLatencyMs())
        if (wait <= 0) {
            fireHostStart(s)
            return
        }
        s.planTimer = setTimeout(() => {
            s.planTimer = null
            armHostStart(s)
        }, wait > 60 ? wait - 30 : wait)
    }

    function fireHostStart(s: Session): void {
        const plan = s.plan
        if (!plan || !current(s)) return
        s.plan = null
        const info = port.info()
        if (info.trackId !== plan.trackId) return // трек успели сменить: новая команда уже идёт
        const target = plan.posMs + Math.max(0, clock.now() + port.startLatencyMs() - plan.startAt)
        if (Math.abs(info.positionMs - target) > 30) port.seekMs(target)
        void port.play()
    }

    /** Хозяин нажал паузу, пока старт ещё не наступил: стоим у всех сразу. */
    function cancelPlan(s: Session): void {
        if (!s.plan) return
        cancelPlanTimer(s)
        s.plan = null
        port.hold()
        announceNow(s)
    }

    /**
     * Что-то изменилось в плеере хозяина. Сверяем с тем, что сказано гостям: пауза,
     * смена очереди — сообщаем сразу; перемотка или звук «мимо расписания» — снова назначаем старт.
     */
    function onHostChange(s: Session, kind: ChangeKind): void {
        if (!current(s) || s.role !== 'host' || s.plan) return
        const info = port.info()
        const a = s.announced
        if (!a) return announceNow(s)
        if (info.trackId !== a.trackId || info.playing !== a.playing) {
            if (info.playing) return scheduleStart(s, false)
            return announceNow(s)
        }
        if (kind === 'seeked') {
            const expected = expectedPositionMs({ posMs: a.posMs, atMs: a.at, playing: a.playing }, clock.now(), info.durationMs)
            if (Math.abs(info.positionMs - expected) > SEEK_DETECT_MS) return info.playing ? scheduleStart(s, false) : announceNow(s)
        }
        if (port.queue() !== a.queueRef) announceNow(s)
    }

    /** Маячок: где хозяин сейчас — по нему гости выравнивают звук между командами. */
    function beacon(s: Session): void {
        if (!current(s) || s.role !== 'host' || s.plan) return
        const info = port.info()
        const a = s.announced
        if (!a || !info.trackId || info.trackId !== a.trackId) return
        const now = clock.now()
        s.announced = { ...a, playing: info.playing, posMs: info.positionMs, at: now }
        state.debug = { ...state.debug, offsetMs: clock.offsetMs(), rttMs: clock.rttMs() }
        void s.channel?.send('hb', { seq: s.cmdSeq, beat: ++s.beat, sent: now, at: now, epoch: s.epoch, track_id: info.trackId, pos_ms: Math.round(info.positionMs), playing: info.playing })
    }

    /** Раз в несколько секунд: записать текущее состояние в базу (для вошедших позже и признаков жизни). */
    function persistSnapshot(s: Session): void {
        if (!current(s) || s.role !== 'host' || s.plan) return
        const info = port.info()
        persist(s, snapshotState(port.queue(), info.positionMs, info.playing, { atMs: clock.now(), cseq: s.cmdSeq }))
    }

    /** Запись в базу идёт параллельно рассылке и по очереди: пока летит запрос, копится только последнее состояние. */
    function persist(s: Session, ps: RoomPlayerState): void {
        s.persistPending = ps
        if (s.persisting) return
        void (async () => {
            s.persisting = true
            try {
                while (s.persistPending && current(s)) {
                    const next = s.persistPending
                    s.persistPending = null
                    await api.setState(s.view.id, next)
                }
            } catch (e) {
                if (current(s) && e instanceof SocialError && e.code === 'P0002') void leaveLocal('Комната закрыта')
                // Прочие ошибки: следующая команда или запись через HOST_RESYNC_MS попробует снова.
            } finally {
                s.persisting = false
            }
        })()
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
        announceNow(s)
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
        const wasIn = Boolean(session)
        await stopSession()
        if (wasIn) port.reset()
        resetState()
    }

    function info(roomId: string): Promise<RoomInfo> {
        return api.info(roomId)
    }

    return { state, restore, create, join, connect, enableSound, leave, close, kick, invite, reload, reset, info, react }
}

export type RoomController = ReturnType<typeof createRoomController>
