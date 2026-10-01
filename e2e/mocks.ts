import type { Page, Route } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

// Моки Supabase Auth, PostgREST и функции admin-content. Тесты никогда не
// ходят в боевую базу и не делают реальных коммитов.
export const MOCK_SUPABASE = 'https://mock.supabase.test'
export const STORAGE_KEY = 'frnk-admin-auth'

export const ADMIN_USER = { email: 'admin@example.com', password: 'secret-admin', role: 'admin' }
export const PLAIN_USER = { email: 'user@example.com', password: 'secret-user', role: null }

export const HEAD_SHA = 'a'.repeat(40)

function base64url(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function fakeJwt(email: string, role: string | null, expiresAt: number) {
    const appMetadata = role ? { provider: 'email', role } : { provider: 'email' }
    return [
        base64url({ alg: 'HS256', typ: 'JWT' }),
        base64url({ sub: email, email, role: 'authenticated', aud: 'authenticated', exp: expiresAt, app_metadata: appMetadata }),
        'signature'
    ].join('.')
}

export function fakeSession(user: { email: string; role: string | null }, expiresIn = 3600) {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn
    return {
        access_token: fakeJwt(user.email, user.role, expiresAt),
        token_type: 'bearer',
        expires_in: expiresIn,
        expires_at: expiresAt,
        refresh_token: 'refresh-' + user.email,
        user: {
            id: 'id-' + user.email,
            aud: 'authenticated',
            role: 'authenticated',
            email: user.email,
            app_metadata: user.role ? { provider: 'email', role: user.role } : { provider: 'email' },
            user_metadata: {},
            created_at: '2026-01-01T00:00:00Z'
        }
    }
}

export interface ContentCall {
    action: string
    body: Record<string, unknown>
    authorization: string | null
}

export type ContentResponder = (call: ContentCall) => { status?: number; body: unknown } | undefined

export interface MockOptions {
    content?: ContentResponder
    refreshFails?: boolean
    rpc?: (name: string, body: unknown) => { status?: number; body: unknown } | undefined
}

// Содержимое репозитория для мока read: настоящие файлы из рабочей копии.
export function repoFile(rel: string): string | null {
    const full = path.resolve(__dirname, '..', rel)
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null
}

// Дерево репозитория для мока head: файлы из git с реальными размерами.
let treeCache: { path: string; size: number }[] | null = null
export function repoTree(): { path: string; size: number }[] {
    if (!treeCache) {
        const root = path.resolve(__dirname, '..')
        treeCache = execSync('git -c core.quotepath=off ls-files', { cwd: root, encoding: 'utf8' })
            .split('\n')
            .filter((p) => p && fs.existsSync(path.join(root, p)))
            .map((p) => ({ path: p, size: fs.statSync(path.join(root, p)).size }))
    }
    return treeCache
}

export const defaultContent: ContentResponder = ({ action, body }) => {
    if (action === 'ping') return { body: { user: { email: ADMIN_USER.email }, repo: 'mentanicarli/frnkness-collection', branch: 'main' } }
    if (action === 'head') return { body: { sha: HEAD_SHA, truncated: false, files: repoTree() } }
    if (action === 'read') {
        const paths = body.paths as string[]
        return { body: { files: Object.fromEntries(paths.map((p) => [p, repoFile(p)])) } }
    }
    if (action === 'deploy-status') return { body: { state: 'published', url: 'https://github.com/x/actions/runs/1' } }
    return undefined
}

export async function installMocks(page: Page, options: MockOptions = {}) {
    const calls: ContentCall[] = []
    const unexpected: string[] = []
    const users = [ADMIN_USER, PLAIN_USER]

    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({
            status,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: body === null ? '' : JSON.stringify(body)
        })

    // Настоящий Supabase недоступен в тестах ни при каких условиях.
    await page.route(/https:\/\/[^/]*supabase\.co\//, (route) => {
        unexpected.push(route.request().url())
        return route.abort()
    })
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())

    await page.route(`${MOCK_SUPABASE}/**`, async (route) => {
        const req = route.request()
        const url = new URL(req.url())
        const method = req.method()
        if (method === 'OPTIONS') {
            return route.fulfill({
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
                }
            })
        }
        const body = req.postData() ? JSON.parse(req.postData()!) : {}

        if (url.pathname === '/auth/v1/token') {
            if (url.searchParams.get('grant_type') === 'password') {
                const user = users.find((u) => u.email === body.email && u.password === body.password)
                if (!user) return json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
                return json(route, 200, fakeSession(user))
            }
            if (url.searchParams.get('grant_type') === 'refresh_token') {
                if (options.refreshFails) {
                    return json(route, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' })
                }
                return json(route, 200, fakeSession(ADMIN_USER))
            }
        }
        if (url.pathname === '/auth/v1/logout') return json(route, 204, null)
        if (url.pathname === '/auth/v1/user') return json(route, 200, fakeSession(ADMIN_USER).user)

        if (url.pathname === '/functions/v1/admin-content') {
            const call = { action: String(body.action), body, authorization: req.headers()['authorization'] ?? null }
            calls.push(call)
            const res = options.content?.(call) ?? defaultContent(call)
            if (res) return json(route, res.status ?? 200, res.body)
            return json(route, 400, { error: 'bad_request', message: 'нет мока для ' + call.action })
        }

        if (url.pathname.startsWith('/rest/v1/rpc/')) {
            const name = url.pathname.slice('/rest/v1/rpc/'.length)
            const res = options.rpc?.(name, body)
            if (res) return json(route, res.status ?? 200, res.body)
        }

        unexpected.push(`${method} ${url.pathname}`)
        return json(route, 404, { message: 'not mocked' })
    })

    return { calls, unexpected }
}

export async function loginAs(page: Page, user: { email: string; password: string }) {
    await page.goto('/admin.html')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Пароль').fill(user.password)
    await page.getByRole('button', { name: 'Войти' }).click()
}
