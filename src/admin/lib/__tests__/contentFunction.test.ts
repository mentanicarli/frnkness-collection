import { describe, it, expect, beforeEach } from 'vitest'
import { createHandler, type AuthUser, type HandlerDeps } from '../../../../supabase/functions/admin-content/handler.ts'
import releasesJson from '@/content/releases.json'

// Фейковый GitHub в памяти: тесты никогда не ходят в сеть и не коммитят.
const REPO = 'mentanicarli/frnkness-collection'
const sha = (n: number) => n.toString(16).padStart(40, '0')
const BASE = sha(1)

interface FakeState {
    head: string
    files: Record<string, string>
    calls: { method: string; path: string; body?: any }[]
    tokenInvalid: boolean
    moveRefOnPatch: boolean
    protectedBranch: boolean
    runs: { status: string; conclusion: string | null; html_url: string }[]
    nextSha: number
    tokenExpiration?: string
}

function createFakeGitHub(state: FakeState): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        const method = init?.method || 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        const path = decodeURIComponent(url.pathname)
        state.calls.push({ method, path, body })
        const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
        if (state.tokenInvalid) return json({ message: 'Bad credentials' }, 401)
        const r = `/repos/${REPO}`
        if (path === r) {
            return new Response(JSON.stringify({ full_name: REPO, default_branch: 'main' }), {
                status: 200,
                headers: state.tokenExpiration ? { 'github-authentication-token-expiration': state.tokenExpiration } : {}
            })
        }
        if (path === `${r}/git/ref/heads/main`) return json({ object: { sha: state.head } })
        if (method === 'GET' && path.startsWith(`${r}/git/commits/`)) return json({ tree: { sha: sha(900) } })
        if (method === 'GET' && path.startsWith(`${r}/git/trees/`)) {
            return json({ truncated: false, tree: Object.keys(state.files).map((p) => ({ path: p, type: 'blob', size: state.files[p].length })) })
        }
        if (path.startsWith(`${r}/contents/`)) {
            const file = path.slice(`${r}/contents/`.length)
            return file in state.files ? new Response(state.files[file]) : json({ message: 'Not Found' }, 404)
        }
        if (method === 'POST' && path === `${r}/git/blobs`) return json({ sha: sha(state.nextSha++) })
        if (method === 'POST' && path === `${r}/git/trees`) return json({ sha: sha(state.nextSha++) })
        if (method === 'POST' && path === `${r}/git/commits`) {
            const s = sha(state.nextSha++)
            return json({ sha: s, html_url: `https://github.com/${REPO}/commit/${s}` })
        }
        if (method === 'PATCH' && path === `${r}/git/refs/heads/main`) {
            if (state.moveRefOnPatch) return json({ message: 'Update is not a fast forward' }, 422)
            if (state.protectedBranch) return json({ message: 'Protected branch update failed for refs/heads/main.' }, 422)
            state.head = body.sha
            return json({ object: { sha: body.sha } })
        }
        if (path.startsWith(`${r}/actions/workflows/deploy-pages.yml/runs`)) return json({ workflow_runs: state.runs })
        return json({ message: 'unexpected ' + method + ' ' + path }, 500)
    }) as typeof fetch
}

const ADMIN: AuthUser = { id: 'u1', email: 'me@example.com', app_metadata: { role: 'admin' } }
const USER: AuthUser = { id: 'u2', email: 'x@example.com', app_metadata: {} }

let state: FakeState
let staging: Map<string, { bytes: Uint8Array; created_at: string }>
let now: number
let handle: (req: Request) => Promise<Response>

function setup() {
    state = {
        head: BASE,
        files: {
            'src/content/releases.json': JSON.stringify(releasesJson, null, 4),
            'src/content/site.json': JSON.stringify({ promo: { enabled: true, releaseId: 'zlaya-nostalgia' } }),
            'lyrics/singles/faaa.txt': 'Строка\n',
            'images/single6-cover.jpg': 'jpeg',
            'lyrics-books/disinvolto-lyrics.pdf': 'pdf'
        },
        calls: [],
        tokenInvalid: false,
        moveRefOnPatch: false,
        protectedBranch: false,
        runs: [],
        nextSha: 100
    }
    staging = new Map()
    now = Date.parse('2026-10-01T12:00:00Z')
    const deps: HandlerDeps = {
        env: { githubToken: 'ghp_test', repo: REPO, branch: 'main', workflow: 'deploy-pages.yml', signingKey: 'k' },
        fetch: createFakeGitHub(state),
        async getUser(jwt) {
            if (jwt === 'admin-jwt') return ADMIN
            if (jwt === 'user-jwt') return USER
            return null
        },
        staging: {
            async download(p) {
                return staging.get(p)?.bytes ?? null
            },
            async remove(paths) {
                paths.forEach((p) => staging.delete(p))
            },
            async list() {
                return [...staging.entries()].map(([name, v]) => ({ name, created_at: v.created_at }))
            }
        },
        toBase64: (bytes) => Buffer.from(bytes).toString('base64'),
        now: () => now
    }
    handle = createHandler(deps)
}

beforeEach(setup)

function call(body: unknown, opts: { jwt?: string | null; origin?: string | null; method?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const jwt = opts.jwt === undefined ? 'admin-jwt' : opts.jwt
    if (jwt) headers.Authorization = `Bearer ${jwt}`
    const origin = opts.origin === undefined ? 'https://frnkness.ru' : opts.origin
    if (origin) headers.Origin = origin
    return handle(
        new Request('https://x.supabase.co/functions/v1/admin-content', {
            method: opts.method || 'POST',
            headers,
            body: opts.method === 'OPTIONS' ? undefined : JSON.stringify(body)
        })
    )
}

const writes = () => state.calls.filter((c) => c.method !== 'GET')
const uuidName = (ext: string) => `123e4567-e89b-12d3-a456-426614174000.${ext}`

describe('admin-content: доступ', () => {
    it('CORS: только frnkness.ru и localhost', async () => {
        const ok = await call(null, { method: 'OPTIONS' })
        expect(ok.status).toBe(204)
        expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://frnkness.ru')

        const local = await call(null, { method: 'OPTIONS', origin: 'http://localhost:5173' })
        expect(local.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')

        const evil = await call({ action: 'ping' }, { origin: 'https://evil.example' })
        expect(evil.status).toBe(403)
        expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull()

        const sub = await call({ action: 'ping' }, { origin: 'https://frnkness.ru.evil.example' })
        expect(sub.status).toBe(403)
    })

    it('без токена — 401, не-админ — 403, GitHub не трогается', async () => {
        expect((await call({ action: 'ping' }, { jwt: null })).status).toBe(401)
        expect((await call({ action: 'ping' }, { jwt: 'garbage' })).status).toBe(401)
        const forbidden = await call({ action: 'head' }, { jwt: 'user-jwt' })
        expect(forbidden.status).toBe(403)
        expect(await forbidden.json()).toMatchObject({ error: 'forbidden' })
        expect(state.calls).toHaveLength(0)
    })

    it('недействительный токен GitHub — понятная ошибка', async () => {
        state.tokenInvalid = true
        const res = await call({ action: 'ping' })
        expect(res.status).toBe(502)
        expect(await res.json()).toMatchObject({
            error: 'github_token_invalid',
            message: 'Токен GitHub недействителен — обнови его в секретах функции'
        })
    })

    it('ping и head', async () => {
        expect(await (await call({ action: 'ping' })).json()).toEqual({ user: { email: 'me@example.com' }, repo: REPO, branch: 'main', tokenExpiresAt: null })
        state.tokenExpiration = '2026-12-31 23:59:59 UTC'
        expect((await (await call({ action: 'ping' })).json()).tokenExpiresAt).toBe('2026-12-31T23:59:59.000Z')
        const head = await (await call({ action: 'head' })).json()
        expect(head.sha).toBe(BASE)
        expect(head.files.map((f: { path: string }) => f.path)).toContain('lyrics/singles/faaa.txt')
    })
})

describe('admin-content: read', () => {
    it('читает текстовые файлы, отсутствующие — null', async () => {
        const res = await call({ action: 'read', ref: BASE, paths: ['lyrics/singles/faaa.txt', 'lyrics/singles/faaa.lrc'] })
        expect(await res.json()).toEqual({ files: { 'lyrics/singles/faaa.txt': 'Строка\n', 'lyrics/singles/faaa.lrc': null } })
    })

    it('не читает пути вне белого списка и бинарные файлы', async () => {
        expect((await call({ action: 'read', ref: BASE, paths: ['.github/workflows/deploy-pages.yml'] })).status).toBe(400)
        expect((await call({ action: 'read', ref: BASE, paths: ['audio/singles/faaa.mp3'] })).status).toBe(400)
    })
})

describe('admin-content: commit', () => {
    it('несколько файлов — один коммит поверх baseSha', async () => {
        const res = await call({
            action: 'commit',
            baseSha: BASE,
            message: 'текст и разборы «FAAA»',
            files: [
                { path: 'lyrics/singles/faaa.txt', content: 'Новая строка\r\n' },
                { path: 'lyrics/singles/faaa.notes.json', content: JSON.stringify({ about: 'x', annotations: [{ line: 'Новая строка', note: 'y' }] }) }
            ]
        })
        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.message).toBe('admin: текст и разборы «FAAA»')
        const w = writes()
        expect(w.map((c) => `${c.method} ${c.path.split('/').slice(-2).join('/')}`)).toEqual([
            'POST git/trees',
            'POST git/commits',
            'PATCH heads/main'
        ])
        expect(w[0].body.base_tree).toBe(sha(900))
        expect(w[0].body.tree).toHaveLength(2)
        expect(w[0].body.tree[0].content).toBe('Новая строка\n')
        expect(w[1].body.parents).toEqual([BASE])
        expect(w[2].body.force).toBe(false)
        expect(state.head).toBe(data.sha)
    })

    it('ветка ушла вперёд — 409 без записи', async () => {
        state.head = sha(2)
        const res = await call({ action: 'commit', baseSha: BASE, message: 'x', files: [{ path: 'lyrics/singles/faaa.txt', content: 'a' }] })
        expect(res.status).toBe(409)
        expect((await res.json()).message).toContain('Обнови страницу')
        expect(writes()).toHaveLength(0)
    })

    it('гонка при обновлении ветки — тоже 409', async () => {
        state.moveRefOnPatch = true
        const res = await call({ action: 'commit', baseSha: BASE, message: 'x', files: [{ path: 'lyrics/singles/faaa.txt', content: 'a' }] })
        expect(res.status).toBe(409)
    })

    it('защищённая ветка — отдельная ошибка, а не «данные изменились»', async () => {
        state.protectedBranch = true
        const res = await call({ action: 'commit', baseSha: BASE, message: 'x', files: [{ path: 'lyrics/singles/faaa.txt', content: 'a' }] })
        expect(res.status).toBe(502)
        expect((await res.json()).error).toBe('github_branch_protected')
    })

    it.each([
        ['.github/workflows/deploy-pages.yml', 'недопустимый сегмент'],
        ['package.json', 'путь вне разрешённых папок'],
        ['src/config.ts', 'путь вне разрешённых папок'],
        ['lyrics/../index.html', 'недопустимый сегмент'],
        ['lyrics/a.js', 'недопустимое расширение']
    ])('отклоняет %s', async (path, reason) => {
        const res = await call({ action: 'commit', baseSha: BASE, message: 'x', files: [{ path, content: 'a' }] })
        expect(res.status).toBe(422)
        expect((await res.json()).details.join()).toContain(reason)
        expect(writes()).toHaveLength(0)
    })

    it('отклоняет битый .notes.json', async () => {
        const res = await call({
            action: 'commit',
            baseSha: BASE,
            message: 'x',
            files: [{ path: 'lyrics/singles/faaa.notes.json', content: '{"annotations": [{"line": ""}]}' }]
        })
        expect(res.status).toBe(422)
        expect((await res.json()).details).toEqual([
            'lyrics/singles/faaa.notes.json: разбор #1: пустая строка',
            'lyrics/singles/faaa.notes.json: разбор #1: пустой текст разбора'
        ])
    })

    it('releases.json: перестановка треков отклоняется', async () => {
        const next = JSON.parse(JSON.stringify(releasesJson))
        next['zlaya-nostalgia'].tracks.reverse()
        const res = await call({ action: 'commit', baseSha: BASE, message: 'x', files: [{ path: 'src/content/releases.json', content: JSON.stringify(next) }] })
        expect(res.status).toBe(422)
        expect((await res.json()).details.join()).toContain('нельзя менять или переставлять')
        expect(writes()).toHaveLength(0)
    })

    it('releases.json: новый релиз и промо на него — одним коммитом', async () => {
        const next = {
            ...JSON.parse(JSON.stringify(releasesJson)),
            'novyy-singl': {
                type: 'single',
                title: 'Новый',
                year: '2026',
                releaseDate: '1 октября 2026',
                cover: 'images/single7-cover.jpg',
                audioPath: 'audio/singles/',
                lyricsPath: 'lyrics/singles/',
                tracks: [{ num: 1, title: 'Новый', file: 'novyy.mp3', lyricsFile: 'novyy.txt' }]
            }
        }
        const res = await call({
            action: 'commit',
            baseSha: BASE,
            message: 'новый сингл',
            files: [
                { path: 'src/content/releases.json', content: JSON.stringify(next, null, 4) },
                { path: 'src/content/site.json', content: JSON.stringify({ promo: { enabled: true, releaseId: 'novyy-singl' } }) },
                { path: 'lyrics/singles/novyy.txt', content: '' }
            ]
        })
        expect(res.status).toBe(200)
    })

    it('site.json: промо на несуществующий релиз отклоняется', async () => {
        const res = await call({
            action: 'commit',
            baseSha: BASE,
            message: 'x',
            files: [{ path: 'src/content/site.json', content: JSON.stringify({ promo: { enabled: true, releaseId: 'nope' } }) }]
        })
        expect(res.status).toBe(422)
    })

    it('медиафайл без загрузки или с поддельной подписью отклоняется', async () => {
        const noBlob = await call({ action: 'commit', baseSha: BASE, message: 'x', files: [{ path: 'images/single7-cover.jpg', content: 'x' }] })
        expect((await noBlob.json()).details).toEqual(['медиафайл нужно сначала загрузить: images/single7-cover.jpg'])

        const forged = await call({
            action: 'commit',
            baseSha: BASE,
            message: 'x',
            files: [{ path: 'images/single7-cover.jpg', blob: { sha: sha(5), size: 10, token: 'f'.repeat(64) } }]
        })
        expect((await forged.json()).details).toEqual(['подпись загрузки не совпадает: images/single7-cover.jpg'])
    })
})

describe('admin-content: правка релиза и удаление заменённых файлов', () => {
    const registry = () => JSON.parse(JSON.stringify(releasesJson))

    async function stagedCover(path: string) {
        staging.set(uuidName('jpg'), { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), created_at: new Date(now).toISOString() })
        return (await call({ action: 'stage-blob', stagingPath: uuidName('jpg'), path })).json()
    }

    it('новая обложка под новым именем, старая удаляется в том же коммите', async () => {
        const blob = await stagedCover('images/single6-cover-20261002.jpg')
        const next = registry()
        next.faaa.cover = 'images/single6-cover-20261002.jpg'
        next.faaa.title = 'FAAA (remaster)'
        const res = await call({
            action: 'commit',
            baseSha: BASE,
            message: 'релиз «FAAA»: название, обложка',
            files: [
                { path: 'src/content/releases.json', content: JSON.stringify(next, null, 4) },
                { path: 'images/single6-cover-20261002.jpg', blob: { sha: blob.sha, size: blob.size, token: blob.token } },
                { path: 'images/single6-cover.jpg', delete: true }
            ]
        })
        expect(res.status).toBe(200)
        const tree = state.calls.find((c) => c.method === 'POST' && c.path.endsWith('/git/trees'))!.body.tree
        expect(tree).toContainEqual({ path: 'images/single6-cover.jpg', mode: '100644', type: 'blob', sha: null })
        expect(tree).toContainEqual({ path: 'images/single6-cover-20261002.jpg', mode: '100644', type: 'blob', sha: blob.sha })
    })

    it('убрать PDF и удалить файл', async () => {
        const next = registry()
        delete next.disinvolto.lyricsBookPath
        const res = await call({
            action: 'commit',
            baseSha: BASE,
            message: 'x',
            files: [
                { path: 'src/content/releases.json', content: JSON.stringify(next) },
                { path: 'lyrics-books/disinvolto-lyrics.pdf', delete: true }
            ]
        })
        expect(res.status).toBe(200)
    })

    it('удалить используемую обложку, mp3 или текст — нельзя', async () => {
        const res = await call({
            action: 'commit',
            baseSha: BASE,
            message: 'x',
            files: [
                { path: 'images/single6-cover.jpg', delete: true },
                { path: 'audio/singles/faaa.mp3', delete: true },
                { path: 'lyrics/singles/faaa.txt', delete: true }
            ]
        })
        expect(res.status).toBe(422)
        expect((await res.json()).details).toEqual([
            'файл ещё используется, удалять нельзя: images/single6-cover.jpg',
            'удалять можно только заменяемую обложку или PDF: audio/singles/faaa.mp3',
            'удалять можно только заменяемую обложку или PDF: lyrics/singles/faaa.txt'
        ])
        expect(writes()).toHaveLength(0)
    })

    it('правка треков существующего релиза по-прежнему отклоняется', async () => {
        const next = registry()
        next.faaa.tracks[0].file = 'other.mp3'
        const res = await call({ action: 'commit', baseSha: BASE, message: 'x', files: [{ path: 'src/content/releases.json', content: JSON.stringify(next) }] })
        expect(res.status).toBe(422)
        expect((await res.json()).details.join()).toContain('трек 1 нельзя менять')
    })

    it('id менять нельзя', async () => {
        const next = registry()
        next['faaa-renamed'] = next.faaa
        delete next.faaa
        const res = await call({ action: 'commit', baseSha: BASE, message: 'x', files: [{ path: 'src/content/releases.json', content: JSON.stringify(next) }] })
        expect((await res.json()).details.join()).toContain('«faaa» нельзя удалить или переименовать')
    })
})

describe('admin-content: анонс в site.json', () => {
    const announce = { enabled: true, title: 'Скоро', cover: 'images/announce-skoro-20261002.jpg', releaseAt: '2026-11-01T18:00:00+03:00' }

    it('новая обложка в том же коммите — ок', async () => {
        staging.set(uuidName('jpg'), { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), created_at: new Date(now).toISOString() })
        const blob = await (await call({ action: 'stage-blob', stagingPath: uuidName('jpg'), path: announce.cover })).json()
        const res = await call({
            action: 'commit',
            baseSha: BASE,
            message: 'анонс',
            files: [
                { path: 'src/content/site.json', content: JSON.stringify({ promo: { enabled: true, releaseId: 'zlaya-nostalgia' }, announce }) },
                { path: announce.cover, blob: { sha: blob.sha, size: blob.size, token: blob.token } }
            ]
        })
        expect(res.status).toBe(200)
    })

    it('ссылка на несуществующую обложку — отказ', async () => {
        const res = await call({
            action: 'commit',
            baseSha: BASE,
            message: 'анонс',
            files: [{ path: 'src/content/site.json', content: JSON.stringify({ promo: { enabled: true, releaseId: 'zlaya-nostalgia' }, announce }) }]
        })
        expect(res.status).toBe(422)
        expect((await res.json()).details).toEqual(['обложка анонса не найдена: images/announce-skoro-20261002.jpg'])
    })
})

describe('admin-content: stage-blob', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

    it('создаёт blob, удаляет staging и подписывает результат для коммита', async () => {
        staging.set(uuidName('jpg'), { bytes: jpeg, created_at: new Date(now).toISOString() })
        const res = await call({ action: 'stage-blob', stagingPath: uuidName('jpg'), path: 'images/single7-cover.jpg' })
        expect(res.status).toBe(200)
        const blob = await res.json()
        expect(blob.size).toBe(jpeg.length)
        expect(staging.size).toBe(0)
        const blobCall = state.calls.find((c) => c.path.endsWith('/git/blobs'))!
        expect(blobCall.body).toEqual({ content: Buffer.from(jpeg).toString('base64'), encoding: 'base64' })

        const commit = await call({
            action: 'commit',
            baseSha: BASE,
            message: 'обложка',
            files: [{ path: 'images/single7-cover.jpg', blob: { sha: blob.sha, size: blob.size, token: blob.token } }]
        })
        expect(commit.status).toBe(200)

        // Подпись привязана к пути: тот же blob под другим именем не пройдёт.
        const moved = await call({
            action: 'commit',
            baseSha: state.head,
            message: 'x',
            files: [{ path: 'images/other.jpg', blob: { sha: blob.sha, size: blob.size, token: blob.token } }]
        })
        expect(moved.status).toBe(422)
    })

    it('содержимое не совпадает с расширением — отказ, staging всё равно удалён', async () => {
        staging.set(uuidName('mp3'), { bytes: new Uint8Array([0x3c, 0x68, 0x74, 0x6d]), created_at: new Date(now).toISOString() })
        const res = await call({ action: 'stage-blob', stagingPath: uuidName('mp3'), path: 'audio/singles/x.mp3' })
        expect(res.status).toBe(422)
        expect(staging.size).toBe(0)
        expect(writes()).toHaveLength(0)
    })

    it('путь вне белого списка — отказ, staging удалён', async () => {
        staging.set(uuidName('pdf'), { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), created_at: new Date(now).toISOString() })
        const res = await call({ action: 'stage-blob', stagingPath: uuidName('pdf'), path: 'public/x.pdf' })
        expect(res.status).toBe(400)
        expect(staging.size).toBe(0)
    })

    it('отклоняет подозрительное имя staging-файла', async () => {
        expect((await call({ action: 'stage-blob', stagingPath: '../secret', path: 'images/a.jpg' })).status).toBe(400)
    })

    it('при запуске удаляет staging-файлы старше суток', async () => {
        staging.set('old.mp3', { bytes: jpeg, created_at: new Date(now - 25 * 3600 * 1000).toISOString() })
        staging.set('fresh.mp3', { bytes: jpeg, created_at: new Date(now - 3600 * 1000).toISOString() })
        await call({ action: 'ping' })
        expect([...staging.keys()]).toEqual(['fresh.mp3'])
    })
})

describe('admin-content: deploy-status', () => {
    it.each([
        [[], 'pending'],
        [[{ status: 'in_progress', conclusion: null, html_url: 'u' }], 'pending'],
        [[{ status: 'completed', conclusion: 'success', html_url: 'u' }], 'published'],
        [[{ status: 'completed', conclusion: 'failure', html_url: 'https://github.com/run/1' }], 'failed'],
        [[{ status: 'completed', conclusion: 'cancelled', html_url: 'u' }], 'cancelled']
    ])('%j → %s', async (runs, expected) => {
        state.runs = runs as FakeState['runs']
        const data = await (await call({ action: 'deploy-status', sha: BASE })).json()
        expect(data.state).toBe(expected)
        if (expected === 'failed') expect(data.url).toBe('https://github.com/run/1')
    })
})
