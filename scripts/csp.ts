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

export function cspPolicy(supabaseUrl: string, scriptHashes: string[]): string {
    const supabase = new URL(supabaseUrl).origin
    const supabaseWs = supabase.replace(/^http/, 'ws')
    const directives: Record<string, string[]> = {
        'default-src': ["'self'"],
        'script-src': ["'self'", ...scriptHashes, TURNSTILE_ORIGIN],
        // Vue и Tailwind ставят style="" — без 'unsafe-inline' сайт развалится.
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        // Аватары — из публичного бакета Supabase Storage.
        'img-src': ["'self'", 'data:', 'blob:', supabase],
        'media-src': ["'self'", 'blob:'],
        'connect-src': ["'self'", supabase, supabaseWs, TURNSTILE_ORIGIN],
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

export function injectCsp(html: string, supabaseUrl: string): string {
    const policy = cspPolicy(supabaseUrl, inlineScriptHashes(html))
    const tag = `<meta http-equiv="Content-Security-Policy" content="${policy.replace(/"/g, '&quot;')}">`
    // Сразу после <meta charset>: политика должна действовать до первого скрипта.
    return html.replace(/(<meta charset="[^"]*">)/i, `$1\n    ${tag}`)
}
