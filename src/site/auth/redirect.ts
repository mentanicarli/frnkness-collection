/**
 * Куда вернуть человека после входа: адрес из ?next=…, только внутренний
 * путь сайта («/track/…»). Чужие сайты, «//evil», «javascript:», обратные
 * слэши и мусор отбрасываются — тогда на главную.
 */
export const MAX_NEXT_LENGTH = 500

// Экраны входа: возвращаться на них после входа бессмысленно.
const AUTH_PATHS = ['/welcome', '/login', '/register', '/forgot', '/change-password']

export function sanitizeNext(raw: unknown): string | null {
    const value = Array.isArray(raw) ? raw[0] : raw
    if (typeof value !== 'string' || !value || value.length > MAX_NEXT_LENGTH) return null
    if (!value.startsWith('/') || value.startsWith('//')) return null
    // Обратный слэш, управляющие символы и пробелы браузер может трактовать
    // как начало другого адреса.
    if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return null
    if (/^\/[^/?#]*:/.test(value)) return null
    const path = value.split(/[?#]/)[0]
    if (AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return null
    return value
}

/** Куда вести гостя с закрытого адреса: на заставку, запомнив адрес. */
export function welcomeLocation(fullPath: string): { name: 'welcome'; query?: { next: string } } {
    const next = sanitizeNext(fullPath)
    return next && next !== '/' ? { name: 'welcome', query: { next } } : { name: 'welcome' }
}
