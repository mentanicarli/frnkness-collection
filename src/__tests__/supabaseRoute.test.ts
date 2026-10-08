import { describe, it, expect, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
    PROXY_ERROR_HEADER,
    PROXY_MARK_HEADER,
    ROUTE_STORAGE_KEY,
    createRouter,
    markSafeRpc,
    normalizeBase,
    type RouteName
} from '../supabaseRoute'

const DIRECT = 'https://abc.supabase.co'
const PROXY = 'https://proxy.example.workers.dev'

interface Call {
    route: RouteName
    url: string
    method: string
}

type Handler = (call: Call, init: RequestInit) => Response | Promise<Response>

const ok = (body = '{"ok":true}', headers: Record<string, string> = {}) => new Response(body, { status: 200, headers })
const marked = (body = '{"ok":true}') => ok(body, { [PROXY_MARK_HEADER]: '1' })
const dead: Handler = () => Promise.reject(new TypeError('Failed to fetch'))
const hang: Handler = () => new Promise<Response>(() => undefined)

/** Сеть из двух маршрутов: каждый отвечает по-своему; все обращения пишутся в calls. */
function makeNet(handlers: { proxy: Handler; direct: Handler }) {
    const calls: Call[] = []
    const fetchImpl = (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input)
        const route: RouteName = url.startsWith(PROXY) ? 'proxy' : 'direct'
        const call: Call = { route, url, method: (init.method || 'GET').toUpperCase() }
        calls.push(call)
        return new Promise<Response>((resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
            Promise.resolve()
                .then(() => handlers[route](call, init))
                .then(resolve, reject)
        })
    }
    const to = (route: RouteName, pathPart = '') => calls.filter((c) => c.route === route && c.url.includes(pathPart))
    return { calls, fetchImpl, to }
}

function memoryStorage(initial?: Record<string, string>) {
    const data = new Map(Object.entries(initial ?? {}))
    return {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v)
    }
}

function setup(handlers: { proxy: Handler; direct: Handler }, extra: { storage?: ReturnType<typeof memoryStorage>; now?: () => number } = {}) {
    const net = makeNet(handlers)
    const storage = extra.storage ?? memoryStorage()
    const router = createRouter({
        directUrl: DIRECT,
        proxyUrl: PROXY,
        fetchImpl: net.fetchImpl,
        storage,
        timeoutMs: 40,
        lastResortTimeoutMs: 200,
        freshMs: 60_000,
        log: () => undefined,
        ...(extra.now ? { now: extra.now } : {})
    })
    return { ...net, router, storage }
}

const READ = `${DIRECT}/rest/v1/play_counts?select=plays`
const rpcUrl = (name: string) => `${DIRECT}/rest/v1/rpc/${name}`
const post = (body: unknown = {}): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

describe('normalizeBase', () => {
    it('адрес приводится к виду без хвостового слэша', () => {
        expect(normalizeBase('https://a.workers.dev/')).toBe('https://a.workers.dev')
        expect(normalizeBase('  https://a.example.com/supa/ ')).toBe('https://a.example.com/supa')
    })
    it('пустое, не https и мусор — пустая строка', () => {
        expect(normalizeBase('')).toBe('')
        expect(normalizeBase(undefined)).toBe('')
        expect(normalizeBase('http://a.example.com')).toBe('')
        expect(normalizeBase('not a url')).toBe('')
        expect(normalizeBase('https://u:p@a.example.com')).toBe('')
    })
    it('http разрешён только для localhost', () => {
        expect(normalizeBase('http://localhost:8787')).toBe('http://localhost:8787')
    })
})

describe('без посредника', () => {
    it('ничего не меняется: fetch как есть, ссылки как есть, WebSocket тот же', async () => {
        const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ok())
        const router = createRouter({ directUrl: DIRECT, proxyUrl: '', fetchImpl, storage: null })
        expect(router.enabled).toBe(false)
        await router.fetch(READ, { method: 'GET' })
        expect(fetchImpl).toHaveBeenCalledTimes(1)
        expect(fetchImpl.mock.calls[0][0]).toBe(READ)
        expect(router.toActiveUrl(`${DIRECT}/storage/v1/x`)).toBe(`${DIRECT}/storage/v1/x`)
        class Base {}
        expect(router.webSocket(Base as never)).toBe(Base)
        expect(router.baseUrl()).toBe(DIRECT)
    })

    it('невалидный адрес посредника — то же, что пустой', () => {
        expect(createRouter({ directUrl: DIRECT, proxyUrl: 'http://evil.example.com', storage: null }).enabled).toBe(false)
        expect(createRouter({ directUrl: DIRECT, proxyUrl: DIRECT, storage: null }).enabled).toBe(false)
    })
})

describe('маршрут по умолчанию', () => {
    it('запрос к Supabase идёт на посредника с тем же путём и параметрами', async () => {
        const { router, to } = setup({ proxy: () => marked(), direct: dead })
        const res = await router.fetch(READ)
        expect(res.status).toBe(200)
        expect(to('proxy')[0].url).toBe(`${PROXY}/rest/v1/play_counts?select=plays`)
        expect(to('direct')).toHaveLength(0)
    })

    it('чужие адреса не трогаются', async () => {
        const { router, calls } = setup({ proxy: dead, direct: () => ok() })
        await router.fetch('https://challenges.cloudflare.com/x')
        expect(calls[0].url).toBe('https://challenges.cloudflare.com/x')
    })

    it('адрес-соседа с тем же началом не принимается за Supabase', async () => {
        const { router, calls } = setup({ proxy: dead, direct: () => ok() })
        await router.fetch('https://abc.supabase.co.evil.example/x')
        expect(calls[0].url).toBe('https://abc.supabase.co.evil.example/x')
    })

    it('Request как вход: адрес и тело переносятся', async () => {
        const { router, to } = setup({ proxy: () => marked(), direct: dead })
        await router.fetch(new Request(rpcUrl('friends_feed'), { method: 'POST', body: '{"a":1}' }))
        expect(to('proxy', '/rpc/friends_feed')).toHaveLength(1)
    })
})

describe('запасной путь для чтения', () => {
    it('посредник отвалился (ошибка сети): тот же запрос уходит напрямую и маршрут запоминается', async () => {
        const { router, to, storage } = setup({ proxy: dead, direct: () => ok('{"d":1}') })
        const res = await router.fetch(READ)
        expect(await res.json()).toEqual({ d: 1 })
        expect(to('proxy')).toHaveLength(1)
        expect(to('direct')).toHaveLength(1)
        expect(router.route()).toBe('direct')
        expect(JSON.parse(storage.getItem(ROUTE_STORAGE_KEY)!)).toMatchObject({ p: PROXY, http: 'direct' })
        // Следующие запросы сразу напрямую, посредника больше не трогаем.
        await router.fetch(READ)
        expect(to('proxy')).toHaveLength(1)
        expect(to('direct')).toHaveLength(2)
    })

    it('посредник завис (нет ответа за таймаут)', async () => {
        const { router, to } = setup({ proxy: hang, direct: () => ok() })
        const res = await router.fetch(READ)
        expect(res.ok).toBe(true)
        expect(router.route()).toBe('direct')
        expect(to('direct')).toHaveLength(1)
    })

    it('заголовки пришли, а тело зависло посреди ответа', async () => {
        const stalled: Handler = (_c, init) =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('{"par'))
                        init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')))
                    }
                }),
                { status: 200, headers: { [PROXY_MARK_HEADER]: '1' } }
            )
        const { router, to } = setup({ proxy: stalled, direct: () => ok('{"full":true}') })
        const res = await router.fetch(READ)
        expect(await res.json()).toEqual({ full: true })
        expect(to('direct')).toHaveLength(1)
        expect(router.route()).toBe('direct')
    })

    it('тело читается целиком и отдаётся как обычный ответ (статус и заголовки сохраняются)', async () => {
        const { router } = setup({
            proxy: () => new Response('abc', { status: 206, headers: { 'content-range': '0-2/10', [PROXY_MARK_HEADER]: '1' } }),
            direct: dead
        })
        const res = await router.fetch(READ)
        expect(res.status).toBe(206)
        expect(res.headers.get('content-range')).toBe('0-2/10')
        expect(await res.text()).toBe('abc')
    })

    it('ответ 5xx не от посредника (страница Cloudflare, лимит) — повторяем напрямую', async () => {
        const { router, to } = setup({ proxy: () => new Response('limit', { status: 503 }), direct: () => ok() })
        expect((await router.fetch(READ)).status).toBe(200)
        expect(to('direct')).toHaveLength(1)
        expect(router.route()).toBe('direct')
    })

    it('ошибка самого Worker (метка x-frnk-proxy-error) — повторяем напрямую', async () => {
        const { router, to } = setup({
            proxy: () => new Response('{}', { status: 502, headers: { [PROXY_MARK_HEADER]: '1', [PROXY_ERROR_HEADER]: 'upstream-unreachable' } }),
            direct: () => ok()
        })
        expect((await router.fetch(READ)).status).toBe(200)
        expect(to('direct')).toHaveLength(1)
    })

    it('честная 5xx от Supabase через посредника (есть метка) отдаётся как есть, без повтора', async () => {
        const { router, to } = setup({ proxy: () => new Response('{"e":1}', { status: 500, headers: { [PROXY_MARK_HEADER]: '1' } }), direct: () => ok() })
        expect((await router.fetch(READ)).status).toBe(500)
        expect(to('direct')).toHaveLength(0)
        expect(router.route()).toBe('proxy')
    })

    it('4xx не повод для запасного пути', async () => {
        const { router, to } = setup({ proxy: () => new Response('{}', { status: 401, headers: { [PROXY_MARK_HEADER]: '1' } }), direct: () => ok() })
        expect((await router.fetch(READ)).status).toBe(401)
        expect(to('direct')).toHaveLength(0)
    })

    it('и наоборот: рабочий маршрут напрямую упал — пробуем посредника', async () => {
        const storage = memoryStorage({ [ROUTE_STORAGE_KEY]: JSON.stringify({ p: PROXY, http: 'direct' }) })
        const { router, to } = setup({ proxy: () => marked(), direct: dead }, { storage })
        expect(router.route()).toBe('direct')
        expect((await router.fetch(READ)).status).toBe(200)
        expect(to('direct')).toHaveLength(1)
        expect(to('proxy')).toHaveLength(1)
        expect(router.route()).toBe('proxy')
    })

    it('не работает ни то, ни другое: ошибка первого маршрута, выбор не меняется', async () => {
        const { router } = setup({ proxy: dead, direct: dead })
        await expect(router.fetch(READ)).rejects.toThrow('Failed to fetch')
        expect(router.route()).toBe('proxy')
    })

    it('отмена запроса вызывающим кодом не запускает запасной путь', async () => {
        const { router, to } = setup({ proxy: hang, direct: () => ok() })
        const ctrl = new AbortController()
        const p = router.fetch(READ, { signal: ctrl.signal })
        ctrl.abort()
        await expect(p).rejects.toBeTruthy()
        expect(to('direct')).toHaveLength(0)
    })

    it('RPC только для чтения повторяется, запись — нет', async () => {
        const { router, to } = setup({ proxy: dead, direct: () => ok() })
        await router.fetch(rpcUrl('friends_feed'), post())
        expect(to('proxy', '/rpc/friends_feed')).toHaveLength(1)
        expect(to('direct', '/rpc/friends_feed')).toHaveLength(1)
    })

    it('явная пометка idempotent включает повтор для POST', async () => {
        const { router, to } = setup({ proxy: dead, direct: () => ok() })
        await router.fetch(`${DIRECT}/functions/v1/admin-users`, post(), { idempotent: true })
        expect(to('direct', '/functions/v1/admin-users')).toHaveLength(1)
    })

    it('markSafeRpc добавляет чтение, о котором основной код не знает (админка)', async () => {
        const healthyThenDead: Handler = (call) => (call.url.includes('/auth/v1/health') ? marked() : Promise.reject(new TypeError('Failed to fetch')))
        const before = setup({ proxy: healthyThenDead, direct: () => ok() })
        await expect(before.router.fetch(rpcUrl('only_in_test_reader'), post())).rejects.toThrow()
        expect(before.to('direct', 'only_in_test_reader')).toHaveLength(0)
        markSafeRpc(['only_in_test_reader'])
        const after = setup({ proxy: healthyThenDead, direct: () => ok() })
        await after.router.fetch(rpcUrl('only_in_test_reader'), post())
        expect(after.to('direct', 'only_in_test_reader')).toHaveLength(1)
    })

    it('сессия прослушивания (upsert по id) — безопасный повтор', async () => {
        const { router, to } = setup({ proxy: dead, direct: () => ok() })
        await router.fetch(rpcUrl('record_listen_session'), post())
        expect(to('direct', 'record_listen_session')).toHaveLength(1)
    })
})

describe('запросы, меняющие данные, не дублируются', () => {
    it('increment_play_count: посредник принял соединение и оборвался — один запрос, повтора напрямую нет', async () => {
        // Первая проверка связи проходит, сам запрос обрывается: мог дойти до базы.
        const proxy: Handler = (call) => (call.url.includes('/auth/v1/health') ? marked() : Promise.reject(new TypeError('Failed to fetch')))
        const { router, to } = setup({ proxy, direct: () => ok() })
        await expect(router.fetch(rpcUrl('increment_play_count'), post({ track_key_input: 'r-0' }))).rejects.toThrow()
        expect(to('proxy', '/rpc/increment_play_count')).toHaveLength(1)
        expect(to('direct', '/rpc/increment_play_count')).toHaveLength(0)
        expect(router.route()).toBe('proxy')
    })

    it('то же при зависании: изменяющий запрос не обрывается по таймауту и не повторяется', async () => {
        let release: (r: Response) => void = () => undefined
        const proxy: Handler = (call) => (call.url.includes('/auth/v1/health') ? marked() : new Promise<Response>((r) => (release = r)))
        const { router, to } = setup({ proxy, direct: () => ok() })
        const p = router.fetch(rpcUrl('increment_play_count'), post())
        await new Promise((r) => setTimeout(r, 150)) // втрое дольше таймаута чтения
        release(marked('{"counted":true}'))
        expect((await p).status).toBe(200)
        expect(to('direct', '/rpc/increment_play_count')).toHaveLength(0)
        expect(to('proxy', '/rpc/increment_play_count')).toHaveLength(1)
    })

    it('посредник мёртв ещё до отправки: проверка связи это ловит, запрос уходит напрямую ровно один раз', async () => {
        const { router, to } = setup({ proxy: dead, direct: () => ok() })
        const res = await router.fetch(`${DIRECT}/functions/v1/register`, post({ nick: 'a' }))
        expect(res.status).toBe(200)
        expect(to('proxy', '/functions/v1/register')).toHaveLength(0)
        expect(to('direct', '/functions/v1/register')).toHaveLength(1)
        expect(router.route()).toBe('direct')
    })

    it('мёртвы оба: запрос уходит один раз по текущему маршруту, без повтора', async () => {
        const { router, to } = setup({ proxy: dead, direct: dead })
        await expect(router.fetch(rpcUrl('increment_play_count'), post())).rejects.toThrow()
        expect(to('proxy', '/rpc/increment_play_count')).toHaveLength(1)
        expect(to('direct', '/rpc/increment_play_count')).toHaveLength(0)
    })

    it('если маршрут только что отвечал, проверка связи не делается', async () => {
        const { router, to } = setup({ proxy: () => marked(), direct: dead })
        await router.fetch(READ) // чтение подтвердило маршрут
        await router.fetch(rpcUrl('increment_play_count'), post())
        expect(to('proxy', '/auth/v1/health')).toHaveLength(0)
    })

    it('после обрыва изменяющего запроса следующий сначала проверяет связь', async () => {
        let healthy = true
        const proxy: Handler = (call) => {
            if (call.url.includes('/auth/v1/health')) return healthy ? marked() : Promise.reject(new TypeError('Failed to fetch'))
            return Promise.reject(new TypeError('Failed to fetch'))
        }
        const { router, to } = setup({ proxy, direct: () => ok() })
        await expect(router.fetch(rpcUrl('increment_play_count'), post())).rejects.toThrow()
        healthy = false
        await router.fetch(rpcUrl('increment_play_count'), post())
        // Второй уже ушёл напрямую (проверка нашла, что посредник не отвечает), первый не повторялся.
        expect(to('proxy', '/rpc/increment_play_count')).toHaveLength(1)
        expect(to('direct', '/rpc/increment_play_count')).toHaveLength(1)
    })

    it('ответ 5xx на изменяющий запрос не повторяется', async () => {
        const { router, to } = setup({ proxy: () => new Response('bad', { status: 503 }), direct: () => ok() })
        const res = await router.fetch(`${DIRECT}/auth/v1/token?grant_type=password`, post())
        expect(res.status).toBe(503)
        expect(to('direct', '/auth/v1/token')).toHaveLength(0)
    })

    it('PATCH, DELETE и неизвестные RPC считаются изменяющими', async () => {
        for (const [url, method] of [
            [`${DIRECT}/rest/v1/profiles?id=eq.1`, 'PATCH'],
            [`${DIRECT}/storage/v1/object/avatars/x`, 'DELETE'],
            [rpcUrl('some_new_function'), 'POST']
        ] as const) {
            const { router, to } = setup({ proxy: () => new Response('x', { status: 500 }), direct: () => ok() })
            await router.fetch(url, { method })
            expect(to('direct', new URL(url).pathname)).toHaveLength(0)
        }
    })
})

describe('запомненный выбор', () => {
    it('читается из хранилища при старте', () => {
        const storage = memoryStorage({ [ROUTE_STORAGE_KEY]: JSON.stringify({ p: PROXY, http: 'direct', ws: 'direct' }) })
        const { router } = setup({ proxy: dead, direct: () => ok() }, { storage })
        expect(router.route()).toBe('direct')
        expect(router.wsRoute()).toBe('direct')
    })

    it('выбор, сделанный для другого посредника, игнорируется', () => {
        const storage = memoryStorage({ [ROUTE_STORAGE_KEY]: JSON.stringify({ p: 'https://old.example.com', http: 'direct' }) })
        const { router } = setup({ proxy: dead, direct: () => ok() }, { storage })
        expect(router.route()).toBe('proxy')
    })

    it('мусор или недоступное хранилище не мешают', () => {
        const bad = { getItem: () => 'not json{', setItem: () => { throw new Error('quota') } }
        const router = createRouter({ directUrl: DIRECT, proxyUrl: PROXY, storage: bad, fetchImpl: dead as never, log: () => undefined })
        expect(router.route()).toBe('proxy')
    })
})

describe('ссылки Storage', () => {
    it('toActiveUrl переписывает прямой адрес на рабочий маршрут и следует за переключением', async () => {
        const { router } = setup({ proxy: dead, direct: () => ok() })
        const signed = `${DIRECT}/storage/v1/object/sign/playlist-covers/a.jpg?token=t`
        expect(router.toActiveUrl(signed)).toBe(`${PROXY}/storage/v1/object/sign/playlist-covers/a.jpg?token=t`)
        await router.fetch(READ) // посредник упал → напрямую
        expect(router.toActiveUrl(signed)).toBe(signed)
        expect(router.toActiveUrl('https://other.example.com/a.jpg')).toBe('https://other.example.com/a.jpg')
    })

    it('посредник с префиксом пути (свой сервер за /supa)', async () => {
        const net = makeNet({ proxy: () => marked(), direct: dead })
        const router = createRouter({ directUrl: DIRECT, proxyUrl: 'https://proxy.example.workers.dev/supa/', fetchImpl: net.fetchImpl, storage: null, log: () => undefined })
        expect(router.toActiveUrl(`${DIRECT}/storage/v1/x?a=1`)).toBe('https://proxy.example.workers.dev/supa/storage/v1/x?a=1')
    })
})

describe('через supabase-js', () => {
    it('REST, rpc и подписанные ссылки идут через посредника, а при его падении — напрямую', async () => {
        const proxy: Handler = (call) => {
            if (call.url.includes('/storage/v1/object/sign')) return marked('{"signedURL":"/object/sign/b/a.jpg?token=t"}')
            return marked('[{"plays":3}]')
        }
        const net = makeNet({ proxy, direct: () => ok('[{"plays":3}]') })
        const router = createRouter({ directUrl: DIRECT, proxyUrl: PROXY, fetchImpl: net.fetchImpl, storage: null, log: () => undefined })
        const client = createClient(DIRECT, 'anon', { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'test-a' }, global: { fetch: router.fetch } })

        const { data } = await client.from('play_counts').select('plays')
        expect(data).toEqual([{ plays: 3 }])
        expect(net.to('proxy', '/rest/v1/play_counts')).toHaveLength(1)

        await client.rpc('increment_play_count', { track_key_input: 'r-0' })
        expect(net.to('proxy', '/rpc/increment_play_count')).toHaveLength(1)
        expect(net.to('direct', '/rpc/increment_play_count')).toHaveLength(0)

        const signed = await client.storage.from('b').createSignedUrl('a.jpg', 60)
        expect(signed.data?.signedUrl.startsWith(DIRECT)).toBe(true)
        expect(router.toActiveUrl(signed.data!.signedUrl).startsWith(PROXY)).toBe(true)
    })

    it('посредник отвалился посреди работы: чтение уходит напрямую, запись по тому же маршруту без дублей', async () => {
        const net = makeNet({ proxy: dead, direct: () => ok('[{"plays":1}]') })
        const router = createRouter({ directUrl: DIRECT, proxyUrl: PROXY, fetchImpl: net.fetchImpl, storage: null, timeoutMs: 40, log: () => undefined })
        const client = createClient(DIRECT, 'anon', { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'test-b' }, global: { fetch: router.fetch } })
        const { data } = await client.from('play_counts').select('plays')
        expect(data).toEqual([{ plays: 1 }])
        await client.rpc('increment_play_count', { track_key_input: 'r-0' })
        expect(net.to('direct', '/rpc/increment_play_count')).toHaveLength(1)
        expect(net.to('proxy', '/rpc/increment_play_count')).toHaveLength(0)
    })
})

describe('WebSocket (realtime)', () => {
    type Listener = () => void
    class FakeSocket {
        static instances: FakeSocket[] = []
        readyState = 0
        listeners: Record<string, Listener[]> = {}
        constructor(public url: string) {
            FakeSocket.instances.push(this)
        }
        addEventListener(type: string, fn: Listener) {
            ;(this.listeners[type] ||= []).push(fn)
        }
        emit(type: string) {
            for (const fn of this.listeners[type] ?? []) fn()
        }
        close() {
            this.readyState = 3
            this.emit('close')
        }
    }
    const wsUrl = `wss://abc.supabase.co/realtime/v1/websocket?apikey=k&vsn=1.0.0`
    function wsSetup(storage = memoryStorage()) {
        FakeSocket.instances = []
        const router = createRouter({ directUrl: DIRECT, proxyUrl: PROXY, fetchImpl: dead as never, storage, timeoutMs: 30, log: () => undefined })
        const Routed = router.webSocket(FakeSocket as never) as unknown as new (url: string) => FakeSocket
        return { router, Routed, storage }
    }

    it('по умолчанию подключается к посреднику (wss), путь и параметры сохраняются', () => {
        const { Routed } = wsSetup()
        const ws = new Routed(wsUrl)
        expect(ws.url).toBe('wss://proxy.example.workers.dev/realtime/v1/websocket?apikey=k&vsn=1.0.0')
    })

    it('успешное открытие оставляет маршрут', async () => {
        const { Routed, router } = wsSetup()
        const ws = new Routed(wsUrl)
        ws.readyState = 1
        ws.emit('open')
        await new Promise((r) => setTimeout(r, 60))
        expect(router.wsRoute()).toBe('proxy')
        expect(new Routed(wsUrl).url.startsWith('wss://proxy.')).toBe(true)
    })

    it('закрылось, не открывшись → следующее подключение напрямую (отдельно от HTTP-маршрута)', () => {
        const { Routed, router, storage } = wsSetup()
        const ws = new Routed(wsUrl)
        ws.close()
        expect(router.wsRoute()).toBe('direct')
        expect(router.route()).toBe('proxy')
        expect(new Routed(wsUrl).url).toBe(wsUrl)
        expect(JSON.parse(storage.getItem(ROUTE_STORAGE_KEY)!)).toMatchObject({ ws: 'direct' })
    })

    it('не открылось за таймаут → сокет закрывается и маршрут меняется', async () => {
        const { Routed, router } = wsSetup()
        const ws = new Routed(wsUrl)
        await new Promise((r) => setTimeout(r, 80))
        expect(ws.readyState).toBe(3)
        expect(router.wsRoute()).toBe('direct')
    })

    it('закрытие после успешного открытия — обычный разрыв, маршрут не трогаем', () => {
        const { Routed, router } = wsSetup()
        const ws = new Routed(wsUrl)
        ws.readyState = 1
        ws.emit('open')
        ws.close()
        expect(router.wsRoute()).toBe('proxy')
    })
})
