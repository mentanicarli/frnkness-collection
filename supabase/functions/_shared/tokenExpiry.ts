/**
 * Срок действия fine-grained токена GitHub. GitHub присылает его в заголовке
 * github-authentication-token-expiration, например «2026-12-31 23:59:59 UTC»
 * или «2026-12-31 23:59:59 +0300». У токена без срока заголовка нет.
 * Возвращает ISO-строку в UTC или null.
 */
export function parseTokenExpiration(header: string | null | undefined): string | null {
    if (!header) return null
    const m = header.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/i)
    let ms: number
    if (m) {
        const zone = !m[3] || /^(utc|z)$/i.test(m[3]) ? 'Z' : m[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')
        ms = Date.parse(`${m[1]}T${m[2]}${zone}`)
    } else {
        ms = Date.parse(header)
    }
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}
