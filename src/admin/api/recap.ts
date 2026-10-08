import { rpc } from './users'
import type { Recap } from '@/site/recap/types'

/**
 * Раздел «Итоги года»: общие цифры, просмотр итогов любого пользователя и
 * публикация. Права проверяет база (admin и owner), поэтому здесь только вызовы RPC.
 */

const num = (v: unknown) => Number(v) || 0

export interface RecapOverview {
    year: number
    users_total: number
    users_listening: number
    plays: number
    minutes: number
    favorites_added: number
    rooms: number
    top_tracks: { track_key: string; plays: number }[]
}

export type RecapMode = 'off' | 'selected' | 'all'

export interface RecapGrant {
    user_id: string
    nick: string
    avatar: string
    /** true — открыто лично; false — скрыто при режиме «всем». */
    granted: boolean
}

export interface RecapStatus {
    year: number
    mode: RecapMode
    visible_count: number
    users_total: number
    grants: RecapGrant[]
}

export type RecapAction = 'show_all' | 'show_selected' | 'hide_all' | 'hide_selected'

export async function fetchRecapOverview(year: number): Promise<RecapOverview> {
    const o = await rpc<RecapOverview>('admin_recap_overview', { p_year: year })
    return {
        year: num(o.year),
        users_total: num(o.users_total),
        users_listening: num(o.users_listening),
        plays: num(o.plays),
        minutes: num(o.minutes),
        favorites_added: num(o.favorites_added),
        rooms: num(o.rooms),
        top_tracks: (o.top_tracks ?? []).map((t) => ({ track_key: t.track_key, plays: num(t.plays) }))
    }
}

function status(s: RecapStatus): RecapStatus {
    return { year: num(s.year), mode: s.mode, visible_count: num(s.visible_count), users_total: num(s.users_total), grants: s.grants ?? [] }
}

export async function fetchRecapStatus(year: number): Promise<RecapStatus> {
    return status(await rpc<RecapStatus>('admin_recap_status', { p_year: year }))
}

export async function setRecapPublication(year: number, action: RecapAction, users: string[] = []): Promise<RecapStatus> {
    return status(await rpc<RecapStatus>('admin_recap_set', { p_year: year, p_action: action, p_users: users }))
}

/** Итоги конкретного пользователя — ровно те, что увидит он сам. */
export function fetchUserRecap(year: number, userId: string): Promise<Recap> {
    return rpc<Recap>('year_recap', { p_year: year, p_user: userId })
}
