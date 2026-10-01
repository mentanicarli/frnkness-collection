import { diffDays, moscowDateOf, moscowToday } from './dates'

export type TokenStatusKind = 'none' | 'ok' | 'soon' | 'expired'

export interface TokenStatus {
    kind: TokenStatusKind
    /** Сколько дней осталось (по московским датам); 0 — истекает сегодня. */
    days: number | null
    /** «ДД.ММ.ГГГГ» по Москве. */
    date: string | null
}

export const TOKEN_WARN_DAYS = 30

export function tokenStatus(expiresAt: string | null, now: Date = new Date()): TokenStatus {
    if (!expiresAt) return { kind: 'none', days: null, date: null }
    const expires = new Date(expiresAt)
    const iso = moscowDateOf(expires)
    const date = `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
    if (expires.getTime() <= now.getTime()) return { kind: 'expired', days: 0, date }
    const days = diffDays(moscowToday(now), iso)
    return { kind: days < TOKEN_WARN_DAYS ? 'soon' : 'ok', days, date }
}

export function pluralDays(n: number): string {
    const m10 = n % 10
    const m100 = n % 100
    if (m10 === 1 && m100 !== 11) return 'день'
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня'
    return 'дней'
}

/** Раздел про обновление токена в инструкции (на GitHub). */
export const TOKEN_DOCS_URL =
    'https://github.com/mentanicarli/frnkness-collection/blob/main/docs/admin-setup.md#срок-действия-и-обновление'
