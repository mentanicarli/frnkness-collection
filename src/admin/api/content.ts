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

// ── Коммиты и загрузка медиа ─────────────────────────────────────────

export interface StagedBlob {
    sha: string
    path: string
    size: number
    token: string
}

export interface CommitFile {
    path: string
    /** Текстовые файлы — строкой. */
    content?: string
    /** Медиафайлы — после stage-blob. */
    blob?: Pick<StagedBlob, 'sha' | 'size' | 'token'>
}

export interface CommitResult {
    sha: string
    url: string
    message: string
}

export const commitFiles = (baseSha: string, message: string, files: CommitFile[]) =>
    callContent<CommitResult>('commit', { baseSha, message, files })

export const stageBlob = (stagingPath: string, path: string) => callContent<StagedBlob>('stage-blob', { stagingPath, path })

const STAGING_BUCKET = 'admin-uploads'

/**
 * Кладёт файл в приватный staging-бакет. Имя — случайный uuid: функция
 * принимает только такие имена и удаляет файл сразу после переноса в GitHub.
 */
export async function uploadToStaging(file: Blob, ext: string, contentType: string): Promise<string> {
    const name = `${crypto.randomUUID()}.${ext.toLowerCase()}`
    const { error } = await supabase.storage.from(STAGING_BUCKET).upload(name, file, { contentType, upsert: false })
    if (error) {
        const status = (error as { statusCode?: string | number }).statusCode
        if (String(status) === '401' || String(status) === '403') {
            throw new AdminApiError('forbidden', 403, 'Нет доступа к хранилищу загрузок — проверь роль admin')
        }
        if (/payload too large|exceeded the maximum/i.test(error.message)) {
            throw new AdminApiError('too_large', 413, 'Файл больше 30 МБ')
        }
        throw new AdminApiError('upload', 0, `Не удалось загрузить файл: ${error.message}`)
    }
    return name
}
