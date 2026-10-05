import type { Announce } from '@/types'

/**
 * Анонс «скоро выйдет» на главной: время и подписи для карточки будущего
 * релиза (src/site/components/AnnounceCard.vue — она же в превью админки).
 *
 * Время выхода хранится в ISO с +03:00 (по Москве), отсчёт считается в
 * браузере. Когда время вышло, карточка убирается — сайт не висит с нулями.
 *
 * Дата необязательна: без неё карточка показывает «Скоро» без таймера и
 * висит, пока анонс не выключат в админке.
 */

/** Есть ли у анонса дата выхода (поле releaseAt заполнено). */
export function hasReleaseDate(announce: Pick<Announce, 'releaseAt'>): boolean {
    return typeof announce.releaseAt === 'string' && announce.releaseAt !== ''
}

/** Момент выхода в мс; NaN — даты нет или она испорчена. */
export function releaseTime(announce: Pick<Announce, 'releaseAt'>): number {
    return hasReleaseDate(announce) ? Date.parse(announce.releaseAt!) : NaN
}

/** Показывать ли анонс сейчас: включён, заполнен и время ещё не наступило (или даты нет). */
export function isAnnounceActive(announce: Announce | null | undefined, now: number = Date.now()): announce is Announce {
    if (!announce || !announce.enabled || !announce.title || !announce.cover) return false
    if (!hasReleaseDate(announce)) return true
    const at = releaseTime(announce)
    return Number.isFinite(at) && at > now
}

/** Анонс включён, но время уже вышло — пора добавить релиз и выключить анонс. Без даты не истекает. */
export function isAnnounceExpired(announce: Announce | null | undefined, now: number = Date.now()): boolean {
    if (!announce || !announce.enabled || !hasReleaseDate(announce)) return false
    const at = releaseTime(announce)
    return Number.isFinite(at) && at <= now
}

/** «N дн. HH:MM:SS» до выхода (секунды округляются вверх). */
export function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000))
    const days = Math.floor(total / 86400)
    const h = Math.floor((total % 86400) / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${days} дн. ${pad(h)}:${pad(m)}:${pad(s)}`
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

/** «1 ноября в 18:00 по Москве» — для подписи под отсчётом. */
export function formatReleaseMoment(releaseAt: string): string {
    const m = releaseAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
    if (!m) return ''
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} в ${m[4]}:${m[5]} по Москве`
}

/** Ссылка «Подробнее» — только https без кавычек и пробелов, иначе null. */
export function safeAnnounceUrl(url: string | undefined): string | null {
    return url && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null
}
