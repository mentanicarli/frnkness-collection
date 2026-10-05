import type { Page, Route } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { FIXTURE_ROOT, FIXTURE_UPLOADS, fixtureText, fixtureTree } from '../tests/fixtures/catalog'

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

// «Репозиторий» в тестах — фикстура tests/fixtures/catalog, а не настоящий
// каталог: тот меняется из админки, и тесты не должны от него зависеть.
// Сайт и админка в браузере тоже видят фикстуру: реестр, тексты, mp3 и
// обложки подменяются в installMocks.
let treeCache: { path: string; size: number }[] | null = null
export function repoTree(): { path: string; size: number }[] {
    if (!treeCache) treeCache = fixtureTree()
    return treeCache
}

export function repoFile(rel: string): string | null {
    return /\.(txt|lrc|json)$/i.test(rel) ? fixtureText(rel) : null
}

export { FIXTURE_UPLOADS }

// Как lyricsIndexPlugin в vite.config.ts, только по фикстуре: .lrc, а для
// треков без караоке — .txt; и все .notes.json одним файлом.
function fixtureLyricsIndex(): string {
    const paths = repoTree().map((f) => f.path)
    const index: Record<string, string> = {}
    for (const p of paths) {
        if (!p.startsWith('lyrics/')) continue
        const isLrc = p.toLowerCase().endsWith('.lrc')
        const isTxtWithoutLrc = p.toLowerCase().endsWith('.txt') && !paths.includes(p.replace(/\.txt$/i, '.lrc'))
        if (isLrc || isTxtWithoutLrc) index[p] = fixtureText(p)!
    }
    return JSON.stringify(index)
}

function fixtureTrackNotes(): string {
    const notes: Record<string, unknown> = {}
    for (const { path: p } of repoTree()) if (p.startsWith('lyrics/') && p.endsWith('.notes.json')) notes[p] = JSON.parse(fixtureText(p)!)
    return JSON.stringify(notes)
}

const CONTENT_TYPES: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.lrc': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
}

/** Сайт и админка в браузере видят фикстурный каталог вместо настоящего. */
async function routeFixtureCatalog(page: Page) {
    // Dev-сервер отдаёт src/content/*.json как JS-модули (их импортирует src/config.ts).
    await page.route(/\/src\/content\/(releases|site)\.json(\?|$)/, (route) => {
        const name = new URL(route.request().url()).pathname.endsWith('site.json') ? 'site' : 'releases'
        return route.fulfill({ contentType: 'application/javascript', body: `export default ${fixtureText(`src/content/${name}.json`)}` })
    })
    await page.route(/\/(lyrics-index|track-notes)\.json(\?|$)/, (route) =>
        route.fulfill({
            contentType: 'application/json; charset=utf-8',
            body: route.request().url().includes('lyrics-index') ? fixtureLyricsIndex() : fixtureTrackNotes()
        })
    )
    await page.route(/^https?:\/\/localhost:\d+\/(audio|images|lyrics|lyrics-books)\//, (route) => {
        const rel = decodeURIComponent(new URL(route.request().url()).pathname.slice(1))
        const full = path.join(FIXTURE_ROOT, rel)
        if (!fs.existsSync(full)) return route.fulfill({ status: 404, body: 'not in fixture: ' + rel })
        const type = CONTENT_TYPES[path.extname(rel).toLowerCase()] ?? 'application/octet-stream'
        const body = fs.readFileSync(full)
        // Без ответов на Range браузер не даёт перематывать <audio>.
        const range = route.request().headers()['range']?.match(/^bytes=(\d+)-(\d*)$/)
        if (range) {
            const start = Number(range[1])
            const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
            return route.fulfill({
                status: 206,
                contentType: type,
                headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}` },
                body: body.subarray(start, end + 1)
            })
        }
        return route.fulfill({ contentType: type, headers: { 'Accept-Ranges': 'bytes' }, body })
    })
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
    const uploads: { name: string; size: number; contentType: string }[] = []
    const repoState = { sha: HEAD_SHA, files: {} as Record<string, string> }
    const unexpected: string[] = []
    const users = [ADMIN_USER, PLAIN_USER]

    const json = (route: Route, status: number, body: unknown) =>
        route.fulfill({
            status,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: body === null ? '' : JSON.stringify(body)
        })

    await routeFixtureCatalog(page)

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
        let body: any = {}
        try {
            body = req.postData() ? JSON.parse(req.postData()!) : {}
        } catch {
            body = {}
        }

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
            let res = options.content?.(call)
            // Репозиторий после коммитов: head отдаёт новый sha, read — закоммиченное.
            if (!res && call.action === 'head' && repoState.sha !== HEAD_SHA) {
                res = { body: { sha: repoState.sha, truncated: false, files: repoTree() } }
            }
            if (!res && call.action === 'read') {
                const paths = body.paths as string[]
                res = { body: { files: Object.fromEntries(paths.map((p) => [p, p in repoState.files ? repoState.files[p] : repoFile(p)])) } }
            }
            res = res ?? defaultContent(call)
            if (res && call.action === 'commit' && (res.status ?? 200) === 200) {
                for (const f of body.files as { path: string; content?: string }[]) {
                    if (typeof f.content === 'string') repoState.files[f.path] = f.content
                }
                repoState.sha = (res.body as { sha: string }).sha
            }
            if (res) return json(route, res.status ?? 200, res.body)
            return json(route, 400, { error: 'bad_request', message: 'нет мока для ' + call.action })
        }

        if (url.pathname.startsWith('/storage/v1/object/admin-uploads/') && method === 'POST') {
            const name = decodeURIComponent(url.pathname.slice('/storage/v1/object/admin-uploads/'.length))
            // Тип файла — из части multipart, как его видит Storage.
            const raw = req.postDataBuffer()?.toString('latin1') ?? ''
            const partType = raw.match(/filename="[^"]*"\r\nContent-Type: ([^\r]+)/)?.[1] ?? ''
            uploads.push({ name, size: req.postDataBuffer()?.length ?? 0, contentType: partType })
            return json(route, 200, { Key: 'admin-uploads/' + name, Id: name })
        }

        if (url.pathname.startsWith('/rest/v1/rpc/')) {
            const name = url.pathname.slice('/rest/v1/rpc/'.length)
            const res = options.rpc?.(name, body)
            if (res) return json(route, res.status ?? 200, res.body)
        }

        unexpected.push(`${method} ${url.pathname}`)
        return json(route, 404, { message: 'not mocked' })
    })

    return { calls, unexpected, uploads }
}

export async function loginAs(page: Page, user: { email: string; password: string }) {
    await page.goto('/admin.html')
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Пароль').fill(user.password)
    await page.getByRole('button', { name: 'Войти' }).click()
}
