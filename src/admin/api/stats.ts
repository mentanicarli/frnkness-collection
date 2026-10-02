import { supabase } from './supabase'
import { AdminApiError } from './content'
import { useAuth } from '../composables/useAuth'
import type { DayKeyPlays, DayPlays, KeyPlays } from '../lib/stats'
import type { IsoDate } from '../lib/dates'

/**
 * Admin-only RPC статистики. Права проверяет сама база (is_admin() по JWT),
 * здесь только перевод ошибок в понятные сообщения.
 */
async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error, status } = await supabase.rpc(name, args)
    if (error) {
        if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') {
            await useAuth().expire()
            throw new AdminApiError('unauthorized', 401, 'Сессия истекла — войди заново')
        }
        if (error.code === '42501' || status === 403) throw new AdminApiError('forbidden', 403, 'Нет доступа к статистике')
        if (error.code === 'PGRST202' || status === 404) {
            throw new AdminApiError('missing', 404, 'Функции статистики не найдены — примени миграции этапа 2 (supabase db push)')
        }
        throw new AdminApiError('db', status, `Ошибка базы: ${error.message}`)
    }
    return data as T
}

export interface StatsOverview {
    total: number
    today: number
    last7: number
    last30: number
    /** Момент запуска журнала play_events; до него графиков по дням нет. */
    tracking_since: string | null
    today_date: IsoDate
}

const num = (v: unknown) => Number(v) || 0

export async function fetchOverview(): Promise<StatsOverview> {
    const o = await rpc<StatsOverview>('admin_stats_overview')
    return { ...o, total: num(o.total), today: num(o.today), last7: num(o.last7), last30: num(o.last30) }
}

export async function fetchDaily(from: IsoDate, to: IsoDate): Promise<DayPlays[]> {
    const rows = await rpc<DayPlays[]>('admin_stats_daily', { p_from: from, p_to: to })
    return rows.map((r) => ({ day: r.day, plays: num(r.plays) }))
}

export async function fetchDailyByKey(from: IsoDate, to: IsoDate): Promise<DayKeyPlays[]> {
    const rows = await rpc<DayKeyPlays[]>('admin_stats_daily_by_key', { p_from: from, p_to: to })
    return rows.map((r) => ({ day: r.day, track_key: r.track_key, plays: num(r.plays) }))
}

export async function fetchByKey(from: IsoDate, to: IsoDate): Promise<KeyPlays[]> {
    const rows = await rpc<KeyPlays[]>('admin_stats_by_key', { p_from: from, p_to: to })
    return rows.map((r) => ({ track_key: r.track_key, plays: num(r.plays) }))
}

export async function fetchAllTime(): Promise<KeyPlays[]> {
    const rows = await rpc<KeyPlays[]>('admin_stats_all_time')
    return rows.map((r) => ({ track_key: r.track_key, plays: num(r.plays) }))
}

// ── Дослушивают или пропускают ───────────────────────────────────────

export interface ListenMeta {
    started_at: string | null
    sessions: number
}

export interface ListenKeyRow {
    track_key: string
    sessions: number
    completed: number
    avg_share: number
}

export interface RetentionRow {
    second: number
    listeners: number
    sessions: number
}

export async function fetchListenMeta(): Promise<ListenMeta> {
    const m = await rpc<ListenMeta>('admin_listen_meta')
    return { started_at: m.started_at, sessions: num(m.sessions) }
}

export async function fetchListenByKey(from: IsoDate, to: IsoDate): Promise<ListenKeyRow[]> {
    const rows = await rpc<ListenKeyRow[]>('admin_listen_by_key', { p_from: from, p_to: to })
    return rows.map((r) => ({ track_key: r.track_key, sessions: num(r.sessions), completed: num(r.completed), avg_share: num(r.avg_share) }))
}

export async function fetchRetention(trackKey: string, from: IsoDate, to: IsoDate): Promise<RetentionRow[]> {
    const rows = await rpc<RetentionRow[]>('admin_listen_retention', { p_track_key: trackKey, p_from: from, p_to: to })
    return rows.map((r) => ({ second: num(r.second), listeners: num(r.listeners), sessions: num(r.sessions) }))
}
