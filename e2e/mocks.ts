import type { Page, Route } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { FIXTURE_ROOT, FIXTURE_UPLOADS, fixtureText, fixtureTree } from '../tests/fixtures/catalog'
import { AccountsBackend, E2E_CAPTCHA, mkUser, type AccountRecord, type MockUser } from './accountsMock'

// Моки Supabase Auth, PostgREST, Storage и Edge Functions. Тесты никогда не
// ходят в боевую базу и не делают реальных коммитов.
export const MOCK_SUPABASE = 'https://mock.supabase.test'
// Сессия общая у сайта и админки (src/supabaseConfig.ts, AUTH_STORAGE_KEY).
export const STORAGE_KEY = 'frnk-auth'

export const OWNER_USER = mkUser(1, 'frnkness', 'secret-owner', 'owner')
export const ADMIN_USER = mkUser(2, 'Друг', 'secret-admin', 'admin')
export const PLAIN_USER = mkUser(3, 'Слушатель', 'secret-user', null)
export const SECOND_USER = mkUser(4, 'Второй', 'secret-second', 'user')
export { E2E_CAPTCHA }

export const HEAD_SHA = 'a'.repeat(40)

function base64url(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString('base64url')
}

type SessionUser = { email: string; role: string | null; id?: string }

export function fakeJwt(user: SessionUser, expiresAt: number) {
    const appMetadata = user.role ? { provider: 'email', role: user.role } : { provider: 'email' }
    return [
        base64url({ alg: 'HS256', typ: 'JWT' }),
        base64url({ sub: user.id ?? 'id-' + user.email, email: user.email, role: 'authenticated', aud: 'authenticated', exp: expiresAt, app_metadata: appMetadata }),
        'signature'
    ].join('.')
}

export function fakeSession(user: SessionUser, expiresIn = 3600) {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn
    const id = user.id ?? 'id-' + user.email
    return {
        access_token: fakeJwt(user, expiresAt),
        token_type: 'bearer',
        expires_in: expiresIn,
        expires_at: expiresAt,
        refresh_token: 'refresh-' + id,
        user: {
            id,
            aud: 'authenticated',
            role: 'authenticated',
            email: user.email,
            app_metadata: user.role ? { provider: 'email', role: user.role } : { provider: 'email' },
            user_metadata: {},
            created_at: '2026-01-01T00:00:00Z'
        }
    }
}

const sessionOf = (a: AccountRecord) => fakeSession({ id: a.id, email: a.email, role: a.role })

/** Сайт открывается уже вошедшим (сессия в localStorage, как после входа). */
export async function signInSite(page: Page, user: MockUser = PLAIN_USER) {
    await page.addInitScript(
        ([key, session]) => {
            if (!sessionStorage.getItem('e2e-signed-in')) {
                localStorage.setItem(key, JSON.stringify(session))
                sessionStorage.setItem('e2e-signed-in', '1')
            }
        },
        [STORAGE_KEY, fakeSession({ id: user.id, email: user.email, role: user.role })] as const
    )
}

// Поддельный Cloudflare Turnstile: виджет сразу «проходит» с E2E_CAPTCHA,
// после reset() — снова (как настоящий: токен одноразовый, проверка повторяется).
const TURNSTILE_STUB = `(() => {
    const widgets = {}; let n = 0;
    window.turnstile = {
        render(el, opts) { const id = 'w' + (++n); widgets[id] = opts; const box = document.createElement('div'); box.dataset.testid = 'turnstile'; box.textContent = 'captcha ok'; el.appendChild(box); setTimeout(() => opts.callback('${E2E_CAPTCHA}'), 0); return id },
        reset(id) { const o = widgets[id]; if (o) setTimeout(() => o.callback('${E2E_CAPTCHA}'), 0) },
        remove(id) { delete widgets[id] }
    };
})();`

export interface ContentCall {
    action: string
    body: Record<string, unknown>
    authorization: string | null
}

export type ContentResponder = (call: ContentCall) => { status?: number; body: unknown } | undefined

export interface MockOptions {
    content?: ContentResponder
    refreshFails?: boolean
    /** Пользователи «базы» (по умолчанию — владелец, админ и два пользователя). */
    users?: MockUser[]
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
    const accounts = new AccountsBackend(options.users ?? [OWNER_USER, ADMIN_USER, PLAIN_USER, SECOND_USER])

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
    await page.route('https://challenges.cloudflare.com/**', (route) =>
        route.request().url().includes('/turnstile/v0/api.js')
            ? route.fulfill({ contentType: 'application/javascript', body: TURNSTILE_STUB })
            : route.abort()
    )

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

        const caller = accounts.byJwt((req.headers()['authorization'] ?? '').replace(/^Bearer\s+/i, ''))

        if (url.pathname === '/auth/v1/token') {
            if (url.searchParams.get('grant_type') === 'password') {
                const account = accounts.byEmail(String(body.email))
                if (!account || account.password !== body.password) {
                    return json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
                }
                if (accounts.isBanned(account)) return json(route, 400, { code: 400, error_code: 'user_banned', msg: 'User is banned' })
                account.lastSignInAt = new Date().toISOString()
                return json(route, 200, sessionOf(account))
            }
            if (url.searchParams.get('grant_type') === 'refresh_token') {
                const account = accounts.accounts.get(String(body.refresh_token ?? '').replace(/^refresh-/, ''))
                if (options.refreshFails || !account || accounts.isBanned(account)) {
                    return json(route, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' })
                }
                return json(route, 200, sessionOf(account))
            }
        }
        if (url.pathname === '/auth/v1/logout') return json(route, 204, null)
        if (url.pathname === '/auth/v1/user') {
            return caller ? json(route, 200, sessionOf(caller).user) : json(route, 401, { code: 401, msg: 'invalid JWT' })
        }

        // ── Edge Functions аккаунтов — настоящие обработчики ──
        const fn = url.pathname.match(/^\/functions\/v1\/(register|recovery-request|account|admin-users)$/)?.[1]
        if (fn) {
            const res = await accounts.handlers[fn](
                new Request(req.url(), { method, headers: req.headers(), body: method === 'POST' ? req.postData() ?? '' : undefined })
            )
            return route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: await res.text() })
        }

        // ── PostgREST: профили ──
        const eqId = url.searchParams.get('id')?.replace(/^eq\./, '') ?? null
        const rows = (list: unknown[]) =>
            (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
                ? list.length ? json(route, 200, list[0]) : json(route, 406, { code: 'PGRST116', message: 'no rows' })
                : json(route, 200, list)
        if (url.pathname === '/rest/v1/profiles' && method === 'GET') return rows(caller ? accounts.profileRows(eqId) : [])
        // Чарт и счётчики: читают только вошедшие (в тестах — пусто).
        if (url.pathname === '/rest/v1/play_counts' && method === 'GET') {
            return caller ? json(route, 200, []) : json(route, 401, { code: '42501', message: 'permission denied' })
        }
        if (url.pathname === '/rest/v1/account_private' && method === 'GET') return rows(accounts.privateRows(caller, eqId))
        if (url.pathname === '/rest/v1/profiles' && method === 'PATCH') {
            if (caller && eqId === caller.id) {
                if (typeof body.avatar === 'string') caller.avatar = body.avatar
                if (typeof body.bio === 'string') caller.bio = body.bio
            }
            return json(route, 204, null)
        }

        // ── Storage: свой аватар ──
        if (url.pathname.startsWith('/storage/v1/object/avatars')) {
            if (method === 'POST' || method === 'PUT') {
                const name = decodeURIComponent(url.pathname.slice('/storage/v1/object/avatars/'.length))
                if (!caller || name !== `${caller.id}/avatar`) return json(route, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' })
                accounts.avatarUploads.push(name)
                return json(route, 200, { Key: `avatars/${name}`, Id: name })
            }
            if (method === 'DELETE') {
                accounts.avatarRemovals.push(...((body.prefixes as string[]) ?? []))
                return json(route, 200, [])
            }
        }

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
            const res = options.rpc?.(name, body) ?? accounts.rpc(name, body, caller)
            if (res) return json(route, res.status ?? 200, res.body)
            // Статистика сайта: принимается только от вошедших.
            if (name === 'increment_play_count' || name === 'record_listen_session') {
                return caller ? json(route, 204, null) : json(route, 401, { code: '42501', message: 'Нужно войти' })
            }
        }

        unexpected.push(`${method} ${url.pathname}`)
        return json(route, 404, { message: 'not mocked' })
    })

    return { calls, unexpected, uploads, accounts }
}

/** Вход в админку через форму (ник + пароль). */
export async function loginAs(page: Page, user: { nick: string; password: string }) {
    await page.goto('/admin.html')
    await page.getByLabel('Ник').fill(user.nick)
    await page.getByLabel('Пароль').fill(user.password)
    await page.getByRole('button', { name: 'Войти' }).click()
}
