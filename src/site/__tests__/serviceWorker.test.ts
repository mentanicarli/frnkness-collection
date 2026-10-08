// Service worker (src/sw.js): аудио и PDF мимо него, оболочка из кэша сразу,
// старые кэши (в том числе media-v1 с аудио) удаляются, тексты — сеть первой.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

type Listener = (event: any) => void

class FakeCache {
    store = new Map<string, Response>()
    // Как настоящий Cache: относительный адрес считается от области service worker.
    private key(req: string | Request) {
        return typeof req === 'string' ? new URL(req, 'https://site.test/').href : req.url
    }
    async match(req: string | Request) {
        return this.store.get(this.key(req))?.clone()
    }
    async put(req: string | Request, res: Response) {
        this.store.set(this.key(req), res)
    }
    async add(req: Request) {
        const res = await (globalThis as any).__fetch(req)
        if (!res.ok) throw new Error('bad status')
        this.store.set(req.url, res)
    }
    async keys() {
        return [...this.store.keys()].map((url) => new Request(url))
    }
    async delete(req: Request | string) {
        return this.store.delete(typeof req === 'string' ? req : req.url)
    }
}

class FakeCaches {
    map = new Map<string, FakeCache>()
    async open(name: string) {
        if (!this.map.has(name)) this.map.set(name, new FakeCache())
        return this.map.get(name)!
    }
    async keys() {
        return [...this.map.keys()]
    }
    async delete(name: string) {
        return this.map.delete(name)
    }
    async match(url: string, options?: { cacheName?: string }) {
        const caches = options?.cacheName ? [this.map.get(options.cacheName)].filter(Boolean) : [...this.map.values()]
        for (const c of caches) {
            const hit = await c!.match(url)
            if (hit) return hit
        }
        return undefined
    }
}

const SW_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../sw.js'), 'utf-8')
const ORIGIN = 'https://site.test'

interface Loaded {
    listeners: Record<string, Listener>
    caches: FakeCaches
    fetchMock: ReturnType<typeof vi.fn>
    claimed: () => boolean
    skipped: () => boolean
}

function loadSw(manifest: { url: string; revision: string | null }[], fetchImpl: (req: Request) => Promise<Response>): Loaded {
    const listeners: Record<string, Listener> = {}
    const caches = new FakeCaches()
    const fetchMock = vi.fn(fetchImpl)
    ;(globalThis as any).__fetch = fetchMock
    let claimed = false
    let skipped = false
    const self = {
        __WB_MANIFEST: manifest,
        location: { pathname: '/sw.js', origin: ORIGIN },
        addEventListener: (name: string, fn: Listener) => { listeners[name] = fn },
        skipWaiting: () => { skipped = true },
        clients: { claim: async () => { claimed = true } }
    }
    // В настоящем service worker относительные адреса считаются от его области.
    const ScopedRequest = class extends Request {
        constructor(input: RequestInfo | URL, init?: RequestInit) {
            super(typeof input === 'string' ? new URL(input, `${ORIGIN}/`).href : input, init)
        }
    }
    new Function('self', 'caches', 'fetch', 'Request', SW_SOURCE)(self, caches, fetchMock, ScopedRequest)
    return { listeners, caches, fetchMock, claimed: () => claimed, skipped: () => skipped }
}

function fetchEvent(url: string, init: { mode?: string; headers?: Record<string, string> } = {}) {
    const request = new Request(`${ORIGIN}${url}`, { headers: init.headers })
    Object.defineProperty(request, 'mode', { value: init.mode ?? 'cors' })
    const waits: Promise<unknown>[] = []
    let responded: Promise<Response> | null = null
    return {
        event: {
            request,
            respondWith: (p: Promise<Response>) => { responded = Promise.resolve(p) },
            waitUntil: (p: Promise<unknown>) => { waits.push(p) }
        },
        response: () => responded,
        settle: () => Promise.all(waits)
    }
}

const ok = (body = 'x', type = 'text/plain') => new Response(body, { status: 200, headers: { 'Content-Type': type } })
const MANIFEST = [
    { url: 'index.html', revision: 'r1' },
    { url: 'assets/index-AbCd1234.js', revision: null }
]

beforeEach(() => {
    vi.stubGlobal('self', globalThis)
})
afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('service worker: что он не трогает', () => {
    it('аудио, PDF, Range-запросы и админка идут мимо него', () => {
        const sw = loadSw(MANIFEST, async () => ok())
        for (const [url, init] of [
            ['/audio/album1/track.mp3', {}],
            ['/audio/album1/track.mp3', { headers: { range: 'bytes=0-1' } }],
            ['/lyrics-books/book.pdf', {}],
            ['/admin.html', {}],
            ['/assets/admin-users-AbCd1234.js', {}],
            ['https://other.test/x.js', {}]
        ] as const) {
            const e = fetchEvent(url.startsWith('http') ? new URL(url).pathname : url, init)
            sw.listeners.fetch(e.event)
            expect(e.response(), url).toBeNull()
        }
    })

    it('не-GET и неизвестные файлы не перехватываются', () => {
        const sw = loadSw(MANIFEST, async () => ok())
        const post = fetchEvent('/x')
        Object.defineProperty(post.event.request, 'method', { value: 'POST' })
        sw.listeners.fetch(post.event)
        expect(post.response()).toBeNull()
        const unknown = fetchEvent('/something.bin')
        sw.listeners.fetch(unknown.event)
        expect(unknown.response()).toBeNull()
    })
})

describe('service worker: установка и активация', () => {
    it('предзагрузка в обход HTTP-кэша; сбой одного файла не отменяет остальные', async () => {
        const requests: Request[] = []
        const sw = loadSw(MANIFEST, async (req) => {
            requests.push(req)
            return req.url.endsWith('.js') ? new Response('', { status: 500 }) : ok('<html>')
        })
        let installed: Promise<unknown> = Promise.resolve()
        sw.listeners.install({ waitUntil: (p: Promise<unknown>) => { installed = p } })
        await installed
        expect(sw.skipped()).toBe(true)
        expect(requests.map((r) => r.cache)).toEqual(['reload', 'reload'])
        const names = await sw.caches.keys()
        const staticCache = sw.caches.map.get(names.find((n) => n.startsWith('static-'))!)!
        expect([...staticCache.store.keys()]).toEqual([`${ORIGIN}/index.html`])
    })

    it('при активации удаляются старые кэши и media-v1 с аудио; изображения, тексты и шрифты остаются', async () => {
        const sw = loadSw(MANIFEST, async () => ok())
        for (const name of ['media-v1', 'static-old', 'images-v2', 'lyrics-v2', 'fonts-v1']) await sw.caches.open(name)
        let activated: Promise<unknown> = Promise.resolve()
        sw.listeners.activate({ waitUntil: (p: Promise<unknown>) => { activated = p } })
        await activated
        const left = await sw.caches.keys()
        expect(left).not.toContain('media-v1')
        expect(left).not.toContain('static-old')
        expect(left).toEqual(expect.arrayContaining(['images-v2', 'lyrics-v2', 'fonts-v1']))
        expect(sw.claimed()).toBe(true)
    })

    it('версия кэша зависит от состава и версий файлов сборки', async () => {
        const names = async (manifest: typeof MANIFEST) => {
            const sw = loadSw(manifest, async () => ok())
            let installed: Promise<unknown> = Promise.resolve()
            sw.listeners.install({ waitUntil: (p: Promise<unknown>) => { installed = p } })
            await installed
            return (await sw.caches.keys()).filter((n) => n.startsWith('static-'))[0]
        }
        const a = await names(MANIFEST)
        expect(await names(MANIFEST)).toBe(a)
        expect(await names([{ url: 'index.html', revision: 'r1' }, { url: 'assets/index-ZzZz9999.js', revision: null }])).not.toBe(a)
        expect(await names([{ url: 'index.html', revision: 'r2' }, MANIFEST[1]])).not.toBe(a)
    })
})

describe('service worker: оболочка и файлы', () => {
    it('заход на сайт: оболочка из кэша сразу, без обращения к сети', async () => {
        const sw = loadSw(MANIFEST, async () => ok('<html>shell'))
        let installed: Promise<unknown> = Promise.resolve()
        sw.listeners.install({ waitUntil: (p: Promise<unknown>) => { installed = p } })
        await installed
        sw.fetchMock.mockClear()
        sw.fetchMock.mockImplementation(async () => { throw new Error('сеть не нужна') })
        const e = fetchEvent('/', { mode: 'navigate' })
        sw.listeners.fetch(e.event)
        const res = await e.response()!
        expect(await res.text()).toBe('<html>shell')
        expect(sw.fetchMock).not.toHaveBeenCalled()
    })

    it('страницы превью (/r/…): сеть, а при обрыве — оболочка', async () => {
        const sw = loadSw(MANIFEST, async () => ok('<html>shell'))
        let installed: Promise<unknown> = Promise.resolve()
        sw.listeners.install({ waitUntil: (p: Promise<unknown>) => { installed = p } })
        await installed
        sw.fetchMock.mockImplementation(async () => { throw new Error('offline') })
        const e = fetchEvent('/r/some-release/', { mode: 'navigate' })
        sw.listeners.fetch(e.event)
        expect(await (await e.response()!).text()).toBe('<html>shell')
    })

    it('тексты: сеть первой, но не дольше 4 секунд — потом кэш', async () => {
        vi.useFakeTimers()
        const sw = loadSw(MANIFEST, async () => ok('old'))
        const lyrics = await sw.caches.open('lyrics-v2')
        await lyrics.put(new Request(`${ORIGIN}/lyrics/a/1.txt`), ok('cached'))
        sw.fetchMock.mockImplementation(() => new Promise<Response>(() => undefined))
        const e = fetchEvent('/lyrics/a/1.txt')
        sw.listeners.fetch(e.event)
        const pending = e.response()!
        await vi.advanceTimersByTimeAsync(4100)
        expect(await (await pending).text()).toBe('cached')
    })

    it('тексты: когда сеть отвечает, свежий ответ отдаётся и кладётся в кэш', async () => {
        const sw = loadSw(MANIFEST, async () => ok('fresh'))
        const e = fetchEvent('/lyrics-index.json')
        sw.listeners.fetch(e.event)
        expect(await (await e.response()!).text()).toBe('fresh')
        await e.settle()
        const cached = await (await sw.caches.open('lyrics-v2')).match(`${ORIGIN}/lyrics-index.json`)
        expect(await cached!.text()).toBe('fresh')
    })

    it('файлы сборки с хешем — из кэша, остальное из сети попадает в кэш', async () => {
        const sw = loadSw(MANIFEST, async () => ok('from-network', 'application/javascript'))
        // Кладём в любой static-кэш: имя версии — деталь sw.js.
        let installed: Promise<unknown> = Promise.resolve()
        sw.listeners.install({ waitUntil: (p: Promise<unknown>) => { installed = p } })
        await installed
        const staticName = (await sw.caches.keys()).find((n) => n.startsWith('static-'))!
        await (await sw.caches.open(staticName)).put(new Request(`${ORIGIN}/assets/cached-Zz991234.js`), ok('from-cache'))
        const e = fetchEvent('/assets/cached-Zz991234.js')
        sw.fetchMock.mockClear()
        sw.listeners.fetch(e.event)
        expect(await (await e.response()!).text()).toBe('from-cache')
        expect(sw.fetchMock).not.toHaveBeenCalled()
    })

    it('шрифты — в отдельном кэше fonts-v1', async () => {
        const sw = loadSw(MANIFEST, async () => ok('font', 'font/woff2'))
        const e = fetchEvent('/fonts/golos-text-cyrillic.woff2')
        sw.listeners.fetch(e.event)
        await e.response()
        await e.settle()
        expect((await sw.caches.open('fonts-v1')).store.size).toBe(1)
    })
})
