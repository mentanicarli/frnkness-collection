/**
 * CORS для admin-content: только боевой домен и localhost для разработки.
 */
const PROD_ORIGINS = ['https://frnkness.ru']
const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/

export function isAllowedOrigin(origin: string | null): boolean {
    if (!origin) return false
    return PROD_ORIGINS.includes(origin) || LOCAL_ORIGIN_RE.test(origin)
}

export function corsHeaders(origin: string | null): Record<string, string> {
    const headers: Record<string, string> = { Vary: 'Origin' }
    if (origin && isAllowedOrigin(origin)) {
        headers['Access-Control-Allow-Origin'] = origin
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
        headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type'
        headers['Access-Control-Max-Age'] = '86400'
    }
    return headers
}
