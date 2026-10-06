// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { cspPolicy, injectCsp, inlineScriptHashes } from './csp'

const HTML = `<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <script>window.x = 1</script>
    <script type="module" src="./assets/index.js"></script>
</head><body></body></html>`

describe('CSP', () => {
    it('хеши только встроенных скриптов', () => {
        const expected = `'sha256-${createHash('sha256').update('window.x = 1').digest('base64')}'`
        expect(inlineScriptHashes(HTML)).toEqual([expected])
    })

    it('политика: Supabase (API, хранилище, realtime), Turnstile, шрифты, YouTube', () => {
        const p = cspPolicy('https://abc.supabase.co/', ["'sha256-x'"])
        expect(p).toContain("script-src 'self' 'sha256-x' https://challenges.cloudflare.com")
        expect(p).toContain('connect-src \'self\' https://abc.supabase.co wss://abc.supabase.co https://challenges.cloudflare.com')
        expect(p).toContain("img-src 'self' data: blob: https://abc.supabase.co")
        expect(p).toContain('frame-src https://challenges.cloudflare.com https://www.youtube.com')
        expect(p).toContain("object-src 'none'")
        expect(p).not.toContain("'unsafe-eval'")
        expect(p).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    })

    it('тег встаёт сразу после <meta charset>', () => {
        const out = injectCsp(HTML, 'https://abc.supabase.co')
        expect(out.indexOf('Content-Security-Policy')).toBeGreaterThan(out.indexOf('charset'))
        expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<script>'))
    })
})
