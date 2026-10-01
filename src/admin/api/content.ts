import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase'
import { useAuth } from '../composables/useAuth'

/** Ошибка функции admin-content с машинным кодом и понятным текстом. */
export class AdminApiError extends Error {
    constructor(
        public code: string,
        public status: number,
        message: string,
        public details: string[] = []
    ) {
        super(message)
    }
}

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/admin-content`

export async function callContent<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
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
            headers: {
                Authorization: `Bearer ${token}`,
                apikey: SUPABASE_ANON_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action, ...payload })
        })
    } catch {
        throw new AdminApiError('network', 0, 'Функция admin-content недоступна — проверь интернет и что функция задеплоена')
    }
    let body: any = null
    try {
        body = await res.json()
    } catch {
        body = null
    }
    if (!res.ok) {
        if (res.status === 401) await auth.expire()
        // Без поля error ответ пришёл не от функции, а от шлюза Supabase
        // (например, функция ещё не задеплоена).
        if (!body?.error) {
            const msg = res.status === 404
                ? 'Функция admin-content не найдена — задеплой её (см. инструкцию)'
                : `Ошибка функции admin-content (${res.status})`
            throw new AdminApiError('gateway', res.status, msg)
        }
        throw new AdminApiError(body.error || 'http', res.status, body.message, body.details || [])
    }
    return body as T
}

// ── Действия функции ─────────────────────────────────────────────────

export interface PingResult {
    user: { email: string | null }
    repo: string
    branch: string
}

export interface RepoHead {
    sha: string
    truncated: boolean
    files: { path: string; size: number }[]
}

export type DeployState = 'pending' | 'published' | 'failed' | 'cancelled'

export const ping = () => callContent<PingResult>('ping')
export const fetchHead = () => callContent<RepoHead>('head')
export const readFiles = (ref: string, paths: string[]) =>
    callContent<{ files: Record<string, string | null> }>('read', { ref, paths }).then((r) => r.files)
export const deployStatus = (sha: string) => callContent<{ state: DeployState; url: string | null }>('deploy-status', { sha })
