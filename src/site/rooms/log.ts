/**
 * Подробный журнал комнат в консоли браузера (console.info, префикс [rooms]):
 * подключение к Realtime, попытки, статусы канала, возвращение в комнату.
 * Токены и тексты пользователей сюда не попадают — только статусы, id комнаты и ошибки.
 * Если комната ведёт себя странно, пришлите строки с [rooms] из консоли (F12 → Console).
 */
export function rlog(...args: unknown[]): void {
    try {
        console.info('[rooms]', ...args)
    } catch {
        // Консоли может не быть — журнал не должен ломать сайт.
    }
}

/** Время жизни JWT в секундах (по полю exp) — чтобы видеть в журнале протухший токен. Сам токен не выводится. */
export function tokenTtlSeconds(token: string | null | undefined, now = Date.now()): number | null {
    if (!token) return null
    try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        return typeof payload.exp === 'number' ? Math.round(payload.exp - now / 1000) : null
    } catch {
        return null
    }
}
