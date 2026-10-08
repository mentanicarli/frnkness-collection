import { rpc } from './users'

/**
 * Разделы «Ошибки» и «Обращения»: чтение и смена статуса — RPC администратора
 * (права проверяет база: admin и owner). Все тексты внутри приходят от
 * пользователей сайта, поэтому в шаблонах выводятся только интерполяцией.
 */

const num = (v: unknown) => Number(v) || 0

export interface ErrorGroup {
    fingerprint: string
    message: string
    stack: string
    page: string
    build: string
    count: number
    users: number
    first_seen: string
    last_seen: string
    resolved: boolean
    browsers: { browser: string; count: number }[]
}

/** Группы одинаковых ошибок; записи старше 30 дней база удаляет при этом обращении. */
export async function fetchErrorGroups(resolved: boolean): Promise<ErrorGroup[]> {
    const rows = await rpc<ErrorGroup[] | null>('admin_errors_list', { p_resolved: resolved })
    return (rows ?? []).map((g) => ({
        ...g,
        count: num(g.count),
        users: num(g.users),
        browsers: (g.browsers ?? []).map((b) => ({ browser: b.browser, count: num(b.count) }))
    }))
}

/** «Отметить решённой» (или вернуть в работу). Если ошибка появится снова, группа вернётся сама. */
export function resolveErrorGroup(fingerprint: string, resolved = true): Promise<number> {
    return rpc<number>('admin_errors_resolve', { p_fingerprint: fingerprint, p_resolved: resolved })
}

export type FeedbackStatus = 'new' | 'done'

export interface FeedbackRow {
    id: number
    user_id: string | null
    nick: string
    message: string
    page: string
    browser: string
    build: string
    status: FeedbackStatus
    created_at: string
    closed_at: string | null
}

export async function fetchFeedback(status: FeedbackStatus | null): Promise<FeedbackRow[]> {
    const rows = await rpc<FeedbackRow[] | null>('admin_feedback_list', { p_status: status })
    return (rows ?? []).map((r) => ({ ...r, id: num(r.id) }))
}

export function setFeedbackStatus(id: number, status: FeedbackStatus): Promise<null> {
    return rpc<null>('admin_feedback_set', { p_id: id, p_status: status })
}

export async function fetchFeedbackNewCount(): Promise<number> {
    return num(await rpc<number>('admin_feedback_new_count'))
}
