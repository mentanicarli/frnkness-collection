import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase'
import { AdminApiError } from './content'
import { useAuth } from '../composables/useAuth'
import type { AppRole } from '../../../supabase/functions/_shared/accounts.ts'
import type { IsoDate } from '../lib/dates'

/**
 * Раздел «Пользователи» и «Заявки на восстановление»: чтение — admin/owner
 * RPC (права проверяет база), изменения — функция admin-users.
 */

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error, status } = await supabase.rpc(name, args)
    if (error) {
        if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') {
            await useAuth().expire()
            throw new AdminApiError('unauthorized', 401, 'Сессия истекла — войди заново')
        }
        if (error.code === '42501' || status === 403) throw new AdminApiError('forbidden', 403, 'Нет доступа')
        if (error.code === 'P0002') throw new AdminApiError('not_found', 404, error.message)
        if (error.code === 'PGRST202' || status === 404) {
            throw new AdminApiError('missing', 404, 'Функции не найдены — примени миграции этапа «Аккаунты» (supabase db push)')
        }
        throw new AdminApiError('db', status, `Ошибка базы: ${error.message}`)
    }
    return data as T
}

const num = (v: unknown) => Number(v) || 0

export interface UserRow {
    id: string
    nick: string | null
    avatar: string | null
    role: AppRole
    created_at: string
    last_sign_in_at: string | null
    banned_until: string | null
    has_profile: boolean
}

export interface UserCard {
    id: string
    nick: string | null
    avatar: string | null
    bio: string | null
    role: AppRole
    created_at: string
    last_sign_in_at: string | null
    banned_until: string | null
    must_change_password: boolean
    nick_changed_at: string | null
    sessions: number
    plays: number
    plays_30d: number
    last_play_at: string | null
    listen_seconds: number
    top: { track_key: string; plays: number }[]
}

export function fetchUsers(search: string): Promise<UserRow[]> {
    return rpc<UserRow[]>('admin_users_list', { p_search: search.slice(0, 40) })
}

export async function fetchUserCard(id: string): Promise<UserCard> {
    const c = await rpc<UserCard>('admin_user_card', { p_user: id })
    return {
        ...c,
        sessions: num(c.sessions),
        plays: num(c.plays),
        plays_30d: num(c.plays_30d),
        listen_seconds: num(c.listen_seconds),
        top: (c.top ?? []).map((t) => ({ track_key: t.track_key, plays: num(t.plays) }))
    }
}

export interface UsersOverview {
    total: number
    active7: number
    new7: number
    banned: number
}

export async function fetchUsersOverview(): Promise<UsersOverview> {
    const o = await rpc<UsersOverview>('admin_users_overview')
    return { total: num(o.total), active7: num(o.active7), new7: num(o.new7), banned: num(o.banned) }
}

export async function fetchRegistrationsDaily(from: IsoDate, to: IsoDate): Promise<{ day: string; plays: number }[]> {
    const rows = await rpc<{ day: string; registrations: number }[]>('admin_users_daily', { p_from: from, p_to: to })
    // Формат как у графика прослушиваний (BarChart ждёт поле plays).
    return rows.map((r) => ({ day: r.day, plays: num(r.registrations) }))
}

// ── Заявки на восстановление (только владелец) ─────────────────────────

export interface RecoveryRow {
    id: number
    nick: string
    user_id: string | null
    current_nick: string | null
    contact: string | null
    comment: string
    status: 'new' | 'done' | 'rejected'
    created_at: string
    closed_at: string | null
}

export async function fetchRecovery(): Promise<RecoveryRow[]> {
    const rows = await rpc<RecoveryRow[]>('owner_recovery_list')
    return rows.map((r) => ({ ...r, id: num(r.id) }))
}

export async function fetchRecoveryNewCount(): Promise<number> {
    return num(await rpc<number>('owner_recovery_new_count'))
}

export async function closeRecovery(id: number, status: 'done' | 'rejected'): Promise<void> {
    await rpc('owner_recovery_close', { p_id: id, p_status: status })
}

// ── Действия функции admin-users ───────────────────────────────────────

export type UserAction =
    | { action: 'reset-password'; password: string }
    | { action: 'rename'; nick: string }
    | { action: 'set-bio'; bio: string }
    | { action: 'remove-avatar' }
    | { action: 'ban' }
    | { action: 'unban' }
    | { action: 'sign-out' }
    | { action: 'delete' }
    | { action: 'set-role'; role: 'user' | 'admin' }

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/admin-users`

export async function userAction(userId: string, payload: UserAction): Promise<Record<string, unknown>> {
    const auth = useAuth()
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
        await auth.expire()
        throw new AdminApiError('unauthorized', 401, 'Сессия истекла — войди заново')
    }
    let res: Response
    try {
        res = await fetch(FUNCTION_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, ...payload })
        })
    } catch {
        throw new AdminApiError('network', 0, 'Функция admin-users недоступна — проверь интернет и что функция задеплоена')
    }
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
    if (!res.ok) {
        if (res.status === 401) await auth.expire()
        if (!body?.error) {
            throw new AdminApiError('gateway', res.status, res.status === 404 ? 'Функция admin-users не найдена — задеплой её (см. инструкцию)' : `Ошибка функции admin-users (${res.status})`)
        }
        throw new AdminApiError(body.error.code || 'http', res.status, body.error.message || 'Ошибка')
    }
    return (body ?? {}) as Record<string, unknown>
}

/** Временный пароль: 12 символов без похожих (0/O, 1/l). */
export function generateTempPassword(random: (n: number) => number = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n): string {
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
    let out = ''
    for (let i = 0; i < 12; i++) out += alphabet[random(alphabet.length)]
    return out
}
