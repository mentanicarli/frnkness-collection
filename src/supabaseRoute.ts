/**
 * Маршрут до Supabase: напрямую на *.supabase.co или через посредника
 * (Cloudflare Worker, свой сервер — любой адрес, который просто пересылает
 * запросы). Часть пользователей в России не достаёт до *.supabase.co:
 * ответы побольше зависают. Адрес посредника — константа в supabaseConfig.ts;
 * пустая — всё идёт напрямую, этот модуль ничего не меняет.
 *
 * Если посредник задан:
 *   - клиент Supabase создаётся с прямым адресом, а `fetch` и WebSocket
 *     подменяют начало адреса на рабочий маршрут;
 *   - чтение (GET и RPC из SAFE_RPC) при ошибке сети, зависании или ошибке
 *     посредника повторяется по другому маршруту, и тот запоминается на
 *     сессию вкладки (sessionStorage);
 *   - запрос, меняющий данные, НИКОГДА не повторяется после отправки: перед
 *     ним, если маршрут давно не отвечал, делается лёгкая проверка связи, и
 *     только она может переключить маршрут (запрос ещё не отправлен).
 *
 * Заголовки, по которым клиент отличает ответ посредника: см. PROXY_*.
 */

export type RouteName = 'proxy' | 'direct'

/** Сколько ждём ответ маршрута (и паузу между кусками тела), мс. */
export const ROUTE_TIMEOUT_MS = 5000
/** Последняя попытка по запасному маршруту: после неё пробовать больше нечего. */
export const LAST_RESORT_TIMEOUT_MS = 15000
/** Столько маршрут считается рабочим после последнего ответа, без проверки связи. */
export const ROUTE_FRESH_MS = 60_000
export const ROUTE_STORAGE_KEY = 'frnk-route'
/** Посредник ставит на каждый ответ, который переслал от Supabase. */
export const PROXY_MARK_HEADER = 'x-frnk-proxy'
/** Посредник ставит на ответ-ошибку, который сделал сам (не смог дойти до Supabase). */
export const PROXY_ERROR_HEADER = 'x-frnk-proxy-error'

/**
 * RPC, которые только читают (или безвредны при повторе): их можно повторить
 * по другому маршруту. Всё остальное считается изменяющим данные и не
 * дублируется. Новая функция по умолчанию не в списке — это безопасная сторона.
 * Функции админки сюда не вписаны (их имён не должно быть в бандле сайта,
 * см. scripts/check-dist.mjs): админка добавляет свои через markSafeRpc.
 */
const SAFE_RPC = new Set<string>([
    // Сайт
    'user_favorites', 'playlist_get', 'user_playlists', 'user_top', 'user_top4', 'feed_prefs_get',
    'friends_feed', 'friends_list', 'friend_requests_count', 'tags_all', 'list_discoverable_users',
    'user_search', 'profile_by_nick', 'server_now', 'room_get', 'room_my', 'room_info',
    'room_invites_list', 'room_invites_count', 'my_recap_state', 'my_recovery_code_state',
    // Сессия прослушивания: upsert по session_id, повтор пишет ту же строку
    'record_listen_session'
])

/** Добавляет RPC, которые только читают (для кода, не входящего в бандл сайта). */
export function markSafeRpc(names: readonly string[]): void {
    for (const n of names) SAFE_RPC.add(n)
}

/**
 * Приводит адрес к виду «https://хост[/префикс]» без хвостового «/».
 * Пустая строка — адрес не задан или не годится (не https, кроме localhost).
 */
export function normalizeBase(raw: string | null | undefined): string {
    const value = (raw ?? '').trim()
    if (!value) return ''
    let u: URL
    try {
        u = new URL(value)
    } catch {
        return ''
    }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return ''
    if (u.username || u.password) return ''
    return u.origin + u.pathname.replace(/\/+$/, '')
}

const otherOf = (r: RouteName): RouteName => (r === 'proxy' ? 'direct' : 'proxy')

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface RouteFetchOptions {
    /** Явно: запрос можно повторить по другому маршруту (true) или нельзя (false). */
    idempotent?: boolean
}

type WebSocketCtor = new (url: string | URL, protocols?: string | string[]) => WebSocket

export interface RouterOptions {
    /** Прямой адрес проекта (https://<ref>.supabase.co). */
    directUrl: string
    /** Адрес посредника; пустой — маршрутизация выключена. */
    proxyUrl: string
    fetchImpl?: FetchLike
    storage?: Pick<Storage, 'getItem' | 'setItem'> | null
    timeoutMs?: number
    lastResortTimeoutMs?: number
    freshMs?: number
    now?: () => number
    log?: (message: string) => void
}

export interface SupabaseRouter {
    /** Есть ли посредник: без него всё как раньше, напрямую. */
    readonly enabled: boolean
    /** Рабочий маршрут для HTTP. */
    route(): RouteName
    /** Рабочий маршрут для WebSocket (запоминается отдельно). */
    wsRoute(): RouteName
    /** Начало адреса рабочего маршрута (без «/» на конце). */
    baseUrl(): string
    /** Ссылка вида «прямой адрес…» → та же ссылка на рабочем маршруте; чужие не трогает. */
    toActiveUrl(url: string): string
    /** Замена fetch для Supabase и наших функций. */
    fetch(input: RequestInfo | URL, init?: RequestInit, opts?: RouteFetchOptions): Promise<Response>
    /** Класс WebSocket, подключающийся по рабочему маршруту. */
    webSocket(Base: WebSocketCtor): WebSocketCtor
}

interface StoredRoute {
    p: string
    http?: RouteName
    ws?: RouteName
}

const isRoute = (v: unknown): v is RouteName => v === 'proxy' || v === 'direct'

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage : null
    } catch {
        return null
    }
}

class RouteTimeout extends Error {
    constructor() {
        super('route timeout')
    }
}

/** Ждёт promise не дольше ms; по истечении вызывает onTimeout и отклоняет RouteTimeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            onTimeout()
            reject(new RouteTimeout())
        }, ms)
        promise.then(
            (v) => {
                clearTimeout(timer)
                resolve(v)
            },
            (e) => {
                clearTimeout(timer)
                reject(e)
            }
        )
    })
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304])

export function createRouter(opts: RouterOptions): SupabaseRouter {
    const direct = normalizeBase(opts.directUrl)
    const proxy = normalizeBase(opts.proxyUrl)
    const enabled = Boolean(direct && proxy && direct !== proxy)
    const doFetch: FetchLike = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    const timeoutMs = opts.timeoutMs ?? ROUTE_TIMEOUT_MS
    const lastResortMs = opts.lastResortTimeoutMs ?? LAST_RESORT_TIMEOUT_MS
    const freshMs = opts.freshMs ?? ROUTE_FRESH_MS
    const now = opts.now ?? Date.now
    const log = opts.log ?? ((m: string) => console.info(`[net] ${m}`))
    const storage = opts.storage === undefined ? defaultStorage() : opts.storage

    const base = (r: RouteName) => (r === 'proxy' ? proxy : direct)
    const state: { http: RouteName; ws: RouteName } = { http: 'proxy', ws: 'proxy' }
    // Когда маршрут последний раз ответил (любым ответом).
    const lastOk: Record<RouteName, number> = { proxy: 0, direct: 0 }

    if (enabled && storage) {
        try {
            const saved = JSON.parse(storage.getItem(ROUTE_STORAGE_KEY) || 'null') as StoredRoute | null
            // Запомненный выбор относится к тому посреднику, при котором он сделан.
            if (saved && saved.p === proxy) {
                if (isRoute(saved.http)) state.http = saved.http
                if (isRoute(saved.ws)) state.ws = saved.ws
            }
        } catch {
            // Хранилища нет или в нём мусор — начинаем с посредника.
        }
    }

    function save() {
        if (!storage) return
        try {
            storage.setItem(ROUTE_STORAGE_KEY, JSON.stringify({ p: proxy, http: state.http, ws: state.ws } satisfies StoredRoute))
        } catch {
            // Не критично: на этой сессии выбор просто не запомнится.
        }
    }

    function setRoute(kind: 'http' | 'ws', route: RouteName, reason: string) {
        if (state[kind] === route) return
        state[kind] = route
        save()
        log(`${kind === 'http' ? 'HTTP' : 'WebSocket'}: маршрут → ${route === 'proxy' ? 'посредник' : 'напрямую'} (${reason})`)
    }

    /** Прямой адрес в начале ссылки заменяется на адрес маршрута. */
    function rewrite(url: string, route: RouteName): string {
        if (route === 'direct') return url
        if (url === direct) return proxy
        if (url.startsWith(direct) && /[/?#]/.test(url.charAt(direct.length))) return proxy + url.slice(direct.length)
        return url
    }

    const isOurs = (url: string) => url === direct || (url.startsWith(direct) && /[/?#]/.test(url.charAt(direct.length)))

    function isSafeToRepeat(method: string, url: string, hint?: boolean): boolean {
        if (typeof hint === 'boolean') return hint
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true
        if (method === 'POST') {
            const path = url.slice(direct.length).split(/[?#]/)[0]
            const m = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/i.exec(path)
            return Boolean(m && SAFE_RPC.has(m[1]))
        }
        return false
    }

    /** Ответ посредника, по которому видно, что до Supabase запрос не дошёл или посредник сломан. */
    function proxyFailed(route: RouteName, res: Response): boolean {
        if (route !== 'proxy') return false
        if (res.headers.has(PROXY_ERROR_HEADER)) return true
        // Ответ без метки посредника с 5xx — не от него (страница Cloudflare, лимит и т. п.).
        return res.status >= 500 && !res.headers.has(PROXY_MARK_HEADER)
    }

    /**
     * Одна попытка по маршруту. С ограничением по времени (ms > 0) тело читается
     * целиком, чтобы зависание посреди ответа тоже считалось ошибкой.
     */
    async function attempt(route: RouteName, url: string, init: RequestInit, ms: number): Promise<Response> {
        const ctrl = new AbortController()
        const userSignal = init.signal
        const onUserAbort = () => ctrl.abort()
        if (userSignal) {
            if (userSignal.aborted) ctrl.abort()
            else userSignal.addEventListener('abort', onUserAbort, { once: true })
        }
        try {
            const pending = doFetch(rewrite(url, route), { ...init, signal: ctrl.signal })
            const res = ms > 0 ? await withTimeout(pending, ms, () => ctrl.abort()) : await pending
            if (!proxyFailed(route, res)) lastOk[route] = now()
            if (ms <= 0 || !res.body || NULL_BODY_STATUS.has(res.status) || /event-stream/i.test(res.headers.get('content-type') || '')) return res
            // Тело читаем сами: пауза между кусками дольше ms — маршрут завис.
            const reader = res.body.getReader()
            const chunks: Uint8Array[] = []
            let total = 0
            for (;;) {
                const { done, value } = await withTimeout(reader.read(), ms, () => {
                    ctrl.abort()
                    reader.cancel().catch(() => undefined)
                })
                if (done) break
                chunks.push(value)
                total += value.byteLength
            }
            const body = new Uint8Array(total)
            let at = 0
            for (const c of chunks) {
                body.set(c, at)
                at += c.byteLength
            }
            return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
        } finally {
            userSignal?.removeEventListener('abort', onUserAbort)
        }
    }

    // ── Проверка связи перед изменяющим запросом ─────────────────────────
    const probes = new Map<RouteName, Promise<boolean>>()

    /** Достаёт ли маршрут до сервера: любой ответ (даже 401) — да; opaque из-за no-cors. */
    function probe(route: RouteName): Promise<boolean> {
        const running = probes.get(route)
        if (running) return running
        const p = (async () => {
            const ctrl = new AbortController()
            const timer = setTimeout(() => ctrl.abort(), timeoutMs)
            try {
                await doFetch(`${base(route)}/auth/v1/health`, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
                lastOk[route] = now()
                return true
            } catch {
                return false
            } finally {
                clearTimeout(timer)
                probes.delete(route)
            }
        })()
        probes.set(route, p)
        return p
    }

    /** Маршрут для запроса, который нельзя дублировать: выбираем ДО отправки. */
    async function routeForWrite(): Promise<RouteName> {
        const cur = state.http
        if (now() - lastOk[cur] < freshMs) return cur
        if (await probe(cur)) return cur
        const other = otherOf(cur)
        if (await probe(other)) {
            setRoute('http', other, 'не отвечал перед отправкой')
            return other
        }
        return cur
    }

    async function routedFetch(input: RequestInfo | URL, init?: RequestInit, fetchOpts?: RouteFetchOptions): Promise<Response> {
        if (!enabled) return doFetch(input, init)
        let url: string
        let reqInit: RequestInit = init ?? {}
        if (typeof input === 'string') url = input
        else if (input instanceof URL) url = input.href
        else {
            // Request: переносим в (url, init), чтобы можно было менять адрес и повторять.
            url = input.url
            const hasBody = input.method !== 'GET' && input.method !== 'HEAD'
            reqInit = {
                method: input.method,
                headers: input.headers,
                body: hasBody ? await input.clone().arrayBuffer() : undefined,
                signal: input.signal,
                keepalive: input.keepalive,
                ...init
            }
        }
        if (!isOurs(url)) return doFetch(input, init)

        const method = (reqInit.method || 'GET').toUpperCase()
        const streamBody = typeof ReadableStream !== 'undefined' && reqInit.body instanceof ReadableStream
        const safe = !streamBody && isSafeToRepeat(method, url, fetchOpts?.idempotent)

        if (!safe) {
            // Изменяющий запрос: маршрут выбираем до отправки, после — один раз и без повтора.
            const route = streamBody ? state.http : await routeForWrite()
            try {
                const res = await attempt(route, url, reqInit, 0)
                if (proxyFailed(route, res)) lastOk[route] = 0
                return res
            } catch (e) {
                // Что случилось, неизвестно (мог дойти): не повторяем, но следующему
                // изменяющему запросу сначала проверим связь.
                lastOk[route] = 0
                throw e
            }
        }

        const first = state.http
        const second = otherOf(first)
        let firstError: unknown
        let firstRes: Response | undefined
        try {
            const res = await attempt(first, url, reqInit, timeoutMs)
            if (!proxyFailed(first, res)) return res
            firstRes = res
            firstError = new Error(`proxy status ${res.status}`)
        } catch (e) {
            if (reqInit.signal?.aborted) throw e
            firstError = e
        }
        try {
            const res = await attempt(second, url, reqInit, lastResortMs)
            if (!proxyFailed(second, res)) {
                setRoute('http', second, firstError instanceof RouteTimeout ? 'зависание' : 'ошибка')
                return res
            }
            return res
        } catch (e) {
            if (reqInit.signal?.aborted) throw e
            // Оба маршрута не ответили: отдаём то, что есть от первого, иначе ошибку первого.
            if (firstRes) return firstRes
            throw firstError
        }
    }

    function toActiveUrl(url: string): string {
        return enabled && isOurs(url) ? rewrite(url, state.http) : url
    }

    function webSocket(Base: WebSocketCtor): WebSocketCtor {
        if (!enabled) return Base
        return class RoutedWebSocket extends Base {
            constructor(url: string | URL, protocols?: string | string[]) {
                const route = state.ws
                const text = typeof url === 'string' ? url : url.href
                const httpForm = text.replace(/^ws/i, 'http')
                const target = isOurs(httpForm) ? rewrite(httpForm, route).replace(/^http/i, 'ws') : text
                super(target, protocols)
                let settled = false
                const fail = (why: string) => {
                    if (settled) return
                    settled = true
                    clearTimeout(timer)
                    setRoute('ws', otherOf(route), why)
                }
                const timer = setTimeout(() => {
                    if (this.readyState === 0 /* CONNECTING */) {
                        fail('соединение не открылось')
                        this.close()
                    }
                }, timeoutMs)
                this.addEventListener('open', () => {
                    settled = true
                    clearTimeout(timer)
                })
                // Закрылся, так и не открывшись, — до сервера не достали.
                this.addEventListener('close', () => fail('соединение закрылось, не открывшись'))
            }
        } as WebSocketCtor
    }

    return {
        enabled,
        route: () => state.http,
        wsRoute: () => state.ws,
        baseUrl: () => (enabled ? base(state.http) : direct),
        toActiveUrl,
        fetch: routedFetch,
        webSocket
    }
}
