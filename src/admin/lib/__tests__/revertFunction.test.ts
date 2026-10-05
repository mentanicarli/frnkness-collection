import { describe, it, expect, beforeEach } from 'vitest'
import { createHandler } from '../../../../supabase/functions/admin-content/handler.ts'
import { fixtureReleases } from '../../../../tests/fixtures/catalog'

const releasesJson = fixtureReleases()

/**
 * Мини-модель git в памяти: коммиты со снимками файлов и те эндпоинты
 * GitHub, которые нужны истории и откату. Сеть не используется.
 */
const REPO = 'mentanicarli/frnkness-collection'

interface Snapshot {
    sha: string
    parent: string | null
    message: string
    files: Record<string, string>
}

function blobSha(content: string): string {
    let h = 2166136261
    for (let i = 0; i < content.length; i++) h = Math.imul(h ^ content.charCodeAt(i), 16777619) >>> 0
    return h.toString(16).padStart(40, 'b')
}

let commits: Snapshot[]
let head: string
let writes: { method: string; path: string; body: any }[]
let plays: Record<string, number>
let seq = 0

function commitSha() {
    return (++seq).toString(16).padStart(40, 'c')
}

function addCommit(message: string, change: (files: Record<string, string>) => void) {
    const prev = commits.find((c) => c.sha === head)!
    const files = { ...prev.files }
    change(files)
    const snap = { sha: commitSha(), parent: prev.sha, message, files }
    commits.push(snap)
    head = snap.sha
    return snap.sha
}

function diff(a: Record<string, string>, b: Record<string, string>) {
    const out: { filename: string; status: string }[] = []
    for (const p of Object.keys(b)) {
        if (!(p in a)) out.push({ filename: p, status: 'added' })
        else if (a[p] !== b[p]) out.push({ filename: p, status: 'modified' })
    }
    for (const p of Object.keys(a)) if (!(p in b)) out.push({ filename: p, status: 'removed' })
    return out
}

const snap = (sha: string) => commits.find((c) => c.sha === sha)!

function ghCommit(c: Snapshot) {
    return {
        sha: c.sha,
        commit: { message: c.message, author: { name: 'Max', date: '2026-10-02T10:00:00Z' }, committer: { date: '2026-10-02T10:00:00Z' } },
        parents: c.parent ? [{ sha: c.parent }] : [],
        files: diff(c.parent ? snap(c.parent).files : {}, c.files)
    }
}

const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method || 'GET'
    const path = decodeURIComponent(url.pathname)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
    const r = `/repos/${REPO}`
    if (method !== 'GET') writes.push({ method, path, body })
    if (path === `${r}/git/ref/heads/main`) return json({ object: { sha: head } })
    if (path === `${r}/commits` && method === 'GET') {
        const list: Snapshot[] = []
        for (let c: Snapshot | undefined = snap(head); c; c = c.parent ? snap(c.parent) : undefined) list.push(c)
        return json(list.slice(0, Number(url.searchParams.get('per_page') || 30)).map((c) => ({ sha: c.sha, commit: { message: c.message } })))
    }
    if (path.startsWith(`${r}/commits/`)) return json(ghCommit(snap(path.split('/').pop()!)))
    if (path.startsWith(`${r}/compare/`)) {
        const [base, to] = path.slice(`${r}/compare/`.length).split('...')
        const chain: Snapshot[] = []
        for (let c: Snapshot | undefined = snap(to); c && c.sha !== base; c = c.parent ? snap(c.parent) : undefined) chain.unshift(c)
        return json({ commits: chain.map((c) => ({ sha: c.sha, commit: { message: c.message } })), files: diff(snap(base).files, snap(to).files) })
    }
    if (method === 'GET' && path.startsWith(`${r}/git/commits/`)) return json({ tree: { sha: 'tree-' + path.split('/').pop() } })
    if (method === 'GET' && path.startsWith(`${r}/git/trees/tree-`)) {
        const files = snap(path.split('tree-')[1]).files
        return json({ tree: Object.entries(files).map(([p, c]) => ({ path: p, type: 'blob', mode: '100644', sha: blobSha(c) })) })
    }
    if (path.startsWith(`${r}/contents/`)) {
        const file = path.slice(`${r}/contents/`.length)
        const files = snap(url.searchParams.get('ref')!).files
        return file in files ? new Response(files[file]) : json({ message: 'Not Found' }, 404)
    }
    if (method === 'POST' && path === `${r}/git/trees`) return json({ sha: 'newtree'.padEnd(40, '0') })
    if (method === 'POST' && path === `${r}/git/commits`) return json({ sha: 'f'.repeat(40), html_url: 'u' })
    if (method === 'PATCH') return json({ object: { sha: body.sha } })
    return json({ message: 'unexpected ' + method + ' ' + path }, 500)
}) as typeof fetch

const handle = () =>
    createHandler({
        env: { githubToken: 't', repo: REPO, branch: 'main', workflow: 'deploy-pages.yml', signingKey: 'k' },
        fetch: fakeFetch,
        getUser: async () => ({ id: 'a', app_metadata: { role: 'admin' } }),
        staging: { download: async () => null, remove: async () => undefined, list: async () => [] },
        toBase64: () => '',
        now: () => 0,
        playsFor: async (ids) => Object.fromEntries(ids.map((id) => [id, plays[id] ?? 0]))
    })

async function call(body: object) {
    const res = await handle()(
        new Request('https://x/functions/v1/admin-content', {
            method: 'POST',
            headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
    )
    return { status: res.status, data: await res.json() }
}

const REG = JSON.stringify(releasesJson, null, 4)
const SITE = JSON.stringify({ promo: { enabled: true, releaseId: 'zlaya-nostalgia' } })

beforeEach(() => {
    seq = 0
    const root = { sha: commitSha(), parent: null, message: 'init', files: { 'src/content/releases.json': REG, 'src/content/site.json': SITE, 'lyrics/singles/faaa.txt': 'старый текст\n', 'images/single6-cover.jpg': 'JPEG-OLD' } }
    commits = [root]
    head = root.sha
    writes = []
    plays = {}
})

describe('история', () => {
    it('последние коммиты: сообщение, источник, файлы', async () => {
        addCommit('feat: код сайта', (f) => (f['lyrics/singles/faaa.txt'] += ''))
        addCommit('admin: текст «FAAA» (FAAA)', (f) => (f['lyrics/singles/faaa.txt'] = 'новый текст\n'))
        const { data } = await call({ action: 'history' })
        expect(data.head).toBe(head)
        expect(data.commits[0]).toMatchObject({ message: 'admin: текст «FAAA» (FAAA)', source: 'admin', files: [{ path: 'lyrics/singles/faaa.txt', status: 'modified' }] })
        expect(data.commits[1]).toMatchObject({ message: 'feat: код сайта', source: 'code' })
    })
})

describe('откат', () => {
    it('правка текста: файл возвращается к blob родителя, сообщение «admin: откат …»', async () => {
        const edit = addCommit('admin: текст «FAAA» (FAAA)', (f) => (f['lyrics/singles/faaa.txt'] = 'новый текст\n'))
        const preview = await call({ action: 'revert-preview', sha: edit })
        expect(preview.data).toMatchObject({ ok: true, files: [{ path: 'lyrics/singles/faaa.txt', action: 'restore' }], revertMessage: 'admin: откат «текст «FAAA» (FAAA)»' })
        const res = await call({ action: 'revert', sha: edit, baseSha: head })
        expect(res.status).toBe(200)
        const tree = writes.find((w) => w.path.endsWith('/git/trees'))!.body
        expect(tree.tree).toEqual([{ path: 'lyrics/singles/faaa.txt', mode: '100644', type: 'blob', sha: blobSha('старый текст\n') }])
        expect(writes.find((w) => w.path.endsWith('/git/commits'))!.body.message).toBe('admin: откат «текст «FAAA» (FAAA)»')
    })

    it('замена обложки: новый файл удаляется, старый восстанавливается без загрузки', async () => {
        const reg = JSON.parse(REG)
        reg.faaa.cover = 'images/single6-cover-20261002.jpg'
        const edit = addCommit('admin: релиз «FAAA»: обложка', (f) => {
            f['src/content/releases.json'] = JSON.stringify(reg, null, 4)
            f['images/single6-cover-20261002.jpg'] = 'JPEG-NEW'
            delete f['images/single6-cover.jpg']
        })
        const { data } = await call({ action: 'revert-preview', sha: edit })
        expect(data.ok).toBe(true)
        expect(data.files).toEqual([
            { path: 'src/content/releases.json', action: 'restore' },
            { path: 'images/single6-cover-20261002.jpg', action: 'delete' },
            { path: 'images/single6-cover.jpg', action: 'recreate' }
        ])
        await call({ action: 'revert', sha: edit, baseSha: head })
        const entries = writes.find((w) => w.path.endsWith('/git/trees'))!.body.tree
        expect(entries).toContainEqual({ path: 'images/single6-cover.jpg', mode: '100644', type: 'blob', sha: blobSha('JPEG-OLD') })
        expect(entries).toContainEqual({ path: 'images/single6-cover-20261002.jpg', mode: '100644', type: 'blob', sha: null })
    })

    it('файл менялся позже — отказ с указанием коммита', async () => {
        const edit = addCommit('admin: текст «FAAA» (FAAA)', (f) => (f['lyrics/singles/faaa.txt'] = 'v2\n'))
        const later = addCommit('admin: текст «FAAA» ещё раз', (f) => (f['lyrics/singles/faaa.txt'] = 'v3\n'))
        const { data } = await call({ action: 'revert-preview', sha: edit })
        expect(data.ok).toBe(false)
        expect(data.conflicts).toEqual([{ path: 'lyrics/singles/faaa.txt', commits: [{ sha: later, message: 'admin: текст «FAAA» ещё раз' }] }])
        const res = await call({ action: 'revert', sha: edit, baseSha: head })
        expect(res.status).toBe(422)
        expect(res.data.details).toEqual(['lyrics/singles/faaa.txt позже менялся: «admin: текст «FAAA» ещё раз»'])
        expect(writes).toEqual([])
    })

    it('более поздняя правка других файлов не мешает', async () => {
        const edit = addCommit('admin: текст «FAAA» (FAAA)', (f) => (f['lyrics/singles/faaa.txt'] = 'v2\n'))
        addCommit('admin: промо', (f) => (f['src/content/site.json'] = JSON.stringify({ promo: { enabled: false, releaseId: 'faaa' } })))
        expect((await call({ action: 'revert-preview', sha: edit })).data.ok).toBe(true)
    })

    it('коммит из кода — откат недоступен', async () => {
        const code = addCommit('fix: что-то', (f) => (f['lyrics/singles/faaa.txt'] = 'x\n'))
        const { data } = await call({ action: 'revert-preview', sha: code })
        expect(data.blocked).toEqual(['Откатить можно только правку из админки'])
    })

    it('новый релиз: откат только при 0 прослушиваний', async () => {
        const reg = JSON.parse(REG)
        reg['novyy-singl'] = { ...reg.faaa, title: 'Новый', cover: 'images/single7-cover.jpg', tracks: [{ num: 1, title: 'Новый', file: 'novyy-singl.mp3', lyricsFile: 'novyy-singl.txt' }] }
        const add = addCommit('admin: новый сингл «Новый»', (f) => {
            f['src/content/releases.json'] = JSON.stringify(reg, null, 4)
            f['images/single7-cover.jpg'] = 'JPEG'
            f['audio/singles/novyy-singl.mp3'] = 'MP3'
            f['lyrics/singles/novyy-singl.txt'] = ''
        })
        plays = { 'novyy-singl': 3 }
        const blocked = await call({ action: 'revert-preview', sha: add })
        expect(blocked.data.ok).toBe(false)
        expect(blocked.data.blocked[0]).toContain('у которого уже 3 прослушиваний')

        plays = { 'novyy-singl': 0 }
        const ok = await call({ action: 'revert-preview', sha: add })
        expect(ok.data.ok).toBe(true)
        expect(ok.data.files.filter((f: { action: string }) => f.action === 'delete').map((f: { path: string }) => f.path).sort()).toEqual([
            'audio/singles/novyy-singl.mp3',
            'images/single7-cover.jpg',
            'lyrics/singles/novyy-singl.txt'
        ])
    })

    it('ветка ушла вперёд после просмотра — 409', async () => {
        const edit = addCommit('admin: текст «FAAA» (FAAA)', (f) => (f['lyrics/singles/faaa.txt'] = 'v2\n'))
        const seen = head
        addCommit('admin: промо', (f) => (f['src/content/site.json'] = SITE + ' '))
        const res = await call({ action: 'revert', sha: edit, baseSha: seen })
        expect(res.status).toBe(409)
    })
})
