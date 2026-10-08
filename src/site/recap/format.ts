import type { DayPartId } from './types'

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** «2025-05-05» → «5 мая». Дата приходит от базы уже московской — часовой пояс не нужен. */
export function formatRecapDay(date: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    if (!m) return ''
    const month = MONTHS[Number(m[2]) - 1]
    return month ? `${Number(m[3])} ${month}` : ''
}

/** Целое число с тонким пробелом: 12 345. */
export function formatCount(n: number): string {
    return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('ru-RU')
}

/** Минуты → «2 ч 15 мин» (меньше часа — «45 мин»). */
export function formatDuration(minutes: number): string {
    const total = Math.max(0, Math.round(Number(minutes) || 0))
    const h = Math.floor(total / 60)
    const m = total % 60
    if (!h) return `${m} мин`
    return m ? `${h} ч ${m} мин` : `${h} ч`
}

export const DAY_PART_LABEL: Record<DayPartId, string> = {
    morning: 'Утро',
    day: 'День',
    evening: 'Вечер',
    night: 'Ночь'
}

export const DAY_PART_HOURS: Record<DayPartId, string> = {
    morning: '5–11',
    day: '11–17',
    evening: '17–23',
    night: '23–5'
}

export const DAY_PART_ORDER: DayPartId[] = ['morning', 'day', 'evening', 'night']

/** Любимое время суток: больше всего прослушиваний; при равенстве — раньше по порядку. */
export function topDayPart(parts: Record<DayPartId, number> | null | undefined): { id: DayPartId; plays: number; share: number } | null {
    if (!parts) return null
    const total = DAY_PART_ORDER.reduce((s, id) => s + (Number(parts[id]) || 0), 0)
    if (total <= 0) return null
    let best: DayPartId = DAY_PART_ORDER[0]
    for (const id of DAY_PART_ORDER) if ((parts[id] || 0) > (parts[best] || 0)) best = id
    return { id: best, plays: Number(parts[best]) || 0, share: Math.round(((Number(parts[best]) || 0) / total) * 100) }
}
