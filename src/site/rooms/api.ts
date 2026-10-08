import { type Profile, rpc } from '../social/api'
import type { RoomPlayerState } from './sync'

/**
 * Обращения сайта к комнатам (supabase/migrations/20261008120000_rooms.sql).
 * Только RPC: права, лимиты и ошибки (готовым русским текстом) — на стороне базы.
 */

export interface RoomMember extends Profile {
    joined_at: string
    owner: boolean
}

/** Комната участника. state — как сохранил хозяин (проверять parseRoomState). */
export interface RoomView {
    id: string
    title: string
    epoch: number
    owner: Profile
    is_owner: boolean
    capacity: number
    members: RoomMember[]
    state: unknown
    seq: number
    /** Серверное время (мс) сохранения state; null — состояние ещё не сохраняли. */
    at_ms: number | null
    /** Серверное время (мс), когда хозяин последний раз подавал признаки жизни. */
    owner_seen_ms: number
    server_ms: number
}

export type RoomInfo =
    | { closed: true }
    | { closed: false; id: string; title: string; owner: Profile; members: number; capacity: number; full: boolean; is_member: boolean; kicked: boolean }

export interface SavedState {
    seq: number
    at_ms: number
    epoch: number
}

export interface Heartbeat {
    member: boolean
    closed: boolean
    epoch?: number
    server_ms: number
}

export interface RoomInvite {
    room_id: string
    title: string
    from: Profile
    created_at: string
}

const num = (v: unknown): number => Number(v)

function normalizeView(v: RoomView): RoomView {
    return {
        ...v,
        epoch: num(v.epoch),
        seq: num(v.seq),
        at_ms: v.at_ms === null || v.at_ms === undefined ? null : num(v.at_ms),
        owner_seen_ms: num(v.owner_seen_ms),
        server_ms: num(v.server_ms),
        members: v.members ?? []
    }
}

export interface RoomApi {
    serverNow(): Promise<number>
    create(title: string): Promise<RoomView>
    join(roomId: string): Promise<RoomView>
    leave(): Promise<void>
    close(roomId: string): Promise<void>
    get(roomId: string): Promise<RoomView>
    my(): Promise<RoomView | null>
    info(roomId: string): Promise<RoomInfo>
    setState(roomId: string, state: RoomPlayerState): Promise<SavedState>
    heartbeat(roomId: string): Promise<Heartbeat>
    kick(roomId: string, userId: string): Promise<{ epoch: number }>
    invite(roomId: string, userId: string): Promise<void>
    invitesList(): Promise<RoomInvite[]>
    invitesCount(): Promise<number>
    inviteDismiss(roomId: string): Promise<void>
}

export const roomApi: RoomApi = {
    serverNow: async () => num(await rpc<number>('server_now')),
    create: async (title) => normalizeView(await rpc<RoomView>('room_create', { p_title: title })),
    join: async (roomId) => normalizeView(await rpc<RoomView>('room_join', { p_room: roomId })),
    leave: async () => {
        await rpc<null>('room_leave')
    },
    close: async (roomId) => {
        await rpc<null>('room_close', { p_room: roomId })
    },
    get: async (roomId) => normalizeView(await rpc<RoomView>('room_get', { p_room: roomId })),
    my: async () => {
        const v = await rpc<RoomView | null>('room_my')
        return v ? normalizeView(v) : null
    },
    info: (roomId) => rpc<RoomInfo>('room_info', { p_room: roomId }),
    setState: async (roomId, state) => {
        const r = await rpc<SavedState>('room_set_state', { p_room: roomId, p_state: state })
        return { seq: num(r.seq), at_ms: num(r.at_ms), epoch: num(r.epoch) }
    },
    heartbeat: async (roomId) => {
        const r = await rpc<Heartbeat>('room_heartbeat', { p_room: roomId })
        return { ...r, epoch: r.epoch === undefined ? undefined : num(r.epoch), server_ms: num(r.server_ms) }
    },
    kick: async (roomId, userId) => {
        const r = await rpc<{ epoch: number }>('room_kick', { p_room: roomId, p_user: userId })
        return { epoch: num(r.epoch) }
    },
    invite: async (roomId, userId) => {
        await rpc<null>('room_invite', { p_room: roomId, p_user: userId })
    },
    invitesList: async () => (await rpc<RoomInvite[]>('room_invites_list')) ?? [],
    invitesCount: async () => num(await rpc<number>('room_invites_count')) || 0,
    inviteDismiss: async (roomId) => {
        await rpc<null>('room_invite_dismiss', { p_room: roomId })
    }
}
