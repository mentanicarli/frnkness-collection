/**
 * Общее для Edge Functions аккаунтов: CORS, JSON-ответы, ошибки, IP
 * клиента, капча Cloudflare Turnstile. Без привязки к Deno — тестируется
 * в vitest с подставленным fetch.
 */
import { corsHeaders, isAllowedOrigin } from './cors.ts'

export class HttpError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string
    ) {
        super(message)
    }
}

export function json(origin: string | null, status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    })
}

/**
 * Обёртка обработчика: CORS-preflight, только POST с JSON, ошибки — в
 * едином виде { error: { code, message } }. Неожиданные ошибки наружу не
 * отдаются (только в лог функции).
 */
export function serveJson(
    run: (req: Request, body: Record<string, unknown>) => Promise<unknown>,
    log: (message: string) => void = () => undefined
): (req: Request) => Promise<Response> {
    return async (req) => {
        const origin = req.headers.get('Origin')
        if (req.method === 'OPTIONS') {
            return new Response(null, { status: isAllowedOrigin(origin) ? 204 : 403, headers: corsHeaders(origin) })
        }
        if (origin && !isAllowedOrigin(origin)) return json(origin, 403, { error: { code: 'origin', message: 'Нет доступа' } })
        if (req.method !== 'POST') return json(origin, 405, { error: { code: 'method', message: 'Только POST' } })
        let body: Record<string, unknown>
        try {
            const raw = await req.text()
            if (raw.length > 20_000) throw new Error('too large')
            const parsed = JSON.parse(raw)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object')
            body = parsed as Record<string, unknown>
        } catch {
            return json(origin, 400, { error: { code: 'bad_request', message: 'Неверный запрос' } })
        }
        try {
            const result = await run(req, body)
            return json(origin, 200, result ?? { ok: true })
        } catch (e) {
            if (e instanceof HttpError) return json(origin, e.status, { error: { code: e.code, message: e.message } })
            log(`unexpected: ${(e as Error)?.stack || e}`)
            return json(origin, 500, { error: { code: 'internal', message: 'Что-то пошло не так, попробуй позже' } })
        }
    }
}

export function str(body: Record<string, unknown>, key: string, max = 500): string {
    const v = body[key]
    if (v === undefined || v === null) return ''
    if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'bad_request', 'Неверный запрос')
    return v
}

export function bearer(req: Request): string | null {
    const h = req.headers.get('Authorization') || ''
    const m = /^Bearer\s+(\S+)$/i.exec(h)
    return m ? m[1] : null
}

/** IP клиента: первый адрес x-forwarded-for (его ставит шлюз Supabase). */
export function clientIp(req: Request): string {
    const xff = req.headers.get('x-forwarded-for') || ''
    const first = xff.split(',')[0].trim()
    return first || req.headers.get('cf-connecting-ip') || 'unknown'
}

/** HMAC-SHA256 с секретом функции: в базе не хранится ни IP, ни ник в открытом виде. */
export async function keyHash(secret: string, value: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
    return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Проверка капчи на сервере Cloudflare. Без секрета — отказ (не «пропустить»). */
export async function verifyTurnstile(fetchFn: typeof fetch, secret: string | undefined, token: string, ip: string): Promise<boolean> {
    if (!secret || !token || token.length > 4096) return false
    try {
        const form = new URLSearchParams({ secret, response: token })
        if (ip && ip !== 'unknown') form.set('remoteip', ip)
        const res = await fetchFn(TURNSTILE_VERIFY_URL, { method: 'POST', body: form })
        if (!res.ok) return false
        const data = (await res.json()) as { success?: boolean }
        return data.success === true
    } catch {
        return false
    }
}
