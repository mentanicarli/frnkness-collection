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
import type { PlayerPort } from '../rooms/port'
import { createRoomController, createRoomState, type RoomController, type RoomUiState } from '../rooms/store'
import { type Queue, createListQueue } from '../player/queue'
import type { PlaybackInfo } from '../player/engine'
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

    private room(): FakeRoom | undefined {
        const m = /^room:([0-9a-f-]{36}):(\d+)$/.exec(this.topic)
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
    role: 'host' | 'guest' | null = null
    changeCb: (() => void) | null = null
    seeks: number[] = []
    unlocked = 0
    /** Какие треки есть в этой версии сайта. */
    catalog = new Set(TRACKS)
    autoplayAllowed = true

    positionMs(): number {
        return this.isPlaying ? this.base + (Date.now() - this.since) : this.base
    }

    info(): PlaybackInfo {
        return { trackId: this.trackId, positionMs: this.positionMs(), durationMs: DURATION, playing: this.isPlaying, ready: this.trackId !== null }
    }
    queue = () => this.queueNow
    setRole = (role: 'host' | 'guest' | null) => {
        this.role = role
    }
    private setPosition(ms: number) {
        this.base = ms
        this.since = Date.now()
    }
    apply(queue: Queue, playing: boolean, targetMs: () => number) {
        const id = queue.trackIds[queue.order[queue.pos]]
        if (!this.catalog.has(id)) return 'missing-track' as const
        this.queueNow = queue
        this.trackId = id
        this.isPlaying = false
        // Загрузка «занимает» 300 мс: позицию считаем по её окончании (canplay).
        setTimeout(() => {
            this.setPosition(targetMs())
            this.isPlaying = playing && this.autoplayAllowed
            this.changeCb?.()
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
        return true
    }
    pause = () => {
        this.setPosition(this.positionMs())
        this.isPlaying = false
    }
    release = () => {
        this.pause()
        this.queueNow = null
    }
    unlock = () => {
        this.unlocked++
    }
    onChange(cb: () => void) {
        this.changeCb = cb
        return () => {
            this.changeCb = null
        }
    }

    // ── Действия хозяина «руками» ──
    start(index: number, ms = 0): void {
        this.queueNow = createListQueue({ kind: 'release', releaseId: 'album-one' }, TRACKS, index, () => true)!
        this.trackId = TRACKS[index]
        this.setPosition(ms)
        this.isPlaying = true
        this.changeCb?.()
    }
    userPause(): void {
        this.pause()
        this.changeCb?.()
    }
    userResume(): void {
        this.setPosition(this.positionMs())
        this.isPlaying = true
        this.changeCb?.()
    }
    userSeek(ms: number): void {
        this.setPosition(ms)
        this.changeCb?.()
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
            calls.n++
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
