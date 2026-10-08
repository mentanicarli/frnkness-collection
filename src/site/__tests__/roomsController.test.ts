/**
 * Комнаты «в двух окнах» без сети: хозяин и гости — настоящие контроллеры
 * (src/site/rooms/store.ts), а сервер, Realtime и плеер — подделки в памяти.
 * Проверяем сценарии целиком: вход на лету, смена трека, пауза и перемотка,
 * уход и возвращение хозяина, перезагрузка хозяина, исключение, подкрутка и
 * часы устройства, которые спешат или отстают.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SocialError } from '../social/api'
import type { RoomApi, RoomInfo, RoomMember, RoomView } from '../rooms/api'
import type { ChannelEvents, ChannelFactory, PresenceEntry, RoomChannel } from '../rooms/channel'
import { createServerClock } from '../rooms/clock'
import type { ChangeKind, PlayerPort } from '../rooms/port'
import { createRoomController, createRoomState, type RoomController, type RoomUiState } from '../rooms/store'
import { type Queue, createListQueue } from '../player/queue'
import type { HostHook, PlaybackInfo } from '../player/engine'
import { type RoomPlayerState, parseRoomState, roomTopic } from '../rooms/sync'

// ── Сервер в памяти ────────────────────────────────────────────────────

interface FakeRoom {
    id: string
    owner: string
    title: string
    epoch: number
    state: unknown
    seq: number
    atMs: number | null
    ownerSeenMs: number
    members: Set<string>
    kicked: Set<string>
    closed: boolean
}

const ROOM_ID = '12345678-1234-4123-8123-123456789abc'
const profile = (id: string) => ({ id, nick: `ник-${id}`, avatar: 'initials:0' })

class FakeBackend {
    rooms = new Map<string, FakeRoom>()
    nextId = 0
    /** Сообщения, доставленные «по проводу»: для проверок. */
    channels = new Map<string, Set<FakeChannel>>()
    heartbeatReplies = new Map<string, (room: FakeRoom) => void>()

    now = () => Date.now()

    view(room: FakeRoom, uid: string): RoomView {
        const members: RoomMember[] = [...room.members].map((id) => ({ ...profile(id), joined_at: '2026-10-08T00:00:00Z', owner: id === room.owner }))
        return {
            id: room.id,
            title: room.title,
            epoch: room.epoch,
            owner: profile(room.owner),
            is_owner: room.owner === uid,
            capacity: 20,
            members,
            state: room.state,
            seq: room.seq,
            at_ms: room.atMs,
            owner_seen_ms: room.ownerSeenMs,
            server_ms: this.now()
        }
    }

    openRoomOf(uid: string): FakeRoom | undefined {
        return [...this.rooms.values()].find((r) => !r.closed && r.members.has(uid))
    }

    api(uid: string): RoomApi {
        const notFound = () => new SocialError('Комната не найдена или уже закрыта', 'P0002')
        const own = (id: string) => {
            const r = this.rooms.get(id)
            if (!r || r.closed || r.owner !== uid) throw new SocialError('Комната не найдена', 'P0002')
            return r
        }
        return {
            serverNow: async () => this.now(),
            create: async (title) => {
                const id = this.nextId++ === 0 ? ROOM_ID : `12345678-1234-4123-8123-${String(this.nextId).padStart(12, '0')}`
                const room: FakeRoom = { id, owner: uid, title, epoch: 0, state: {}, seq: 0, atMs: null, ownerSeenMs: this.now(), members: new Set([uid]), kicked: new Set(), closed: false }
                this.rooms.set(id, room)
                return this.view(room, uid)
            },
            join: async (id) => {
                const r = this.rooms.get(id)
                if (!r || r.closed) throw notFound()
                if (r.kicked.has(uid)) throw new SocialError('Тебя выгнали из этой комнаты', '42501')
                if (!r.members.has(uid)) {
                    if (r.members.size >= 20) throw new SocialError('В комнате уже 20 человек', '54000')
                    this.openRoomOf(uid)?.members.delete(uid)
                    r.members.add(uid)
                }
                return this.view(r, uid)
            },
            leave: async () => {
                this.openRoomOf(uid)?.members.delete(uid)
            },
            close: async (id) => {
                const r = own(id)
                r.closed = true
                r.members.clear()
            },
            get: async (id) => {
                const r = this.rooms.get(id)
                if (!r || r.closed || !r.members.has(uid)) throw notFound()
                return this.view(r, uid)
            },
            my: async () => {
                const r = this.openRoomOf(uid)
                return r ? this.view(r, uid) : null
            },
            info: async (id): Promise<RoomInfo> => {
                const r = this.rooms.get(id)
                if (!r || r.closed) return { closed: true }
                return { closed: false, id, title: r.title, owner: profile(r.owner), members: r.members.size, capacity: 20, full: r.members.size >= 20, is_member: r.members.has(uid), kicked: r.kicked.has(uid) }
            },
            setState: async (id, state) => {
                const r = own(id)
                r.state = JSON.parse(JSON.stringify(state))
                r.seq += 1
                r.atMs = this.now()
                r.ownerSeenMs = r.atMs
                return { seq: r.seq, at_ms: r.atMs, epoch: r.epoch }
            },
            heartbeat: async (id) => {
                const r = this.rooms.get(id)
                if (!r || r.closed || !r.members.has(uid)) return { member: false, closed: !r || r.closed, server_ms: this.now() }
                if (r.owner === uid) r.ownerSeenMs = this.now()
                return { member: true, closed: false, epoch: r.epoch, server_ms: this.now() }
            },
            kick: async (id, user) => {
                const r = own(id)
                if (!r.members.delete(user)) throw new SocialError('Этого человека нет в комнате', 'P0002')
                r.kicked.add(user)
                r.epoch += 1
                return { epoch: r.epoch }
            },
            invite: async () => undefined,
            invitesList: async () => [],
            invitesCount: async () => 0,
            inviteDismiss: async () => undefined
        }
    }

    /** Политики Realtime: войти в канал может участник текущей эпохи, писать — хозяин. */
    channelFactory: ChannelFactory = (topic, userId, events) => new FakeChannel(this, topic, userId, events)
}

class FakeChannel implements RoomChannel {
    tracked = false
    stopped = false
    constructor(
        readonly backend: FakeBackend,
        readonly topic: string,
        readonly userId: string,
        readonly events: ChannelEvents
    ) {}

    /** Топик реакций (roomfx:…): пишут и слушают все участники текущей эпохи. */
    private get reactions(): boolean {
        return this.topic.startsWith('roomfx:')
    }

    private room(): FakeRoom | undefined {
        const m = /^(?:room|roomfx):([0-9a-f-]{36}):(\d+)$/.exec(this.topic)
        const r = m ? this.backend.rooms.get(m[1]) : undefined
        return r && !r.closed && r.members.has(this.userId) && r.epoch === Number(m![2]) ? r : undefined
    }

    peers(): FakeChannel[] {
        return [...(this.backend.channels.get(this.topic) ?? [])]
    }

    async start(): Promise<void> {
        if (!this.room()) throw new Error('Unauthorized')
        const set = this.backend.channels.get(this.topic) ?? new Set()
        set.add(this)
        this.backend.channels.set(this.topic, set)
    }

    async track(): Promise<void> {
        this.tracked = true
        this.syncPresence()
    }

    syncPresence(): void {
        const users = new Map<string, PresenceEntry>()
        for (const c of this.peers()) if (c.tracked) users.set(c.userId, {})
        for (const c of this.peers()) c.events.onPresence(new Map(users))
    }

    async send(event: string, payload: unknown): Promise<boolean> {
        if (this.reactions) {
            if (!this.room()) return false
            const wire = JSON.parse(JSON.stringify(payload))
            for (const c of this.peers()) if (c !== this) c.events.onBroadcast(event, wire)
            return true
        }
        const m = /^room:([0-9a-f-]{36}):(\d+)$/.exec(this.topic)
        const r = m ? this.backend.rooms.get(m[1]) : undefined
        // Политика: команды — только хозяин, в текущую или прошлую эпоху.
        if (!r || r.closed || r.owner !== this.userId || ![r.epoch, r.epoch - 1].includes(Number(m![2]))) return false
        const wire = JSON.parse(JSON.stringify(payload))
        for (const c of this.peers()) if (c !== this) c.events.onBroadcast(event, wire)
        return true
    }

    async stop(): Promise<void> {
        this.stopped = true
        const set = this.backend.channels.get(this.topic)
        if (set?.delete(this)) for (const c of set) c.syncPresence()
        this.tracked = false
    }
}

// ── Плеер в памяти ─────────────────────────────────────────────────────

const TRACKS = ['album-one/first-track', 'album-one/second-track', 'album-one/third-track']
const DURATION = 200_000

class FakePlayer implements PlayerPort {
    queueNow: Queue | null = null
    trackId: string | null = null
    base = 0
    since = Date.now()
    isPlaying = false
    rate = 1
    role: 'host' | 'guest' | null = null
    changeCb: ((kind: ChangeKind) => void) | null = null
    hook: HostHook | null = null
    seeks: number[] = []
    rates: number[] = []
    preloaded: string[] = []
    unlocked = 0
    resets = 0
    /** Моменты (Date.now()), когда звук реально пошёл. */
    playedAt: number[] = []
    /** Какие треки есть в этой версии сайта. */
    catalog = new Set(TRACKS)
    autoplayAllowed = true
    latency = 0

    positionMs(): number {
        return this.isPlaying ? this.base + (Date.now() - this.since) * this.rate : this.base
    }

    info(): PlaybackInfo {
        return { trackId: this.trackId, positionMs: this.positionMs(), durationMs: DURATION, playing: this.isPlaying, ready: this.trackId !== null, rate: this.rate }
    }
    queue = () => this.queueNow
    setRole = (role: 'host' | 'guest' | null) => {
        this.role = role
    }
    private setPosition(ms: number) {
        this.base = ms
        this.since = Date.now()
    }
    apply(queue: Queue, playing: boolean, targetMs: () => number, onReady?: () => void) {
        const id = queue.trackIds[queue.order[queue.pos]]
        if (!this.catalog.has(id)) return 'missing-track' as const
        this.queueNow = queue
        this.trackId = id
        this.isPlaying = false
        // Загрузка «занимает» 300 мс: позицию считаем по её окончании (canplay).
        setTimeout(() => {
            this.setPosition(targetMs())
            this.isPlaying = playing && this.autoplayAllowed
            if (this.isPlaying) this.playedAt.push(Date.now())
            this.changeCb?.('seeked')
            onReady?.()
        }, 300)
        return 'ok' as const
    }
    setQueue = (queue: Queue) => {
        this.queueNow = queue
    }
    seekMs = (ms: number) => {
        this.seeks.push(ms)
        this.setPosition(ms)
    }
    async play() {
        if (!this.autoplayAllowed) return false
        this.setPosition(this.positionMs())
        this.isPlaying = true
        this.playedAt.push(Date.now() + this.latency)
        return true
    }
    pause = () => {
        this.setPosition(this.positionMs())
        this.isPlaying = false
    }
    hold = () => this.pause()
    reset = () => {
        this.pause()
        this.queueNow = null
        this.trackId = null
        this.base = 0
        this.rate = 1
        this.resets++
    }
    setRate = (rate: number) => {
        this.setPosition(this.positionMs())
        this.rate = rate
        this.rates.push(rate)
    }
    preload = (id: string) => {
        this.preloaded.push(id)
    }
    startLatencyMs = () => this.latency
    setHostHook = (hook: HostHook | null) => {
        this.hook = hook
    }
    unlock = () => {
        this.unlocked++
    }
    onChange(cb: (kind: ChangeKind) => void) {
        this.changeCb = cb
        return () => {
            this.changeCb = null
        }
    }

    // ── Действия хозяина «руками» ──
    /** Включить трек index: как в настоящем плеере, звук пускает комната по расписанию. */
    start(index: number, ms = 0, opts: { gapless?: boolean } = {}): void {
        this.queueNow = createListQueue({ kind: 'release', releaseId: 'album-one' }, TRACKS, index, () => true)!
        this.trackId = TRACKS[index]
        this.setPosition(ms)
        this.isPlaying = false
        if (this.hook) this.hook.start({ gapless: Boolean(opts.gapless) })
        else {
            this.isPlaying = true
            this.changeCb?.('state')
        }
    }
    userPause(): void {
        if (this.hook?.pending()) return this.hook.cancel()
        this.pause()
        this.changeCb?.('pause')
    }
    userResume(): void {
        this.setPosition(this.positionMs())
        if (this.hook) this.hook.start({ gapless: false })
        else {
            this.isPlaying = true
            this.changeCb?.('play')
        }
    }
    userSeek(ms: number): void {
        this.setPosition(ms)
        this.changeCb?.('seeked')
    }
}

// ── Окно: человек со своими часами, плеером и контроллером ─────────────

interface Win {
    uid: string
    player: FakePlayer
    state: RoomUiState
    room: RoomController
    notices: { text: string; error: boolean }[]
    visible: () => void
    hide: () => void
}

function openWindow(backend: FakeBackend, uid: string, clockSkewMs: number, over: { channel?: ChannelFactory; api?: Partial<RoomApi> } = {}): Win {
    const player = new FakePlayer()
    const state = createRoomState()
    const notices: Win['notices'] = []
    let visibleCb: () => void = () => undefined
    let hideCb: () => void = () => undefined
    const clock = createServerClock({
        serverNow: () => backend.api(uid).serverNow(),
        deviceNow: () => Date.now() + clockSkewMs,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms))
    })
    const room = createRoomController(
        {
            api: { ...backend.api(uid), ...over.api },
            channel: over.channel ?? backend.channelFactory,
            port: player,
            clock,
            me: () => ({ id: uid }),
            notify: (text, error = false) => notices.push({ text, error }),
            onVisible: (cb) => {
                visibleCb = cb
                return () => undefined
            },
            onHide: (cb) => {
                hideCb = cb
                return () => undefined
            }
        },
        state
    )
    return { uid, player, state, room, notices, visible: () => visibleCb(), hide: () => hideCb() }
}

const lastNotice = (list: { text: string }[]) => list[list.length - 1]?.text
const settle = (ms = 1500) => vi.advanceTimersByTimeAsync(ms)

describe('комнаты: хозяин и гости', () => {
    let backend: FakeBackend
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(1_800_000_000_000)
        backend = new FakeBackend()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    /** Хозяин играет и создаёт комнату. */
    async function hostRoom(skew = 5000) {
        const host = openWindow(backend, 'host', skew)
        host.player.start(0, 30_000)
        const creating = host.room.create('Мои треки')
        await settle(1500)
        await creating
        return host
    }

    it('гость входит на лету и слышит то же место, хотя его часы отстают на 7 секунд', async () => {
        const host = await hostRoom(+5000)
        await settle(2000)
        const guest = openWindow(backend, 'guest', -7000)
        const joining = guest.room.join(ROOM_ID)
        await settle(3000)
        await joining
        expect(guest.player.unlocked).toBe(1)
        expect(guest.state.status).toBe('live')
        expect(guest.player.role).toBe('guest')
        expect(guest.player.trackId).toBe('album-one/first-track')
        expect(guest.player.isPlaying).toBe(true)
        expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(1000)
        // Очередь пришла от хозяина целиком и управляется им.
        expect(guest.player.queueNow?.controller).toBe('remote')
        expect(guest.state.nowTrackId).toBe('album-one/first-track')
        expect(guest.state.nextTrackIds).toEqual(['album-one/second-track', 'album-one/third-track'])
        // Оба видны в Presence.
        expect(guest.state.online).toEqual(['guest', 'host'])
        expect(host.state.online).toEqual(['guest', 'host'])
        expect(host.state.members.map((m) => m.id).sort()).toEqual(['guest', 'host'])
    })

    it('хозяин меняет трек, ставит паузу и перематывает — гость повторяет', async () => {
        const host = await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)

        host.player.start(1, 10_000)
        await settle(2000)
        expect(guest.player.trackId).toBe('album-one/second-track')
        expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(1000)
        expect(guest.state.nextTrackIds).toEqual(['album-one/third-track'])

        host.player.userPause()
        await settle(1000)
        expect(guest.player.isPlaying).toBe(false)
        expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(400)

        host.player.userSeek(100_000)
        await settle(1000)
        expect(guest.player.positionMs()).toBeCloseTo(100_000, -3)
        expect(guest.player.isPlaying).toBe(false)

        host.player.userResume()
        await settle(4000)
        expect(guest.player.isPlaying).toBe(true)
        expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(1000)
    })

    it('гость подкручивает позицию только при расхождении больше секунды', async () => {
        const host = await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)
        guest.player.seeks.length = 0

        // 600 мс — терпим.
        guest.player.base += 600
        await settle(3000)
        expect(guest.player.seeks).toEqual([])

        // 2,5 с — перематываем к хозяину, и сразу (не позже следующей секунды).
        guest.player.base -= 2500
        await settle(1200)
        expect(guest.player.seeks).toHaveLength(1)
        expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(1000)
    })

    it('опоздавший с неточными часами попадает туда же, куда и остальные', async () => {
        const host = await hostRoom(-30_000)
        const early = openWindow(backend, 'early', +4000)
        void early.room.join(ROOM_ID)
        await settle(60_000)
        const late = openWindow(backend, 'late', -12_000)
        void late.room.join(ROOM_ID)
        await settle(3000)
        const spread = [early, late].map((w) => Math.abs(w.player.positionMs() - host.player.positionMs()))
        expect(Math.max(...spread)).toBeLessThan(1000)
    })

    it('старые и повторные команды отбрасываются', async () => {
        const host = await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)
        host.player.userPause()
        await settle(1000)
        const seqNow = backend.rooms.get(ROOM_ID)!.seq
        // «Опоздавшая» команда со старым номером, игравшая секунду назад, ничего не меняет.
        const stale: RoomPlayerState = { ...parseRoomState(backend.rooms.get(ROOM_ID)!.state)!, playing: true, pos_ms: 1 }
        const channel = [...backend.channels.get(roomTopic(ROOM_ID, 0))!].find((c) => c.userId === 'guest')!
        channel.events.onBroadcast('state', { seq: seqNow - 1, at: Date.now(), epoch: 0, state: stale })
        channel.events.onBroadcast('state', { seq: seqNow, at: Date.now(), epoch: 0, state: stale })
        await settle(1500)
        expect(guest.player.isPlaying).toBe(false)
        // Мусор не роняет гостя.
        channel.events.onBroadcast('state', { seq: seqNow + 5, at: Date.now(), state: { playing: 'да' } })
        channel.events.onBroadcast('state', null)
        channel.events.onBroadcast('state', { seq: 'x' })
        channel.events.onBroadcast('unknown', {})
        expect(guest.state.status).toBe('live')
    })

    it('хозяин пропал: гости ждут 15 секунд и ставят паузу; вернулся — комната продолжается', async () => {
        const host = await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)
        expect(guest.player.isPlaying).toBe(true)

        // Хозяин закрыл вкладку: пропал из Presence (остался участником в базе).
        await host.room.reset()
        await settle(10_000)
        // Ещё не 15 секунд — играем.
        expect(guest.state.hostState).toBe('grace')
        expect(guest.player.isPlaying).toBe(true)
        await settle(6000)
        expect(guest.state.hostState).toBe('away')
        expect(guest.player.isPlaying).toBe(false)
        const frozenAt = guest.player.positionMs()
        await settle(20_000)
        expect(guest.player.positionMs()).toBe(frozenAt)

        // Хозяин вернулся после перезагрузки: чистый плеер, комната на паузе.
        const back = openWindow(backend, 'host', 0)
        void back.room.restore()
        await settle(4000)
        expect(back.state.status).toBe('live')
        expect(back.player.role).toBe('host')
        expect(back.player.trackId).toBe('album-one/first-track')
        expect(back.player.isPlaying).toBe(false)
        // Возвращённая позиция — там, где хозяин последний раз был на связи, а не «где-то в будущем».
        expect(back.player.positionMs()).toBeLessThan(frozenAt + 15_000)
        expect(back.player.positionMs()).toBeGreaterThan(30_000)
        expect(guest.state.hostState).toBe('online')
        expect(guest.player.isPlaying).toBe(false)
        expect(Math.abs(guest.player.positionMs() - back.player.positionMs())).toBeLessThan(500)

        // Нажал «играть» — гость следом.
        back.player.userResume()
        await settle(3000)
        expect(guest.player.isPlaying).toBe(true)
        expect(Math.abs(guest.player.positionMs() - back.player.positionMs())).toBeLessThan(1000)
    })

    it('короткий обрыв хозяина (меньше 15 секунд) паузу не ставит', async () => {
        await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)
        const hostChannel = [...backend.channels.get(roomTopic(ROOM_ID, 0))!].find((c) => c.userId === 'host')!
        hostChannel.tracked = false
        hostChannel.syncPresence()
        await settle(8000)
        expect(guest.player.isPlaying).toBe(true)
        hostChannel.tracked = true
        hostChannel.syncPresence()
        await settle(20_000)
        expect(guest.state.hostState).toBe('online')
        expect(guest.player.isPlaying).toBe(true)
    })

    it('после перезагрузки хозяина номера состояния продолжаются, и гости не отбрасывают его команды', async () => {
        const host = await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)
        const before = backend.rooms.get(ROOM_ID)!.seq
        expect(before).toBeGreaterThan(0)
        await host.room.reset()
        const back = openWindow(backend, 'host', 0)
        void back.room.restore()
        await settle(4000)
        expect(backend.rooms.get(ROOM_ID)!.seq).toBeGreaterThan(before)
        back.player.start(2, 5000)
        await settle(3000)
        expect(guest.player.trackId).toBe('album-one/third-track')
        expect(guest.player.isPlaying).toBe(true)
    })

    it('гость заблокирован, но может выйти; хозяин не может «выйти», только закрыть', async () => {
        const host = await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)
        expect(guest.player.role).toBe('guest')
        await expect(host.room.leave()).rejects.toThrow(/закрывает/)
        await guest.room.leave()
        expect(guest.player.role).toBeNull()
        expect(guest.player.isPlaying).toBe(false)
        expect(guest.state.roomId).toBeNull()
        expect(backend.rooms.get(ROOM_ID)!.members.has('guest')).toBe(false)
        await settle(1000)
        expect(host.state.online).toEqual(['host'])
    })

    it('хозяин закрывает комнату: гости выходят сразу', async () => {
        const host = await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)
        await host.room.close()
        await settle(500)
        expect(guest.state.roomId).toBeNull()
        expect(guest.player.role).toBeNull()
        expect(lastNotice(guest.notices)).toBe('Хозяин закрыл комнату')
        expect(host.state.roomId).toBeNull()
    })

    it('исключение: выгнанный выходит сразу, остальные переезжают на новый топик, вернуться нельзя', async () => {
        const host = await hostRoom()
        const kicked = openWindow(backend, 'kicked', 0)
        const other = openWindow(backend, 'other', 0)
        void kicked.room.join(ROOM_ID)
        void other.room.join(ROOM_ID)
        await settle(4000)
        expect(host.state.members).toHaveLength(3)

        await host.room.kick('kicked')
        await settle(2000)
        expect(kicked.state.roomId).toBeNull()
        expect(lastNotice(kicked.notices)).toBe('Тебя выгнали из комнаты')
        expect(kicked.player.role).toBeNull()
        // Остальные живут на эпохе 1 и продолжают слышать хозяина.
        expect(other.state.status).toBe('live')
        expect(other.state.epoch).toBe(1)
        expect(host.state.epoch).toBe(1)
        expect(host.state.members.map((m) => m.id).sort()).toEqual(['host', 'other'])
        host.player.start(2, 1000)
        await settle(3000)
        expect(other.player.trackId).toBe('album-one/third-track')
        // Старый топик пуст у всех; выгнанный не слышит ничего и не может вернуться.
        expect([...(backend.channels.get(roomTopic(ROOM_ID, 0)) ?? [])]).toEqual([])
        await expect(kicked.room.join(ROOM_ID)).rejects.toThrow(/выгнали/)
        expect(kicked.player.trackId).not.toBe('album-one/third-track')
    })

    it('если сообщение об исключении потерялось, выгнанного выводит сердцебиение', async () => {
        const host = await hostRoom()
        const kicked = openWindow(backend, 'kicked', 0)
        void kicked.room.join(ROOM_ID)
        await settle(3000)
        // Сообщение «выгнали» не дошло: ломаем отправку.
        const room = backend.rooms.get(ROOM_ID)!
        room.members.delete('kicked')
        room.kicked.add('kicked')
        room.epoch += 1
        await settle(50_000)
        expect(kicked.state.roomId).toBeNull()
        expect(lastNotice(kicked.notices)).toBe('Тебя выгнали из комнаты')
        void host
    })

    it('трека нет в этой версии сайта: подсказка «Обнови страницу», без ошибок', async () => {
        await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        guest.player.catalog = new Set(TRACKS.slice(1))
        const joining = guest.room.join(ROOM_ID)
        await settle(3000)
        await joining
        expect(guest.state.status).toBe('live')
        expect(guest.state.outdated).toBe(true)
        expect(guest.notices.filter((n) => /Обнови страницу/.test(n.text))).toHaveLength(1)
        expect(guest.notices.some((n) => n.error)).toBe(false)
        expect(guest.player.isPlaying).toBe(false)
    })

    it('браузер не пустил звук: появляется «Включить звук», после нажатия играет', async () => {
        await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        guest.player.autoplayAllowed = false
        void guest.room.join(ROOM_ID)
        await settle(4000)
        expect(guest.state.needsGesture).toBe(true)
        expect(guest.player.isPlaying).toBe(false)
        guest.player.autoplayAllowed = true
        guest.room.enableSound()
        await settle(1500)
        expect(guest.state.needsGesture).toBe(false)
        expect(guest.player.isPlaying).toBe(true)
    })

    it('возврат на вкладку: часы и позиция выверяются заново', async () => {
        const host = await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)
        // Вкладка спала: звук в браузере уехал на 5 секунд.
        guest.player.base -= 5000
        guest.visible()
        await settle(1500)
        expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(1000)
    })

    it('перезагрузка гостя: он в комнате в базе, но звук включит только по нажатию', async () => {
        await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)
        await guest.room.reset()

        const again = openWindow(backend, 'guest', 0)
        await again.room.restore()
        expect(again.state.roomId).toBe(ROOM_ID)
        expect(again.state.needsConnect).toBe(true)
        expect(again.state.status).toBe('idle')
        expect(again.player.isPlaying).toBe(false)
        void again.room.connect()
        await settle(3000)
        expect(again.player.unlocked).toBe(1)
        expect(again.state.status).toBe('live')
        expect(again.player.isPlaying).toBe(true)
    })

    /** Фабрика каналов: первые `failures` входов неудачны (как первый вход в настоящий Realtime). */
    function flaky(backend: FakeBackend, failures: number, calls: { n: number }): ChannelFactory {
        return (topic, userId, events) => {
            const inner = new FakeChannel(backend, topic, userId, events)
            // Канал реакций — отдельный, в счёт попыток входа в комнату не идёт.
            if (topic.startsWith('roomfx:')) return inner
            calls.n++
            if (calls.n <= failures) {
                inner.start = async () => {
                    throw new Error('CHANNEL_ERROR')
                }
            }
            return inner
        }
    }

    it('первый вход в канал неудачен — тихие повторы со статусом «Подключаемся…», без ошибки', async () => {
        await hostRoom()
        const calls = { n: 0 }
        const guest = openWindow(backend, 'guest', 0, { channel: flaky(backend, 2, calls) })
        void guest.room.join(ROOM_ID)
        await settle(500)
        expect(guest.state.status).toBe('connecting')
        expect(guest.state.attempt).toBeGreaterThanOrEqual(1)
        await settle(2000)
        // Вторая попытка тоже не вышла, но человек ещё видит «Подключаемся…», а не ошибку.
        expect(guest.state.status).toBe('connecting')
        expect(guest.notices.filter((n) => n.error)).toEqual([])
        await settle(6000)
        expect(calls.n).toBe(3)
        expect(guest.state.status).toBe('live')
        expect(guest.state.attempt).toBe(0)
        expect(guest.notices.filter((n) => n.error)).toEqual([])
        expect(guest.player.trackId).toBe('album-one/first-track')
    })

    it('ошибка подключения — только после всех попыток, одна на всё; комната остаётся доступной для повторного входа', async () => {
        await hostRoom()
        const calls = { n: 0 }
        const guest = openWindow(backend, 'guest', 0, { channel: flaky(backend, 99, calls) })
        void guest.room.join(ROOM_ID)
        await settle(10_000)
        expect(guest.state.status).toBe('connecting')
        expect(guest.notices).toEqual([])
        await settle(30_000)
        expect(calls.n).toBe(6)
        expect(guest.state.status).toBe('error')
        expect(guest.state.needsConnect).toBe(true)
        expect(guest.state.roomId).toBe(ROOM_ID)
        expect(guest.notices.filter((n) => n.error && /Не удалось подключиться/.test(n.text))).toHaveLength(1)
        expect(guest.player.role).toBeNull()
    })

    it('создание комнаты: канал с трудом, но поднимается — человек не видит ошибки', async () => {
        const calls = { n: 0 }
        const host = openWindow(backend, 'host', 0, { channel: flaky(backend, 1, calls) })
        host.player.start(0, 5000)
        void host.room.create('С повтором')
        await settle(6000)
        expect(host.state.status).toBe('live')
        expect(host.notices).toEqual([])
        expect(backend.rooms.get(ROOM_ID)!.seq).toBeGreaterThan(0)
    })

    it('хозяин открыл сайт заново: комната найдена и подключена сама, даже если первые запросы не прошли', async () => {
        await hostRoom()
        let failures = 2
        const back = openWindow(backend, 'host', 0, {
            api: {
                my: async () => {
                    if (failures-- > 0) throw new SocialError('Не удалось связаться с сервером', 'network')
                    return backend.api('host').my()
                }
            }
        })
        void back.room.restore()
        await settle(8000)
        expect(back.state.roomId).toBe(ROOM_ID)
        expect(back.state.isOwner).toBe(true)
        expect(back.state.status).toBe('live')
        expect(back.player.role).toBe('host')
    })

    it('первая проверка комнаты не удалась совсем — повторный вызов (минутная проверка) находит её', async () => {
        await hostRoom()
        let down = true
        const back = openWindow(backend, 'host', 0, {
            api: {
                my: async () => {
                    if (down) throw new SocialError('Не удалось связаться с сервером', 'network')
                    return backend.api('host').my()
                }
            }
        })
        await Promise.all([back.room.restore(), settle(20_000)])
        expect(back.state.roomId).toBeNull()
        down = false
        void back.room.restore()
        await settle(4000)
        expect(back.state.roomId).toBe(ROOM_ID)
        expect(back.state.status).toBe('live')
    })

    it('хозяин вернулся, а канал не поднялся: комната всё равно видна (меню, кнопка «Вернуться»), подключение по нажатию', async () => {
        await hostRoom()
        const calls = { n: 0 }
        const back = openWindow(backend, 'host', 0, { channel: flaky(backend, 6, calls) })
        void back.room.restore()
        await settle(40_000)
        expect(back.state.status).toBe('error')
        expect(back.state.roomId).toBe(ROOM_ID)
        expect(back.state.isOwner).toBe(true)
        expect(back.state.needsConnect).toBe(true)
        // Нажатие «Подключиться»: канал теперь поднимается.
        void back.room.connect()
        await settle(4000)
        expect(back.state.status).toBe('live')
        expect(back.state.needsConnect).toBe(false)
    })

    it('хозяин закрыл вкладку, а Presence «застрял»: сообщение «ухожу» запускает 15 секунд до паузы', async () => {
        const host = await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)
        expect(guest.player.isPlaying).toBe(true)
        // Хозяин закрывает вкладку, но сервер ещё считает его присутствующим.
        host.hide()
        // Вкладки больше нет: дальше ничего не рассылается (Presence при этом ещё на месте).
        await settle(10)
        const hostChannel = [...backend.channels.get(roomTopic(ROOM_ID, 0))!].find((c) => c.userId === 'host')!
        hostChannel.send = async () => false
        await settle(1500)
        expect(guest.state.hostState).toBe('grace')
        expect(guest.player.isPlaying).toBe(true)
        await settle(14_000)
        expect(guest.state.hostState).toBe('away')
        expect(guest.player.isPlaying).toBe(false)
        expect(guest.state.members.map((m) => m.id)).toContain('host')
        // Вернулся (перезагрузка): первая же его рассылка снимает «Ждём хозяина».
        await host.room.reset()
        const back = openWindow(backend, 'host', 0)
        void back.room.restore()
        await settle(4000)
        expect(guest.state.hostState).toBe('online')
    })

    it('Presence застрял и сообщения «ухожу» нет (сеть пропала): хозяин без вестей 45 секунд — пауза через ещё 15', async () => {
        const host = await hostRoom()
        const guest = openWindow(backend, 'guest', 0)
        void guest.room.join(ROOM_ID)
        await settle(3000)
        // Хозяин «пропал»: его таймеры больше не рассылают состояние, Presence на месте.
        host.player.onChange(() => undefined)
        const hostChannel = [...backend.channels.get(roomTopic(ROOM_ID, 0))!].find((c) => c.userId === 'host')!
        hostChannel.send = async () => false
        await settle(40_000)
        expect(guest.state.hostState).not.toBe('away')
        await settle(25_000)
        expect(guest.state.hostState).toBe('away')
        expect(guest.player.isPlaying).toBe(false)
    })

    it('обрыв связи: «Переподключаемся…», вернулась сама — без пересоздания; не вернулась за 20 секунд — канал открывается заново', async () => {
        await hostRoom()
        const calls = { n: 0 }
        const counting: ChannelFactory = (t, u, e) => {
            if (!t.startsWith('roomfx:')) calls.n++
            return backend.channelFactory(t, u, e)
        }
        const guest = openWindow(backend, 'guest', 0, { channel: counting })
        void guest.room.join(ROOM_ID)
        await settle(3000)
        const channel = [...backend.channels.get(roomTopic(ROOM_ID, 0))!].find((c) => c.userId === 'guest')!
        expect(calls.n).toBe(1)

        channel.events.onDown()
        expect(guest.state.linkDown).toBe(true)
        await settle(5000)
        channel.events.onReconnect()
        expect(guest.state.linkDown).toBe(false)
        await settle(30_000)
        expect(calls.n).toBe(1)

        channel.events.onDown()
        await settle(21_000)
        expect(calls.n).toBe(2)
        expect(guest.state.linkDown).toBe(false)
        expect(guest.state.status).toBe('live')
    })
})

describe('комнаты: реакции', () => {
    let backend: FakeBackend
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(1_800_000_000_000)
        backend = new FakeBackend()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    async function roomWith(guests: string[] = ['guest']) {
        const host = openWindow(backend, 'host', 0)
        host.player.start(0, 30_000)
        const creating = host.room.create('Реакции')
        await settle(1500)
        await creating
        const wins: Win[] = []
        for (const g of guests) {
            const w = openWindow(backend, g, 0)
            void w.room.join(ROOM_ID)
            await settle(3000)
            wins.push(w)
        }
        await settle(3000)
        return { host, guests: wins }
    }

    const fxPeer = (uid: string, epoch = 0) => [...(backend.channels.get(`roomfx:${ROOM_ID}:${epoch}`) ?? [])].find((c) => c.userId === uid)!
    const shown = (w: Win) => w.state.reactions.map((r) => `${r.emoji} ${r.nick}`)

    it('реакцию шлёт любой участник — не только хозяин; ник берётся из списка участников', async () => {
        const { host, guests: [guest] } = await roomWith()
        expect(host.state.reactionsReady).toBe(true)
        expect(guest.state.reactionsReady).toBe(true)

        guest.room.react('🔥')
        await settle(50)
        // У отправителя и у хозяина — один и тот же ник из списка участников.
        expect(shown(guest)).toEqual(['🔥 ник-guest'])
        expect(shown(host)).toEqual(['🔥 ник-guest'])

        await settle(1000)
        host.room.react('❤️')
        await settle(50)
        expect(shown(guest)).toContain('❤️ ник-host')
        expect(shown(host)).toContain('❤️ ник-host')
    })

    it('не больше 2 в секунду на человека: лишние нажатия молча игнорируются, ничего не уходит в канал', async () => {
        const { host, guests: [guest] } = await roomWith()
        for (let i = 0; i < 6; i++) guest.room.react('😂')
        await settle(50)
        expect(guest.state.reactions).toHaveLength(2)
        expect(host.state.reactions).toHaveLength(2)
        expect(guest.notices.filter((n) => n.error)).toEqual([])
        // Через секунду окно освободилось.
        await settle(1000)
        guest.room.react('👏')
        await settle(50)
        expect(host.state.reactions).toHaveLength(3)
    })

    it('фильтр есть и у получателя: поток от «изменённого» клиента режется до 2 в секунду', async () => {
        const { host } = await roomWith()
        const hostFx = fxPeer('host')
        for (let i = 0; i < 20; i++) hostFx.events.onBroadcast('reaction', { from: 'guest', emoji: '💀' })
        expect(host.state.reactions).toHaveLength(2)
    })

    it('чужой payload не принимается: не эмодзи из набора, разметка, неизвестный участник, чужое событие', async () => {
        const { host, guests: [guest] } = await roomWith()
        const hostFx = fxPeer('host')
        const id = '00000000-0000-4000-8000-000000000001'
        for (const payload of [null, 'x', 5, {}, { from: id, emoji: '<img src=x onerror=alert(1)>' }, { from: id, emoji: '🔥🔥' }, { from: 'не-id', emoji: '🔥' }, { from: id, emoji: '🍕' }]) {
            hostFx.events.onBroadcast('reaction', payload)
        }
        // Правильный формат, но такого участника в комнате нет.
        hostFx.events.onBroadcast('reaction', { from: id, emoji: '🔥' })
        // Другое событие по тому же каналу.
        hostFx.events.onBroadcast('state', { from: id, emoji: '🔥' })
        expect(host.state.reactions).toHaveLength(0)
        expect(guest.state.reactions).toHaveLength(0)
    })

    it('на экране не больше 15 эмодзи; лишние отбрасываются, через время места освобождаются', async () => {
        const { host, guests } = await roomWith(['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'])
        const all = [host, ...guests]
        // 9 человек × 2 нажатия = 18 попыток за одну секунду.
        for (const w of all) {
            w.room.react('🔥')
            w.room.react('🫶')
        }
        await settle(50)
        expect(host.state.reactions.length).toBeLessThanOrEqual(15)
        expect(host.state.reactions.length).toBeGreaterThan(10)
        // Они улетают, и место освобождается.
        await settle(3000)
        expect(host.state.reactions).toHaveLength(0)
        host.room.react('🤯')
        await settle(50)
        expect(host.state.reactions).toHaveLength(1)
    })

    it('реакции нигде не сохраняются: после выхода пусто, в базе и состоянии комнаты их нет', async () => {
        const { host, guests: [guest] } = await roomWith()
        guest.room.react('😭')
        await settle(50)
        expect(host.state.reactions).toHaveLength(1)
        expect(JSON.stringify(backend.rooms.get(ROOM_ID))).not.toContain('😭')
        await guest.room.leave()
        expect(guest.state.reactions).toEqual([])
        expect(guest.state.reactionsReady).toBe(false)
        // Новый гость, вошедший позже, прошлых реакций не видит.
        const late = openWindow(backend, 'late', 0)
        void late.room.join(ROOM_ID)
        await settle(3000)
        expect(late.state.reactions).toEqual([])
    })

    it('исключение: реакции переезжают на новую эпоху у оставшихся, выгнанный их больше не получает', async () => {
        const { host, guests: [stay, gone] } = await roomWith(['stay', 'gone'])
        await host.room.kick('gone')
        await settle(5000)
        expect(gone.state.roomId).toBeNull()
        expect(gone.state.reactionsReady).toBe(false)
        expect(stay.state.epoch).toBe(1)
        expect(stay.state.reactionsReady).toBe(true)
        stay.room.react('🔥')
        await settle(50)
        expect(shown(host)).toEqual(['🔥 ник-stay'])
        expect(gone.state.reactions).toEqual([])
        // На старом топике реакций больше нет никого.
        expect(backend.channels.get(`roomfx:${ROOM_ID}:0`)?.size ?? 0).toBe(0)
    })

    it('канал реакций не открылся — комната работает как прежде, нажатия игнорируются без ошибок', async () => {
        const host = await (async () => {
            const h = openWindow(backend, 'host', 0)
            h.player.start(0, 30_000)
            const creating = h.room.create('Без реакций')
            await settle(1500)
            await creating
            return h
        })()
        const broken: ChannelFactory = (topic, userId, events) => {
            const ch = backend.channelFactory(topic, userId, events)
            if (topic.startsWith('roomfx:')) ch.start = async () => { throw new Error('Unauthorized') }
            return ch
        }
        const guest = openWindow(backend, 'guest', 0, { channel: broken })
        void guest.room.join(ROOM_ID)
        await settle(3000)
        expect(guest.state.status).toBe('live')
        expect(guest.state.reactionsReady).toBe(false)
        guest.room.react('🔥')
        await settle(50)
        expect(guest.state.reactions).toEqual([])
        expect(host.state.reactions).toEqual([])
        expect(guest.notices.filter((n) => n.error)).toEqual([])
        expect(guest.player.trackId).toBe('album-one/first-track')
    })
})

// ── Выход из комнаты: плеер сбрасывается полностью ─────────────────────

describe('комнаты: выход сбрасывает плеер', () => {
    let backend: FakeBackend
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(1_800_000_000_000)
        backend = new FakeBackend()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    async function roomWith(guestsCount = 1) {
        const host = openWindow(backend, 'host', 0)
        host.player.start(0, 30_000)
        const creating = host.room.create('Мои треки')
        await settle(1500)
        await creating
        const guests = Array.from({ length: guestsCount }, (_, i) => openWindow(backend, `guest${i}`, 0))
        guests.forEach((g) => void g.room.join(ROOM_ID))
        await settle(4000)
        return { host, guests }
    }

    /** Плеер как после загрузки страницы: тихо, пусто, и больше ничем не управляет комната. */
    function expectClean(w: Win, label: string) {
        expect(w.player.resets, label).toBeGreaterThanOrEqual(1)
        expect(w.player.isPlaying, label).toBe(false)
        expect(w.player.trackId, label).toBeNull()
        expect(w.player.queueNow, label).toBeNull()
        expect(w.player.role, label).toBeNull()
        expect(w.player.hook, label).toBeNull()
        expect(w.state.roomId, label).toBeNull()
        expect(w.state.status, label).toBe('idle')
    }

    it('гость: кнопка «Выйти»', async () => {
        const { host, guests: [guest] } = await roomWith()
        expect(guest.player.isPlaying).toBe(true)
        await guest.room.leave()
        expectClean(guest, 'гость вышел')
        // Хозяин остаётся в комнате и продолжает играть.
        expect(host.player.isPlaying).toBe(true)
        expect(host.state.roomId).toBe(ROOM_ID)
    })

    it('гость: выгнали', async () => {
        const { host, guests: [guest, other] } = await roomWith(2)
        await host.room.kick('guest0')
        await settle(2000)
        expectClean(guest, 'выгнанный')
        expect(other.player.resets).toBe(0)
        expect(other.player.isPlaying).toBe(true)
    })

    it('гость: хозяин закрыл комнату', async () => {
        const { host, guests: [guest] } = await roomWith()
        await host.room.close()
        await settle(500)
        expectClean(guest, 'гость после закрытия')
        expectClean(host, 'хозяин после закрытия')
    })

    it('гость и хозяин: комнату закрыл администратор или сервер по простою — узнают по сердцебиению', async () => {
        const { host, guests: [guest] } = await roomWith()
        const room = backend.rooms.get(ROOM_ID)!
        room.closed = true
        room.members.clear()
        await settle(50_000)
        expectClean(guest, 'гость')
        expectClean(host, 'хозяин')
        expect(lastNotice(guest.notices)).toBe('Комната закрыта')
        expect(lastNotice(host.notices)).toBe('Комната закрыта')
    })

    it('хозяин: закрыл комнату — музыка не продолжается', async () => {
        const { host } = await roomWith()
        expect(host.player.isPlaying).toBe(true)
        await host.room.close()
        expectClean(host, 'хозяин')
        // Таймеры хозяина остановлены: ничего не оживает сам.
        host.player.start = host.player.start.bind(host.player)
        await settle(20_000)
        expect(host.player.isPlaying).toBe(false)
        expect(host.player.trackId).toBeNull()
    })

    it('хозяин: комната закрыта, пока он перезагружал список участников (запрос вернул «нет такой»)', async () => {
        const { host } = await roomWith(0)
        const room = backend.rooms.get(ROOM_ID)!
        room.closed = true
        await host.room.reload()
        await settle(100)
        expectClean(host, 'хозяин')
    })

    it('выход из аккаунта сбрасывает плеер и хозяина, и гостя', async () => {
        const { host, guests: [guest] } = await roomWith()
        await guest.room.reset()
        await host.room.reset()
        expectClean(guest, 'гость')
        expectClean(host, 'хозяин')
    })

    it('назначенный старт хозяина не оживает после закрытия комнаты', async () => {
        const { host } = await roomWith()
        host.player.start(1, 0) // старт назначен через 1,2 с
        await settle(300)
        await host.room.close()
        host.player.resets = 0
        await settle(5000)
        expect(host.player.isPlaying).toBe(false)
        expect(host.player.trackId).toBeNull()
    })
})

// ── Точная синхронизация ───────────────────────────────────────────────

describe('комнаты: синхронизация', () => {
    let backend: FakeBackend
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(1_800_000_000_000)
        backend = new FakeBackend()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    /** Канал, который записывает всё, что отправил его владелец. */
    function recording(log: { event: string; payload: any; at: number }[]): ChannelFactory {
        return (topic, userId, events) => {
            const inner = backend.channelFactory(topic, userId, events)
            const send = inner.send.bind(inner)
            inner.send = async (event, payload) => {
                if (topic.startsWith('room:')) log.push({ event, payload: JSON.parse(JSON.stringify(payload)), at: Date.now() })
                return send(event, payload)
            }
            return inner
        }
    }

    async function setup(opts: { hostSkew?: number; guestSkew?: number; latency?: number; hostLog?: { event: string; payload: any; at: number }[]; hostApi?: Partial<RoomApi> } = {}) {
        const host = openWindow(backend, 'host', opts.hostSkew ?? 0, { channel: opts.hostLog ? recording(opts.hostLog) : undefined, api: opts.hostApi })
        host.player.latency = opts.latency ?? 0
        host.player.start(0, 30_000)
        const creating = host.room.create('Мои треки')
        await settle(3000)
        await creating
        const guest = openWindow(backend, 'guest', opts.guestSkew ?? 0)
        guest.player.latency = opts.latency ?? 0
        void guest.room.join(ROOM_ID)
        await settle(4000)
        return { host, guest }
    }

    it('смена трека: звук у всех стартует в одно и то же серверное время, через 1,2 с после команды', async () => {
        const { host, guest } = await setup({ hostSkew: +5000, guestSkew: -7000 })
        const t0 = Date.now()
        host.player.start(1, 0)
        // Сразу после команды: ждут, не играют.
        await settle(200)
        expect(host.player.isPlaying).toBe(false)
        expect(guest.player.isPlaying).toBe(false)
        expect(guest.player.trackId).toBe('album-one/second-track')
        await settle(2000)
        const hostStart = host.player.playedAt[host.player.playedAt.length - 1]
        const guestStart = guest.player.playedAt[guest.player.playedAt.length - 1]
        expect(hostStart - t0).toBeGreaterThanOrEqual(1100)
        expect(hostStart - t0).toBeLessThanOrEqual(1400)
        expect(Math.abs(hostStart - guestStart)).toBeLessThan(100)
        expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(100)
    })

    it('старт учитывает, сколько звуку нужно, чтобы пойти: гость с задержкой запуска 150 мс всё равно попадает в такт', async () => {
        const { host, guest } = await setup()
        guest.player.latency = 150
        host.player.latency = 40
        host.player.start(2, 0)
        await settle(2500)
        const hostStart = host.player.playedAt[host.player.playedAt.length - 1]
        const guestStart = guest.player.playedAt[guest.player.playedAt.length - 1]
        // playedAt = момент, когда звук реально пошёл (вызов play + задержка запуска).
        expect(Math.abs(hostStart - guestStart)).toBeLessThan(50)
    })

    it('пауза — мгновенно у всех, без запаса', async () => {
        const { host, guest } = await setup()
        expect(guest.player.isPlaying).toBe(true)
        host.player.userPause()
        await settle(5)
        expect(host.player.isPlaying).toBe(false)
        expect(guest.player.isPlaying).toBe(false)
        const frozenAt = guest.player.positionMs()
        await settle(1000)
        expect(Math.abs(guest.player.positionMs() - frozenAt)).toBeLessThan(5)
        expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(80)
    })

    it('play и перемотка тоже по расписанию; перемотка во время игры замолкает на запас у всех', async () => {
        const { host, guest } = await setup()
        host.player.userPause()
        await settle(500)
        const t0 = Date.now()
        host.player.userResume()
        await settle(300)
        expect(guest.player.isPlaying).toBe(false)
        await settle(1500)
        expect(guest.player.isPlaying).toBe(true)
        expect(Math.abs(host.player.playedAt[host.player.playedAt.length - 1] - guest.player.playedAt[guest.player.playedAt.length - 1])).toBeLessThan(80)
        expect(host.player.playedAt[host.player.playedAt.length - 1] - t0).toBeGreaterThanOrEqual(1100)

        // Перемотка во время игры: на запас звук стоит у всех, потом идёт с новой позиции.
        host.player.userSeek(120_000)
        await settle(300)
        expect(host.player.isPlaying).toBe(false)
        expect(guest.player.isPlaying).toBe(false)
        await settle(2000)
        expect(host.player.isPlaying).toBe(true)
        expect(guest.player.isPlaying).toBe(true)
        expect(host.player.positionMs()).toBeGreaterThan(120_000)
        expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(80)
    })

    it('пауза до наступления старта отменяет его у всех', async () => {
        const { host, guest } = await setup()
        host.player.start(1, 0)
        await settle(500)
        host.player.userPause()
        await settle(5)
        const hostPlays = host.player.playedAt.length
        const guestPlays = guest.player.playedAt.length
        await settle(5000)
        expect(host.player.playedAt.length).toBe(hostPlays)
        expect(guest.player.playedAt.length).toBe(guestPlays)
        expect(host.player.isPlaying).toBe(false)
        expect(guest.player.isPlaying).toBe(false)
    })

    it('трек сменился сам: переход почти без паузы (запас 0,35 с), следующий у гостей уже предзагружен', async () => {
        const { host, guest } = await setup()
        expect(guest.player.preloaded).toContain('album-one/second-track')
        const t0 = Date.now()
        host.player.start(1, 0, { gapless: true })
        await settle(1500)
        const hostStart = host.player.playedAt[host.player.playedAt.length - 1]
        const guestStart = guest.player.playedAt[guest.player.playedAt.length - 1]
        expect(hostStart - t0).toBeLessThanOrEqual(450)
        expect(Math.abs(hostStart - guestStart)).toBeLessThan(80)
        expect(guest.player.preloaded).toContain('album-one/third-track')
    })

    it('команда уходит гостям, не дожидаясь базы; запись в базу идёт параллельно', async () => {
        let release: () => void = () => undefined
        const slow = new Promise<void>((r) => { release = r })
        const real = backend.api('host')
        const gate = { slow: false }
        const { host, guest } = await setup({
            hostApi: {
                setState: async (id, st) => {
                    if (gate.slow) await slow
                    return real.setState(id, st)
                }
            }
        })
        gate.slow = true
        host.player.start(1, 0)
        await settle(100)
        // База ещё «думает», а гость уже знает о новом треке.
        expect(guest.player.trackId).toBe('album-one/second-track')
        expect(parseRoomState(backend.rooms.get(ROOM_ID)!.state)?.track_id).toBe('album-one/first-track')
        release()
        await settle(100)
        expect(parseRoomState(backend.rooms.get(ROOM_ID)!.state)?.track_id).toBe('album-one/second-track')
    })

    it('порядок команд — по номеру хозяина: растёт на каждой команде, сохраняется в базе, после перезагрузки продолжается', async () => {
        const log: { event: string; payload: any; at: number }[] = []
        const { host, guest } = await setup({ hostLog: log })
        host.player.userPause()
        host.player.userResume()
        await settle(3000)
        host.player.userSeek(80_000)
        await settle(3000)
        const states = log.filter((m) => m.event === 'state').map((m) => m.payload.seq as number)
        expect(states.length).toBeGreaterThanOrEqual(4)
        expect([...states].sort((a, b) => a - b)).toEqual(states) // номера не убывают
        expect(new Set(states).size).toBe(states.length) // и не повторяются
        // Маячки внутри команды имеют свой номер, а команды — общий.
        const beats = log.filter((m) => m.event === 'hb')
        expect(beats.length).toBeGreaterThan(0)
        const last = states[states.length - 1]
        expect(guest.state.debug.seq).toBeGreaterThanOrEqual(last)
        const saved = parseRoomState(backend.rooms.get(ROOM_ID)!.state)!
        expect(saved.cseq).toBe(last)

        // Перезагрузка хозяина: номера продолжаются с сохранённого, а не с нуля.
        await host.room.reset()
        const back = openWindow(backend, 'host', 0)
        const log2: typeof log = []
        void log2
        void back.room.restore()
        await settle(4000)
        back.player.start(2, 5000)
        await settle(3000)
        expect(guest.player.trackId).toBe('album-one/third-track')
        expect(guest.state.debug.seq).toBeGreaterThan(last)
    })

    it('старые команды и маячки отбрасываются, новые применяются', async () => {
        const { host, guest } = await setup()
        host.player.userPause()
        await settle(500)
        const channel = [...backend.channels.get(roomTopic(ROOM_ID, 0))!].find((c) => c.userId === 'guest')!
        const seqNow = guest.state.debug.seq
        const track = 'album-one/first-track'
        // Опоздавший маячок прошлой команды: «играю» — гость не оживает.
        channel.events.onBroadcast('hb', { seq: seqNow - 1, beat: 5, sent: Date.now(), at: Date.now(), epoch: 0, track_id: track, pos_ms: 5000, playing: true })
        await settle(1500)
        expect(guest.player.isPlaying).toBe(false)
        // Маячок той же команды с тем же или меньшим номером тоже старый.
        channel.events.onBroadcast('hb', { seq: seqNow, beat: 0, sent: Date.now(), at: Date.now(), epoch: 0, track_id: track, pos_ms: 5000, playing: true })
        await settle(1500)
        expect(guest.player.isPlaying).toBe(false)
        // Свежий маячок новее — применяется.
        channel.events.onBroadcast('hb', { seq: seqNow, beat: 100, sent: Date.now(), at: Date.now(), epoch: 0, track_id: track, pos_ms: 5000, playing: true })
        await settle(1500)
        expect(guest.player.isPlaying).toBe(true)
        // Мусорные маячки гостя не роняют.
        channel.events.onBroadcast('hb', { seq: 'x' })
        channel.events.onBroadcast('hb', null)
        channel.events.onBroadcast('hb', { seq: 1, beat: 1, sent: 1, at: 1, track_id: '../../x', pos_ms: 1, playing: true })
        expect(guest.state.status).toBe('live')
    })

    it('хозяин шлёт маячок каждые 4 секунды, в базу пишет реже', async () => {
        const log: { event: string; payload: any; at: number }[] = []
        let saves = 0
        const real = backend.api('host')
        const { host } = await setup({ hostLog: log, hostApi: { setState: async (id, st) => { saves++; return real.setState(id, st) } } })
        void host
        log.length = 0
        const savesBefore = saves
        await settle(20_000)
        const beats = log.filter((m) => m.event === 'hb')
        expect(beats.length).toBeGreaterThanOrEqual(4)
        expect(beats.length).toBeLessThanOrEqual(6)
        for (let i = 1; i < beats.length; i++) expect(beats[i].at - beats[i - 1].at).toBeGreaterThanOrEqual(3900)
        expect(saves - savesBefore).toBeLessThanOrEqual(2)
    })

    describe('подстройка скоростью', () => {
        it('гость впереди на 0,3 с: замедляется на 4 %, сходится без перемотки и возвращает обычную скорость', async () => {
            const { host, guest } = await setup()
            guest.player.seeks.length = 0
            guest.player.base += 300
            await settle(1100)
            expect(guest.player.rates[guest.player.rates.length - 1]).toBeCloseTo(0.96)
            await settle(15_000)
            expect(guest.player.seeks).toEqual([])
            expect(guest.player.rate).toBe(1)
            expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(60)
        })

        it('гость позади на 0,3 с: ускоряется на 4 %', async () => {
            const { host, guest } = await setup()
            guest.player.seeks.length = 0
            guest.player.base -= 300
            await settle(1100)
            expect(guest.player.rates[guest.player.rates.length - 1]).toBeCloseTo(1.04)
            await settle(15_000)
            expect(guest.player.seeks).toEqual([])
            expect(guest.player.rate).toBe(1)
            expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(60)
        })

        it('малое расхождение (меньше 40 мс) не трогаем; среднее (до 150 мс) выравниваем мягче', async () => {
            const { guest } = await setup()
            guest.player.base += 25
            await settle(3000)
            expect(guest.player.rates).toEqual([])
            guest.player.base += 100
            await settle(1100)
            expect(guest.player.rates[guest.player.rates.length - 1]).toBeCloseTo(0.98)
        })

        it('перемотка — только при расхождении больше 1,2 с, и скорость возвращается к обычной', async () => {
            const { host, guest } = await setup()
            guest.player.seeks.length = 0
            guest.player.base += 1100
            await settle(1100)
            expect(guest.player.seeks).toEqual([]) // 1,1 с — ещё скоростью
            expect(guest.player.rate).toBeLessThan(1)
            guest.player.base += 2000
            await settle(1100)
            expect(guest.player.seeks).toHaveLength(1)
            expect(guest.player.rate).toBe(1)
            await settle(1500)
            expect(Math.abs(guest.player.positionMs() - host.player.positionMs())).toBeLessThan(80)
        })

        it('проверка расхождения — каждую секунду', async () => {
            const { guest } = await setup()
            guest.player.base += 300
            await settle(1001)
            expect(guest.player.rates.length).toBeGreaterThanOrEqual(1)
        })
    })

    it('гость вошёл посреди трека: стартует на ожидаемой позиции без ожидания назначенного старта', async () => {
        const { host } = await setup()
        await settle(60_000)
        const late = openWindow(backend, 'late', -12_000)
        const t0 = Date.now()
        void late.room.join(ROOM_ID)
        await settle(2000)
        expect(late.player.isPlaying).toBe(true)
        expect(late.player.playedAt[late.player.playedAt.length - 1] - t0).toBeLessThan(1500)
        expect(Math.abs(late.player.positionMs() - host.player.positionMs())).toBeLessThan(100)
    })

    it('отладочные цифры: сдвиг часов, задержка, расхождение', async () => {
        const { guest } = await setup({ guestSkew: -7000 })
        guest.player.base += 200
        await settle(1100)
        const d = guest.state.debug
        expect(d.offsetMs).toBeGreaterThan(6900)
        expect(d.offsetMs).toBeLessThan(7100)
        expect(d.rttMs).toBeGreaterThanOrEqual(0)
        expect(d.driftMs).not.toBeNull()
        expect(Math.abs(d.driftMs! - 200)).toBeLessThan(80)
        expect(d.rate).toBeCloseTo(0.96)
        expect(d.netMs).not.toBeNull()
    })
})
