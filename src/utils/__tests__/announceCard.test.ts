import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Announce } from '@/types'
import {
    formatCountdown,
    formatReleaseMoment,
    isAnnounceActive,
    isAnnounceExpired,
    renderAnnounceCardHtml,
    startAnnounceCountdown
} from '../announceCard'

const base: Announce = {
    enabled: true,
    title: 'Новый <альбом>',
    cover: 'images/announce-novyy-20261002.jpg',
    releaseAt: '2026-11-01T18:00:00+03:00',
    text: 'Пресейв уже открыт',
    url: 'https://example.com/presave'
}
const AT = Date.parse('2026-11-01T15:00:00Z')

afterEach(() => vi.useRealTimers())

describe('анонс: время', () => {
    it('активен до момента выхода, потом — нет', () => {
        expect(isAnnounceActive(base, AT - 1)).toBe(true)
        expect(isAnnounceActive(base, AT)).toBe(false)
        expect(isAnnounceActive({ ...base, enabled: false }, AT - 1000)).toBe(false)
        expect(isAnnounceActive({ ...base, releaseAt: 'мусор' }, 0)).toBe(false)
        expect(isAnnounceActive(undefined)).toBe(false)
    })

    it('«N дн. HH:MM:SS»', () => {
        expect(formatCountdown(((3 * 24 + 4) * 3600 + 5 * 60 + 6) * 1000)).toBe('3 дн. 04:05:06')
        expect(formatCountdown(999)).toBe('0 дн. 00:00:01')
        expect(formatCountdown(-5)).toBe('0 дн. 00:00:00')
    })

    it('подпись момента выхода', () => {
        expect(formatReleaseMoment('2026-11-01T18:00:00+03:00')).toBe('1 ноября в 18:00 по Москве')
    })
})

describe('карточка анонса', () => {
    it('экранирует текст, ссылка только https', () => {
        const html = renderAnnounceCardHtml(base, AT - 60_000)
        expect(html).toContain('Новый &lt;альбом&gt;')
        expect(html).toContain('0 дн. 00:01:00')
        expect(html).toContain('href="https://example.com/presave"')
        expect(html).toContain('Пресейв уже открыт')
        expect(renderAnnounceCardHtml({ ...base, url: 'javascript:alert(1)' }, 0)).not.toContain('href=')
        expect(renderAnnounceCardHtml({ ...base, text: undefined, url: undefined }, 0)).not.toContain('announce-text')
    })

    it('живой отсчёт и снятие карточки по истечении', () => {
        vi.useFakeTimers()
        let now = AT - 2500
        document.body.innerHTML = renderAnnounceCardHtml(base, now)
        const card = document.querySelector<HTMLElement>('.announce-card')!
        const expired = vi.fn()
        startAnnounceCountdown(card, expired, () => now)
        expect(card.querySelector('.announce-countdown')!.textContent).toBe('0 дн. 00:00:03')
        now += 1000
        vi.advanceTimersByTime(1000)
        expect(card.querySelector('.announce-countdown')!.textContent).toBe('0 дн. 00:00:02')
        now += 2000
        vi.advanceTimersByTime(2000)
        expect(expired).toHaveBeenCalledTimes(1)
        now += 5000
        vi.advanceTimersByTime(5000)
        expect(expired).toHaveBeenCalledTimes(1)
    })
})

describe('анонс без даты', () => {
    const { releaseAt: _r, ...noDate } = base

    it('активен всегда, пока включён, и не истекает', () => {
        expect(isAnnounceActive(noDate, 0)).toBe(true)
        expect(isAnnounceActive(noDate, Date.parse('2099-01-01T00:00:00Z'))).toBe(true)
        expect(isAnnounceActive({ ...noDate, enabled: false })).toBe(false)
        expect(isAnnounceExpired(noDate, Date.parse('2099-01-01T00:00:00Z'))).toBe(false)
        // Старый формат с датой — как раньше.
        expect(isAnnounceExpired(base, AT)).toBe(true)
        expect(isAnnounceExpired(base, AT - 1)).toBe(false)
    })

    it('карточка: «Скоро» без таймера и без «Выйдет…»', () => {
        const html = renderAnnounceCardHtml(noDate, 0)
        expect(html).toContain('announce-soon')
        expect(html).toContain('>Скоро<')
        expect(html).not.toContain('role="timer"')
        expect(html).not.toContain('announce-when')
        expect(html).not.toContain('data-release-at')
        expect(html).toContain('Новый &lt;альбом&gt;')
        expect(html).toContain('href="https://example.com/presave"')
    })

    it('отсчёт не запускается и карточку не снимает', () => {
        vi.useFakeTimers()
        document.body.innerHTML = renderAnnounceCardHtml(noDate)
        const card = document.querySelector<HTMLElement>('.announce-card')!
        const expired = vi.fn()
        const stop = startAnnounceCountdown(card, expired, () => Date.parse('2099-01-01T00:00:00Z'))
        vi.advanceTimersByTime(10_000)
        expect(expired).not.toHaveBeenCalled()
        expect(card.querySelector('.announce-countdown')!.textContent).toBe('Скоро')
        stop()
    })
})
