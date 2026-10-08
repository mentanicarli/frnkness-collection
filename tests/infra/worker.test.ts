// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../../infra/cloudflare-worker/worker.js'

const UPSTREAM = 'https://momcakikuivtvxkmgjhx.supabase.co'
const WORKER = 'https://frnk.example.workers.dev'

// В Node для потокового тела нужен duplex: 'half'; в Workers он не требуется.
const NativeRequest = Request
class HalfDuplexRequest extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, init?.body ? ({ duplex: 'half', ...init } as RequestInit) : init)
    }
}

let upstreamRequest: Request | undefined
let upstreamResponse: () => Response | Promise<Response>

beforeEach(() => {
    upstreamRequest = undefined
    upstreamResponse = () => new Response('{}', { status: 200 })
    vi.stubGlobal('Request', HalfDuplexRequest)
    vi.stubGlobal(
        'fetch',
        vi.fn(async (req: Request) => {
            upstreamRequest = req
            return upstreamResponse()
        })
    )
})
afterEach(() => vi.unstubAllGlobals())

const call = (path: string, init?: RequestInit) => worker.fetch(new Request(WORKER + path, init))

describe('Cloudflare Worker: прозрачный прокси на Supabase', () => {
    it('путь, строка запроса и метод уходят на Supabase без изменений', async () => {
        for (const path of ['/rest/v1/play_counts?select=plays&track_key=like.r-%25', '/auth/v1/user', '/storage/v1/object/sign/b/a.jpg?token=t', '/functions/v1/register', '/realtime/v1/api/broadcast']) {
            await call(path, { method: 'GET' })
            expect(upstreamRequest!.url).toBe(UPSTREAM + path)
        }
    })

    it('все методы, включая OPTIONS, пересылаются', async () => {
        for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
            await call('/rest/v1/x', { method })
            expect(upstreamRequest!.method).toBe(method)
        }
    })

    it('заголовки запроса пересылаются все (CORS, Range, токен, apikey), host не копируется', async () => {
        await call('/storage/v1/object/x', {
            headers: {
                authorization: 'Bearer secret-token',
                apikey: 'pub-key',
                range: 'bytes=0-99',
                origin: 'https://frnkness.ru',
                'access-control-request-headers': 'authorization,apikey',
                'x-client-info': 'supabase-js/2',
                host: 'frnk.example.workers.dev'
            }
        })
        const h = upstreamRequest!.headers
        expect(h.get('authorization')).toBe('Bearer secret-token')
        expect(h.get('apikey')).toBe('pub-key')
        expect(h.get('range')).toBe('bytes=0-99')
        expect(h.get('origin')).toBe('https://frnkness.ru')
        expect(h.get('access-control-request-headers')).toBe('authorization,apikey')
        expect(h.get('x-client-info')).toBe('supabase-js/2')
        expect(h.get('host')).toBeNull()
    })

    it('IP клиента от Cloudflare становится x-forwarded-for, подделку клиента Worker затирает', async () => {
        await call('/functions/v1/register', { headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' } })
        expect(upstreamRequest!.headers.get('x-forwarded-for')).toBe('203.0.113.7')
    })

    it('тело запроса доходит', async () => {
        await call('/rest/v1/rpc/increment_play_count', { method: 'POST', body: '{"track_key_input":"r-0"}', headers: { 'content-type': 'application/json' } })
        expect(await upstreamRequest!.text()).toBe('{"track_key_input":"r-0"}')
    })

    it('редиректы не выполняются Worker-ом (manual)', async () => {
        await call('/auth/v1/authorize')
        expect(upstreamRequest!.redirect).toBe('manual')
    })

    it('ответ: статус, заголовки (CORS, Content-Range) и тело возвращаются, добавляется метка', async () => {
        upstreamResponse = () =>
            new Response('[1,2,3]', {
                status: 206,
                headers: { 'content-range': '0-2/10', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-type': 'application/json' }
            })
        const res = await call('/rest/v1/x', { headers: { range: '0-2' } })
        expect(res.status).toBe(206)
        expect(res.headers.get('content-range')).toBe('0-2/10')
        expect(res.headers.get('content-type')).toBe('application/json')
        expect(res.headers.get('x-frnk-proxy')).toBe('1')
        expect(res.headers.get('access-control-expose-headers')).toBe('content-range, x-frnk-proxy, x-frnk-proxy-error')
        expect(await res.text()).toBe('[1,2,3]')
    })

    it('ответ идёт потоком, а не целиком в память', async () => {
        let pulled = 0
        upstreamResponse = () =>
            new Response(
                new ReadableStream({
                    pull(controller) {
                        pulled++
                        if (pulled > 3) controller.close()
                        else controller.enqueue(new Uint8Array(1024))
                    }
                })
            )
        const res = await call('/storage/v1/object/x')
        expect(res.body).toBeInstanceOf(ReadableStream)
        const reader = res.body!.getReader()
        await reader.read()
        expect(pulled).toBeLessThan(10)
        await reader.cancel()
    })

    it('ответ без CORS не получает лишних заголовков доступа; «*» в expose не трогается', async () => {
        upstreamResponse = () => new Response('x')
        let res = await call('/rest/v1/x')
        expect(res.headers.has('access-control-expose-headers')).toBe(false)
        upstreamResponse = () => new Response('x', { headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' } })
        res = await call('/rest/v1/x')
        expect(res.headers.get('access-control-expose-headers')).toBe('*')
    })

    it('ответ на OPTIONS (preflight) возвращается как есть', async () => {
        upstreamResponse = () => new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey', 'access-control-allow-methods': '*' } })
        const res = await call('/rest/v1/x', { method: 'OPTIONS' })
        expect(res.status).toBe(204)
        expect(res.headers.get('access-control-allow-headers')).toBe('authorization, apikey')
    })

    it('Supabase недоступен: 502 с CORS и меткой ошибки Worker', async () => {
        upstreamResponse = () => Promise.reject(new TypeError('connect failed'))
        const res = await call('/rest/v1/x')
        expect(res.status).toBe(502)
        expect(res.headers.get('x-frnk-proxy-error')).toBe('upstream-unreachable')
        expect(res.headers.get('access-control-allow-origin')).toBe('*')
        expect(res.headers.get('access-control-expose-headers')).toContain('x-frnk-proxy-error')
    })

    it('WebSocket: запрос с Upgrade пересылается с заголовками рукопожатия, ответ 101 возвращается как есть', async () => {
        const switching = { status: 101, headers: new Headers(), webSocket: {} } as unknown as Response
        upstreamResponse = () => switching
        const res = await call('/realtime/v1/websocket?apikey=k&vsn=1.0.0', {
            headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-key': 'abc==', 'sec-websocket-version': '13', 'sec-websocket-protocol': 'phx' }
        })
        expect(res).toBe(switching)
        expect(upstreamRequest!.url).toBe(`${UPSTREAM}/realtime/v1/websocket?apikey=k&vsn=1.0.0`)
        expect(upstreamRequest!.headers.get('upgrade')).toBe('websocket')
        expect(upstreamRequest!.headers.get('sec-websocket-key')).toBe('abc==')
        expect(upstreamRequest!.headers.get('sec-websocket-version')).toBe('13')
    })

    it('/__health отвечает без обращения к Supabase', async () => {
        const res = await call('/__health')
        expect(await res.json()).toEqual({ ok: true })
        expect(fetch).not.toHaveBeenCalled()
    })

    it('/__bulk отдаёт заявленный объём (с границами) и не ходит в Supabase', async () => {
        const res = await call('/__bulk?kb=300')
        expect(res.headers.get('content-length')).toBe(String(300 * 1024))
        expect((await res.arrayBuffer()).byteLength).toBe(300 * 1024)
        expect((await (await call('/__bulk?kb=999999')).arrayBuffer()).byteLength).toBe(5120 * 1024)
        expect((await (await call('/__bulk?kb=0')).arrayBuffer()).byteLength).toBe(1024)
        expect((await (await call('/__bulk')).arrayBuffer()).byteLength).toBe(1024 * 1024)
        expect(fetch).not.toHaveBeenCalled()
    })

    it('/__test отдаёт страницу самопроверки с подставленными адресом и ключом, без обращения к Supabase', async () => {
        const res = await call('/__test')
        expect(res.headers.get('content-type')).toContain('text/html')
        expect(res.headers.get('content-security-policy')).toContain(`connect-src 'self' ${UPSTREAM}`)
        const html = await res.text()
        expect(html).toContain(`DIRECT = '${UPSTREAM}'`)
        expect(html).toMatch(/KEY = 'sb_publishable_/)
        expect(html).not.toContain('__APIKEY__')
        expect(html).not.toContain('__UPSTREAM__')
        // Скрипт страницы синтаксически корректен.
        const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]
        expect(() => new Function(script)).not.toThrow()
        expect(fetch).not.toHaveBeenCalled()
    })

    it('токены и ключи нигде не логируются', async () => {
        const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined))
        upstreamResponse = () => Promise.reject(new Error('boom'))
        await call('/rest/v1/x', { headers: { authorization: 'Bearer secret-token', apikey: 'pub-key' } })
        for (const s of spies) expect(s).not.toHaveBeenCalled()
        spies.forEach((s) => s.mockRestore())
    })
})
