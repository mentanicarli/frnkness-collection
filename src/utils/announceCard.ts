import type { Announce } from '@/types'
import { escapeHtml } from './helpers'

/**
 * Анонс «скоро выйдет» на главной: карточка будущего релиза с живым
 * отсчётом. Общий код сайта и превью в админке.
 *
 * Время выхода хранится в ISO с +03:00 (по Москве), отсчёт считается в
 * браузере. Когда время вышло, карточка убирается — сайт не висит с нулями.
 */

export function releaseTime(announce: Pick<Announce, 'releaseAt'>): number {
    return Date.parse(announce.releaseAt)
}

/** Показывать ли анонс сейчас: включён, заполнен и время ещё не наступило. */
export function isAnnounceActive(announce: Announce | null | undefined, now: number = Date.now()): announce is Announce {
    if (!announce || !announce.enabled || !announce.title || !announce.cover) return false
    const at = releaseTime(announce)
    return Number.isFinite(at) && at > now
}

/** Анонс включён, но время уже вышло — пора добавить релиз и выключить анонс. */
export function isAnnounceExpired(announce: Announce | null | undefined, now: number = Date.now()): boolean {
    if (!announce || !announce.enabled) return false
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

function safeUrl(url: string | undefined): string | null {
    return url && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null
}

export function renderAnnounceCardHtml(announce: Announce, now: number = Date.now()): string {
    const title = escapeHtml(announce.title)
    const at = releaseTime(announce)
    const link = safeUrl(announce.url)
    const text = announce.text ? `<p class="announce-text">${escapeHtml(announce.text)}</p>` : ''
    const cta = link
        ? `<a class="promo-cta announce-cta inline-flex items-center gap-2" href="${escapeHtml(link)}" target="_blank" rel="noopener" style="height: 2.75rem; padding: 0 1.25rem; border-radius: 0.375rem; font-size: 0.8125rem;">
                                    Подробнее
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                </a>`
        : ''
    return `
                <div class="release-card promo-release-card announce-card text-left relative w-full" data-release-at="${at}" style="padding: clamp(1rem,2vw,1.625rem);">
                    <div class="flex flex-col sm:flex-row items-start sm:items-center" style="gap: clamp(1.125rem,3vw,2.5rem);">
                        <div class="promo-cover-wrap aspect-square overflow-hidden bg-[var(--bg)] flex-shrink-0" style="border-radius: 0.5rem;">
                            <img src="${escapeHtml(announce.cover)}" alt="${title}" class="card-image w-full h-full object-cover" loading="eager" decoding="async" onerror="this.style.display='none'">
                        </div>
                        <div class="flex-1 min-w-0 flex flex-col" style="gap: 1rem;">
                            <div class="promo-badge">скоро</div>
                            <h3 class="promo-title line-clamp-2 relative z-10" style="font-size: clamp(1.5rem,4vw,3.125rem); line-height: 1;">${title}</h3>
                            <div class="announce-countdown" aria-live="off" role="timer">${formatCountdown(at - now)}</div>
                            <p class="announce-when">Выйдет ${escapeHtml(formatReleaseMoment(announce.releaseAt))}</p>
                            ${text}
                            ${cta}
                        </div>
                    </div>
                </div>
            `
}

/**
 * Живой отсчёт в отрисованной карточке. Когда время вышло — onExpire
 * (сайт убирает карточку). Возвращает функцию остановки.
 */
export function startAnnounceCountdown(card: HTMLElement, onExpire: () => void, now: () => number = Date.now): () => void {
    const at = Number(card.dataset.releaseAt)
    const el = card.querySelector<HTMLElement>('.announce-countdown')
    let timer: ReturnType<typeof setInterval> | null = null
    const stop = () => {
        if (timer !== null) clearInterval(timer)
        timer = null
    }
    const tick = () => {
        const left = at - now()
        if (!Number.isFinite(at) || left <= 0) {
            stop()
            onExpire()
            return
        }
        if (el) el.textContent = formatCountdown(left)
    }
    tick()
    if (Number.isFinite(at) && at > now()) timer = setInterval(tick, 1000)
    return stop
}
