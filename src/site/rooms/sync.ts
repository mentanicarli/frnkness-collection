/**
 * Комнаты: чистые функции синхронизации — без Vue, Supabase и <audio>.
 *
 *   — часы: сдвиг часов устройства относительно сервера по нескольким
 *     запросам server_now(); время в комнате считается только по серверу;
 *   — позиция: где сейчас должен быть трек по сохранённому состоянию хозяина;
 *   — подкрутка: когда гость перематывает трек (расхождение больше ~1 с);
 *   — хозяин: «пропал из Presence» — пауза не сразу, а после ожидания;
 *   — состояние плеера на проводе: сжатие очереди и проверка того, что
 *     пришло от хозяина (данные из сети никому не верим на слово).
 */
import { type Queue, type QueueSource, currentTrackId } from '../player/queue'

export const ROOM_CAPACITY = 20
export const ROOM_TITLE_MAX = 40

/** Расхождение, больше которого гость перематывает трек (меньшее выравнивается скоростью). */
export const DRIFT_THRESHOLD_MS = 1200
/** Не перематывать чаще: каждая перемотка слышна как рывок. */
export const SEEK_MIN_GAP_MS = 2000
/** Первая выверка (вход, новый трек, возврат на вкладку): порог мягче. */
export const FORCE_THRESHOLD_MS = 300
/** Сколько ждём хозяина, прежде чем поставить паузу всем. */
export const HOST_GRACE_MS = 15_000
/** Хозяин, от которого давно нет вестей, считается ушедшим, даже если Presence на месте. */
export const HOST_STALE_MS = 45_000
/** Сколько проб server_now() делаем и сколько лучших (по задержке) берём. */
export const CLOCK_SAMPLES = 5
export const CLOCK_BEST = 3
/**
 * Подключение к каналу: попытки с нарастающей паузой. «Подключаемся…» всё это
 * время; ошибку показываем, только если не получилось ни разу из CONNECT_ATTEMPTS.
 */
export const CONNECT_ATTEMPTS = 6
export const CONNECT_BACKOFF_MS = [0, 1000, 2000, 3500, 5000, 8000]
/** Канал оборвался и сам не вернулся за это время — открываем заново. */
export const LINK_DOWN_REOPEN_MS = 20_000
/** Сердцебиение участника и повторная рассылка состояния хозяином. */
export const HEARTBEAT_MS = 45_000
/** Хозяин сохраняет состояние в базе не реже этого (для вошедших позже и признаков жизни). */
export const HOST_RESYNC_MS = 15_000
/** Хозяин рассылает «где я сейчас» гостям с этим интервалом: по нему гости сверяют звук. */
export const HOST_BEACON_MS = 4_000
/** Гость сверяет звук с хозяином раз в секунду. */
export const GUEST_CHECK_MS = 1_000
/** Запас на загрузку: через столько после команды все (и хозяин) начинают играть. */
export const START_LEAD_MS = 1_200
/** Переход к следующему треку сам по себе: гости уже загрузили его заранее, ждать не нужно. */
export const AUTO_LEAD_MS = 350
/** Хозяин считает перемоткой скачок позиции больше этого относительно сказанного гостям. */
export const SEEK_DETECT_MS = 500
/** Выравнивание скоростью: при таком расхождении (мс) и меньше звук не трогаем, при большем — подстраиваем. */
export const RATE_DEADBAND_MS = 40
export const RATE_RELEASE_MS = 25
export const RATE_FAST_MS = 150
export const RATE_SLOW_DELTA = 0.02
export const RATE_FAST_DELTA = 0.04
export const CLOCK_RESYNC_MS = 5 * 60_000
/** Сколько треков очереди едет по сети: чуть назад и далеко вперёд. */
export const QUEUE_BEFORE = 5
export const QUEUE_AFTER = 40

// ── Часы ───────────────────────────────────────────────────────────────

/** Одна проба: когда запрос ушёл и вернулся (часы устройства) и что ответил сервер. */
export interface ClockSample {
    sentAt: number
    receivedAt: number
    serverMs: number
}

export interface ClockEstimate {
    /** serverNow = Date.now() + offsetMs. */
    offsetMs: number
    /** Задержка запрос-ответ лучшей пробы: честная оценка точности и одностороннего пути. */
    rttMs: number
}

const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Сдвиг часов по пробам. Ответ сервера считаем снятым посередине между
 * отправкой и приёмом; лучшие (самые быстрые) пробы точнее — берём
 * CLOCK_BEST с наименьшей задержкой и медиану их сдвигов. Нет годных проб — null.
 */
export function estimateOffset(samples: readonly ClockSample[]): ClockEstimate | null {
    const good = samples
        .filter((s) => Number.isFinite(s.sentAt) && Number.isFinite(s.receivedAt) && Number.isFinite(s.serverMs) && s.receivedAt >= s.sentAt)
        .map((s) => ({ rtt: s.receivedAt - s.sentAt, offset: s.serverMs - (s.sentAt + s.receivedAt) / 2 }))
        .sort((a, b) => a.rtt - b.rtt)
        .slice(0, CLOCK_BEST)
    if (!good.length) return null
    return { offsetMs: median(good.map((g) => g.offset)), rttMs: good[0].rtt }
}

export const serverNowFrom = (deviceNow: number, offsetMs: number): number => deviceNow + offsetMs

// ── Позиция и подкрутка ────────────────────────────────────────────────

export interface PlaybackTarget {
    /** Позиция трека (мс) на момент atMs. */
    posMs: number
    /** Серверное время (мс), когда хозяин сохранил позицию. */
    atMs: number
    playing: boolean
}

/**
 * Где сейчас трек у хозяина: на паузе — там же, при игре — позиция плюс
 * время, прошедшее на сервере. Не раньше начала и не позже конца трека.
 */
export function expectedPositionMs(target: PlaybackTarget, serverNowMs: number, durationMs?: number | null): number {
    const elapsed = target.playing ? Math.max(0, serverNowMs - target.atMs) : 0
    let pos = Math.max(0, target.posMs + elapsed)
    if (durationMs !== undefined && durationMs !== null && Number.isFinite(durationMs) && durationMs > 0) pos = Math.min(pos, durationMs)
    return pos
}

export interface SeekDecision {
    seek: boolean
    toMs: number
}

/**
 * Подкрутка гостя. Расхождение не больше порога (1 с; при первой выверке
 * 0,3 с) — не трогаем: мелкий рассинхрон лучше рывка. Больше — перематываем
 * на ожидаемую позицию, но не чаще SEEK_MIN_GAP_MS (кроме первой выверки).
 */
export function decideSeek(currentMs: number, expectedMs: number, ctx: { now: number; lastSeekAt: number | null; force?: boolean }): SeekDecision {
    const diff = Math.abs(currentMs - expectedMs)
    const limit = ctx.force ? FORCE_THRESHOLD_MS : DRIFT_THRESHOLD_MS
    if (!(diff > limit)) return { seek: false, toMs: expectedMs }
    if (!ctx.force && ctx.lastSeekAt !== null && ctx.now - ctx.lastSeekAt < SEEK_MIN_GAP_MS) return { seek: false, toMs: expectedMs }
    return { seek: true, toMs: expectedMs }
}

// ── Расписание старта ──────────────────────────────────────────────────

export interface StartPlan {
    /** Серверное время (мс), когда все начинают играть. */
    startAt: number
    /** Позиция трека (мс) в этот момент. */
    posMs: number
}

/**
 * Команда «начать с позиции P в серверное время T»: T — сейчас плюс запас
 * (START_LEAD_MS для нажатия хозяина, AUTO_LEAD_MS для смены трека без нажатия).
 * Медленная сеть хозяина (задержка запрос-ответ) запас увеличивает: гости должны
 * успеть получить команду и загрузить трек, но не больше полутора секунд.
 */
export function planStart(serverNowMs: number, posMs: number, opts: { gapless?: boolean; rttMs?: number } = {}): StartPlan {
    const lead = opts.gapless ? AUTO_LEAD_MS : Math.min(1_500, Math.max(START_LEAD_MS, 800 + (opts.rttMs ?? 0)))
    return { startAt: Math.round(serverNowMs + lead), posMs: Math.max(0, Math.round(posMs)) }
}

/** Сколько ждать до старта (мс); 0 и меньше — время пришло. latencyMs — сколько звуку нужно, чтобы реально пойти. */
export function msUntilStart(startAtMs: number, serverNowMs: number, latencyMs = 0): number {
    return startAtMs - latencyMs - serverNowMs
}

// ── Порядок команд ─────────────────────────────────────────────────────

export interface CommandStamp {
    /** Номер команды хозяина: растёт на каждой команде, после перезагрузки продолжается с сохранённого в базе. */
    seq: number
    /** Номер «маячка» внутри команды: позиция хозяина раз в несколько секунд. 0 — сама команда. */
    beat: number
}

/** Новее ли пришедшее сообщение уже применённого: по команде, а внутри команды — по маячку. */
export function isNewerCommand(next: CommandStamp, applied: CommandStamp): boolean {
    return next.seq > applied.seq || (next.seq === applied.seq && next.beat > applied.beat)
}

/** С какого номера хозяин продолжает после (пере)входа: после всего, что гости могли видеть. */
export function resumeSeq(dbSeq: number, savedState: { cseq?: number } | null): number {
    return Math.max(Number.isFinite(dbSeq) ? dbSeq : 0, savedState?.cseq ?? 0)
}

// ── Подстройка скоростью ───────────────────────────────────────────────

export interface DriftDecision {
    action: 'none' | 'rate' | 'seek'
    /** Скорость воспроизведения после решения (1 — обычная). */
    rate: number
    /** Куда перемотать (только для seek). */
    toMs: number
}

/**
 * Решение гостя по расхождению diffMs (положительное — гость впереди хозяина):
 *  — больше DRIFT_THRESHOLD_MS (или force-порог при первой выверке) — перемотка,
 *    но не чаще SEEK_MIN_GAP_MS; скорость возвращается к обычной;
 *  — до порога: ускоряем или замедляем звук на 2–4 % (высота тона не меняется,
 *    preservesPitch), пока расхождение не станет меньше RATE_RELEASE_MS;
 *  — внутри мёртвой зоны (RATE_DEADBAND_MS) скорость обычная; чтобы не дёргаться
 *    на границе, уже включённая подстройка отпускается позже (гистерезис).
 */
export function decideDrift(
    diffMs: number,
    expectedMs: number,
    ctx: { now: number; lastSeekAt: number | null; currentRate: number; force?: boolean; seekThresholdMs?: number }
): DriftDecision {
    const abs = Math.abs(diffMs)
    const seekAt = ctx.force ? FORCE_THRESHOLD_MS : (ctx.seekThresholdMs ?? DRIFT_THRESHOLD_MS)
    if (abs > seekAt) {
        const gapOk = ctx.force || ctx.lastSeekAt === null || ctx.now - ctx.lastSeekAt >= SEEK_MIN_GAP_MS
        if (gapOk) return { action: 'seek', rate: 1, toMs: expectedMs }
    }
    const adjusting = ctx.currentRate !== 1
    if (abs < (adjusting ? RATE_RELEASE_MS : RATE_DEADBAND_MS)) return { action: adjusting ? 'rate' : 'none', rate: 1, toMs: expectedMs }
    const delta = abs > RATE_FAST_MS ? RATE_FAST_DELTA : RATE_SLOW_DELTA
    // Гость впереди — замедляемся, позади — догоняем.
    const rate = diffMs > 0 ? 1 - delta : 1 + delta
    return { action: rate === ctx.currentRate ? 'none' : 'rate', rate, toMs: expectedMs }
}

// ── Хозяин на месте? ───────────────────────────────────────────────────

export type HostState = 'online' | 'grace' | 'away'

export interface HostWatch {
    /** С какого момента хозяина не видно (часы устройства); null — на месте. */
    absentSince: number | null
}

/**
 * Хозяин считается на месте, если он есть в Presence и подавал голос
 * (рассылка состояния) не слишком давно. Одного Presence мало: участник
 * может объявить в нём что угодно, а слать команды (broadcast) может только хозяин.
 */
export function hostOnline(presenceHasHost: boolean, silenceMs: number): boolean {
    return presenceHasHost && silenceMs < HOST_STALE_MS
}

/**
 * Шаг наблюдения за хозяином. Пропал — «ожидание» (grace) HOST_GRACE_MS:
 * короткий обрыв сети у хозяина не должен ставить паузу всем. Дольше —
 * «away» (пауза и надпись «Ждём хозяина»). Вернулся — сразу «online».
 */
export function stepHostWatch(watch: HostWatch, online: boolean, now: number, graceMs = HOST_GRACE_MS): { watch: HostWatch; state: HostState } {
    if (online) return { watch: { absentSince: null }, state: 'online' }
    const since = watch.absentSince ?? now
    return { watch: { absentSince: since }, state: now - since >= graceMs ? 'away' : 'grace' }
}

// ── Состояние плеера на проводе ────────────────────────────────────────

/** Очередь на проводе: окно вокруг текущего трека в порядке игры. */
export interface WireQueue {
    source: QueueSource
    trackIds: string[]
    order: number[]
    pos: number
    shuffle: boolean
    endless: boolean
}

export interface RoomPlayerState {
    queue: WireQueue | null
    track_id: string | null
    /** Позиция трека (мс) в серверный момент at_ms. */
    pos_ms: number
    playing: boolean
    /**
     * Серверное время (мс), к которому относится pos_ms. Позже «сейчас» — это
     * запланированный старт: до этого момента позиция стоит на месте.
     * Нет поля (состояние из старой версии сайта) — берётся время сохранения в базе.
     */
    at_ms?: number
    /** Номер команды хозяина (см. CommandStamp); у старых состояний нет. */
    cseq?: number
}

export const TRACK_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/
const RELEASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_WIRE_TRACKS = 100
const MAX_POS_MS = 86_400_000

/**
 * Очередь хозяина для передачи: окно из QUEUE_BEFORE треков назад и
 * QUEUE_AFTER вперёд в порядке игры (избранное на две тысячи треков по сети
 * не едет). Гостю дальше окна смотреть незачем: очередь двигает хозяин.
 */
export function compactQueue(queue: Queue): WireQueue {
    const from = Math.max(0, queue.pos - QUEUE_BEFORE)
    const to = Math.min(queue.order.length, queue.pos + QUEUE_AFTER + 1)
    const trackIds = queue.order.slice(from, to).map((i) => queue.trackIds[i])
    return {
        source: queue.source,
        trackIds,
        order: trackIds.map((_, i) => i),
        pos: queue.pos - from,
        shuffle: queue.shuffle,
        endless: queue.endless
    }
}

/** Очередь, полученная по сети, как очередь плеера. */
export function toPlayerQueue(wire: WireQueue, controller: Queue['controller']): Queue {
    return {
        source: wire.source,
        trackIds: [...wire.trackIds],
        order: [...wire.order],
        pos: wire.pos,
        shuffle: wire.shuffle,
        endless: wire.endless,
        controller
    }
}

/** Состояние плеера хозяина для сохранения и рассылки. */
export function snapshotState(queue: Queue | null, positionMs: number, playing: boolean, stamp?: { atMs: number; cseq: number }): RoomPlayerState {
    const trackId = currentTrackId(queue)
    return {
        queue: queue && trackId ? compactQueue(queue) : null,
        track_id: trackId,
        pos_ms: Math.max(0, Math.min(MAX_POS_MS, Math.round(positionMs))),
        playing: Boolean(trackId) && playing,
        ...(stamp ? { at_ms: Math.round(stamp.atMs), cseq: stamp.cseq } : {})
    }
}

function parseSource(raw: unknown): QueueSource | null {
    if (!raw || typeof raw !== 'object') return null
    const s = raw as Record<string, unknown>
    switch (s.kind) {
        case 'release':
            return typeof s.releaseId === 'string' && RELEASE_ID_RE.test(s.releaseId) ? { kind: 'release', releaseId: s.releaseId } : null
        case 'playlist':
            return typeof s.playlistId === 'string' && UUID_RE.test(s.playlistId) && typeof s.title === 'string'
                ? { kind: 'playlist', playlistId: s.playlistId, title: s.title.slice(0, 120) }
                : null
        case 'favorites':
        case 'favorites-flow':
            return typeof s.ownerId === 'string' && UUID_RE.test(s.ownerId) ? { kind: s.kind, ownerId: s.ownerId } : null
        case 'flow':
            return { kind: 'flow' }
        default:
            return null
    }
}

function parseQueue(raw: unknown): WireQueue | null {
    if (!raw || typeof raw !== 'object') return null
    const q = raw as Record<string, unknown>
    const source = parseSource(q.source)
    if (!source || !Array.isArray(q.trackIds) || !Array.isArray(q.order)) return null
    if (q.trackIds.length === 0 || q.trackIds.length > MAX_WIRE_TRACKS || q.order.length > MAX_WIRE_TRACKS) return null
    if (!q.trackIds.every((t) => typeof t === 'string' && t.length <= 160 && TRACK_ID_RE.test(t))) return null
    const n = q.trackIds.length
    if (!q.order.every((i) => Number.isInteger(i) && i >= 0 && i < n)) return null
    if (!Number.isInteger(q.pos) || (q.pos as number) < 0 || (q.pos as number) >= q.order.length) return null
    if (typeof q.shuffle !== 'boolean' || typeof q.endless !== 'boolean') return null
    return { source, trackIds: q.trackIds as string[], order: q.order as number[], pos: q.pos as number, shuffle: q.shuffle, endless: q.endless }
}

/**
 * Проверка состояния из сети (broadcast или room_get). null — состояние
 * непригодно: гость его игнорирует, а не падает. Трек должен совпадать
 * с текущим треком очереди.
 */
export function parseRoomState(raw: unknown): RoomPlayerState | null {
    if (!raw || typeof raw !== 'object') return null
    const s = raw as Record<string, unknown>
    if (typeof s.playing !== 'boolean') return null
    if (typeof s.pos_ms !== 'number' || !Number.isFinite(s.pos_ms) || s.pos_ms < 0 || s.pos_ms > MAX_POS_MS) return null
    const trackId = s.track_id
    if (trackId !== null && (typeof trackId !== 'string' || !TRACK_ID_RE.test(trackId))) return null
    const queue = s.queue === null || s.queue === undefined ? null : parseQueue(s.queue)
    if (s.queue !== null && s.queue !== undefined && !queue) return null
    if (queue) {
        const current = queue.trackIds[queue.order[queue.pos]]
        if (current !== trackId) return null
    } else if (trackId !== null) {
        return null
    }
    const at = s.at_ms
    if (at !== undefined && (typeof at !== 'number' || !Number.isFinite(at) || at < 0)) return null
    const cseq = s.cseq
    if (cseq !== undefined && (typeof cseq !== 'number' || !Number.isInteger(cseq) || cseq < 0)) return null
    return {
        queue,
        track_id: trackId,
        pos_ms: s.pos_ms,
        playing: s.playing && trackId !== null,
        ...(at !== undefined ? { at_ms: at } : {}),
        ...(cseq !== undefined ? { cseq } : {})
    }
}

/** Маячок хозяина: где он сейчас (без очереди — она не менялась). null — сообщение негодное. */
export interface Beacon extends CommandStamp {
    sent: number
    at: number
    track_id: string
    pos_ms: number
    playing: boolean
    epoch?: number
}

export function parseBeacon(raw: unknown): Beacon | null {
    if (!raw || typeof raw !== 'object') return null
    const b = raw as Record<string, unknown>
    const ints = [b.seq, b.beat]
    if (!ints.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)) return null
    if (![b.sent, b.at, b.pos_ms].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return null
    if ((b.pos_ms as number) > MAX_POS_MS) return null
    if (typeof b.track_id !== 'string' || !TRACK_ID_RE.test(b.track_id) || typeof b.playing !== 'boolean') return null
    return { seq: b.seq as number, beat: b.beat as number, sent: b.sent as number, at: b.at as number, track_id: b.track_id, pos_ms: b.pos_ms as number, playing: b.playing, epoch: typeof b.epoch === 'number' ? b.epoch : undefined }
}

/** Что дальше: id следующих треков очереди (для бесконечной — неизвестно заранее). */
export function upcomingTrackIds(queue: WireQueue | Queue | null, count: number): string[] {
    if (!queue || queue.endless) return []
    const out: string[] = []
    for (let p = queue.pos + 1; p < queue.order.length && out.length < count; p++) out.push(queue.trackIds[queue.order[p]])
    return out
}

// ── Каналы ─────────────────────────────────────────────────────────────

/** Топик приватного канала комнаты; тот же разбор — в политиках базы (room_topic_access). */
export const roomTopic = (roomId: string, epoch: number): string => `room:${roomId}:${epoch}`

export const isRoomId = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value)
