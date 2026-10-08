// Content Security Policy продакшен-сборки (сайт и админка).
//
// GitHub Pages не умеет отдавать свои заголовки, поэтому политика — тегом
// <meta http-equiv="Content-Security-Policy"> в index.html и admin.html
// (vite.config.ts, только при сборке). Встроенные <script> разрешаются по
// хешу их текста, всё остальное — только с перечисленных адресов.
import { createHash } from 'node:crypto'

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

export function inlineScriptHashes(html: string): string[] {
    const out: string[] = []
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
        out.push(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`)
    }
    return out
}

/**
 * proxyUrl — адрес посредника (SUPABASE_PROXY_URL), пустой — без него. Его
 * origin добавляется туда же, куда прямой адрес Supabase: запросы (https),
 * realtime (wss) и подписанные ссылки Storage/аватары (img-src).
 */
export function cspPolicy(supabaseUrl: string, scriptHashes: string[], proxyUrl = ''): string {
    const supabase = new URL(supabaseUrl).origin
    const proxy = proxyUrl ? new URL(proxyUrl).origin : ''
    const origins = proxy && proxy !== supabase ? [supabase, proxy] : [supabase]
    const wsOrigins = origins.map((o) => o.replace(/^http/, 'ws'))
    const directives: Record<string, string[]> = {
        'default-src': ["'self'"],
        'script-src': ["'self'", ...scriptHashes, TURNSTILE_ORIGIN],
        // Vue и Tailwind ставят style="" — без 'unsafe-inline' сайт развалится.
        'style-src': ["'self'", "'unsafe-inline'"],
        // Шрифты лежат на сайте (public/fonts/), внешний хостинг шрифтов не нужен.
        'font-src': ["'self'"],
        // Аватары — из публичного бакета Supabase Storage.
        'img-src': ["'self'", 'data:', 'blob:', ...origins],
        'media-src': ["'self'", 'blob:'],
        'connect-src': ["'self'", ...origins, ...wsOrigins, TURNSTILE_ORIGIN],
        // Капча и встроенные клипы YouTube на странице релиза.
        'frame-src': [TURNSTILE_ORIGIN, 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
        'worker-src': ["'self'"],
        'manifest-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"]
    }
    return Object.entries(directives)
        .map(([name, values]) => `${name} ${values.join(' ')}`)
        .join('; ')
}

export function injectCsp(html: string, supabaseUrl: string, proxyUrl = ''): string {
    const policy = cspPolicy(supabaseUrl, inlineScriptHashes(html), proxyUrl)
    const tag = `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/"/g, '&quot;')}">`
    // Сразу после <meta charset>: политика должна действовать до первого скрипта.
    return html.replace(/(<meta charset="[^"]*">)/i, `$1\n    ${tag}`)
}
