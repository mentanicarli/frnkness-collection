import { RU_MONTHS_GENITIVE } from '../../../supabase/functions/_shared/rules.ts'

/**
 * Даты в админке — строки 'YYYY-MM-DD' без времени. Сутки считаются по
 * Москве, как в RPC статистики.
 */
export type IsoDate = string

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Текущая дата по Москве. */
export function moscowToday(now: Date = new Date()): IsoDate {
    // en-CA форматирует как YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now)
}

/** Дата по Москве для момента времени (например, начала журнала). */
export function moscowDateOf(timestamp: string | Date): IsoDate {
    return moscowToday(typeof timestamp === 'string' ? new Date(timestamp) : timestamp)
}

function toUtc(iso: IsoDate): number {
    const m = iso.match(ISO_RE)
    if (!m) throw new Error(`Неверная дата: ${iso}`)
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function fromUtc(ms: number): IsoDate {
    return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(iso: IsoDate, days: number): IsoDate {
    return fromUtc(toUtc(iso) + days * 86_400_000)
}

/** Сколько дней от a до b (b − a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
    return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}

export function isValidIsoDate(value: string): boolean {
    const m = value.match(ISO_RE)
    if (!m) return false
    return fromUtc(toUtc(value)) === value
}

/** Все даты от from до to включительно. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
    const out: IsoDate[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
    return out
}

/** «26 августа 2026» → '2026-08-26'; null, если формат другой. */
export function parseRuDate(value: string | undefined | null): IsoDate | null {
    if (!value) return null
    const m = value.trim().match(/^(\d{1,2}) ([а-яё]+) (\d{4})$/i)
    if (!m) return null
    const month = RU_MONTHS_GENITIVE.indexOf(m[2].toLowerCase())
    if (month < 0) return null
    const iso = `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return isValidIsoDate(iso) ? iso : null
}

/** '2026-08-26' → «26 августа 2026» — формат releaseDate в releases.json. */
export function formatRuDate(iso: IsoDate): string {
    const m = iso.match(ISO_RE)
    if (!m || !isValidIsoDate(iso)) throw new Error(`Неверная дата: ${iso}`)
    return `${Number(m[3])} ${RU_MONTHS_GENITIVE[Number(m[2]) - 1]} ${m[1]}`
}

const SHORT_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/** '2026-08-26' → «26 авг». */
export function formatShortDate(iso: IsoDate): string {
    const m = iso.match(ISO_RE)
    if (!m) return iso
    return `${Number(m[3])} ${SHORT_MONTHS[Number(m[2]) - 1]}`
}

/** '2026-08-26' → «26 авг 2026». */
export function formatMediumDate(iso: IsoDate): string {
    const m = iso.match(ISO_RE)
    if (!m) return iso
    return `${formatShortDate(iso)} ${m[1]}`
}
