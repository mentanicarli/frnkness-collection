import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick, type Component } from 'vue'
import type { Announce } from '@/types'
import { buildNoteMap } from '@/utils/trackNotes'
import TrackLyrics from '../components/TrackLyrics.vue'
import TrackAbout from '../components/TrackAbout.vue'
import AnnounceCard from '../components/AnnounceCard.vue'
import PromoCard from '../components/PromoCard.vue'

// Цвет обложки в jsdom не считается — подменяем, чтобы не грузить картинки.
vi.mock('../services/colors', () => ({ applyCardAccent: vi.fn(async () => {}), resetCardAccent: vi.fn() }))

const mounted: { unmount(): void; el: HTMLElement }[] = []
function mount(component: Component, props: Record<string, unknown>) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const app = createApp({ render: () => h(component, props) })
    app.mount(el)
    const handle = { el, unmount: () => { app.unmount(); el.remove() } }
    mounted.push(handle)
    return el
}

afterEach(() => {
    mounted.splice(0).forEach((m) => m.unmount())
    vi.useRealTimers()
})

describe('TrackLyrics', () => {
    it('пустой текст — заглушка', () => {
        const el = mount(TrackLyrics, { text: '', noteMap: new Map() })
        expect(el.textContent).toBe('Текст будет позже...')
    })

    it('разборы: id по порядку, только первое вхождение строки, текст экранируется', () => {
        const noteMap = buildNoteMap({ annotations: [{ line: 'a <b>', note: 'x & y' }, { line: 'c', note: 'z' }] })
        const el = mount(TrackLyrics, { text: 'a <b>\nc\n\n[Припев]\na <b>', noteMap })
        const lines = el.querySelectorAll('p.lyric-line')
        expect(lines[0].className).toBe('lyric-line has-note')
        expect(lines[0].getAttribute('data-note-target')).toBe('lyric-note-0')
        expect(lines[0].textContent).toBe('a <b>')
        expect(lines[0].innerHTML).toBe('a &lt;b&gt;')
        expect(lines[1].getAttribute('data-note-target')).toBe('lyric-note-1')
        expect(el.querySelector('p.is-blank')).not.toBeNull()
        expect(el.querySelector('p.lyric-section')!.textContent).toBe('[Припев]')
        // Повтор строки — без разбора.
        expect(lines[3].className).toBe('lyric-line')
        const note = el.querySelector<HTMLElement>('#lyric-note-0')!
        expect(note.innerHTML).toBe('x &amp; y')
        expect(note.hidden).toBe(true)
        // Без подсветки админки номеров строк нет.
        expect(lines[0].hasAttribute('data-line')).toBe(false)
    })

    it('разбор раскрывается по клику и по Enter', async () => {
        const noteMap = buildNoteMap({ annotations: [{ line: 'c', note: 'z' }] })
        const el = mount(TrackLyrics, { text: 'c', noteMap })
        const line = el.querySelector<HTMLElement>('.has-note')!
        const note = el.querySelector<HTMLElement>('#lyric-note-0')!
        line.click()
        await nextTick()
        expect(note.hidden).toBe(false)
        expect(line.classList.contains('open')).toBe(true)
        expect(line.getAttribute('aria-expanded')).toBe('true')
        line.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await nextTick()
        expect(note.hidden).toBe(true)
        expect(line.getAttribute('aria-expanded')).toBe('false')
    })

    it('режим админки: номера строк, классы и клик по строке', async () => {
        const clicks: number[] = []
        const el = mount(TrackLyrics, {
            text: 'один\n\n[Метка]\nдва',
            noteMap: new Map(),
            lineClass: (n: number) => ({ 'is-playing': n === 1 }),
            'onLineClick': (n: number) => clicks.push(n)
        })
        const lines = el.querySelectorAll<HTMLElement>('p.lyric-line:not(.is-blank)')
        expect(Array.from(lines).map((l) => l.dataset.line)).toEqual(['0', '1'])
        expect(lines[1].classList.contains('is-playing')).toBe(true)
        lines[1].click()
        expect(clicks).toEqual([1])
    })
})

describe('TrackAbout', () => {
    it('абзацы — по пустой строке, текст экранируется', () => {
        const el = mount(TrackAbout, { about: 'Первый <i>\nвсё ещё первый\n\nВторой' })
        const ps = el.querySelectorAll('.track-about p')
        expect(ps).toHaveLength(2)
        expect(ps[0].innerHTML).toBe('Первый &lt;i&gt;\nвсё ещё первый')
        expect(el.querySelector('.track-section-title')!.textContent).toBe('О треке')
    })

    it('без описания — ничего', () => {
        expect(mount(TrackAbout, { about: '   ' }).querySelector('section')).toBeNull()
        expect(mount(TrackAbout, { about: null }).querySelector('section')).toBeNull()
    })
})

const base: Announce = {
    enabled: true,
    title: 'Новый <альбом>',
    cover: 'images/announce-novyy-20261002.jpg',
    releaseAt: '2026-11-01T18:00:00+03:00',
    text: 'Пресейв уже открыт',
    url: 'https://example.com/presave'
}
const AT = Date.parse('2026-11-01T15:00:00Z')

describe('AnnounceCard', () => {
    it('экранирует текст, ссылка только https', () => {
        vi.useFakeTimers({ now: AT - 60_000 })
        const el = mount(AnnounceCard, { announce: base })
        expect(el.querySelector('.promo-title')!.innerHTML).toBe('Новый &lt;альбом&gt;')
        expect(el.querySelector('.announce-countdown')!.textContent).toBe('0 дн. 00:01:00')
        expect(el.querySelector('.announce-when')!.textContent).toBe('Выйдет 1 ноября в 18:00 по Москве')
        expect(el.querySelector('a')!.getAttribute('href')).toBe('https://example.com/presave')
        expect(el.querySelector('.announce-text')!.textContent).toBe('Пресейв уже открыт')
        expect(el.querySelector('.announce-card')!.getAttribute('data-release-at')).toBe(String(AT))

        const bad = mount(AnnounceCard, { announce: { ...base, url: 'javascript:alert(1)', text: undefined } })
        expect(bad.querySelector('a')).toBeNull()
        expect(bad.querySelector('.announce-text')).toBeNull()
    })

    it('живой отсчёт и событие expire по истечении — один раз', async () => {
        vi.useFakeTimers({ now: AT - 2500 })
        const expire = vi.fn()
        const el = mount(AnnounceCard, { announce: base, onExpire: expire })
        const countdown = () => el.querySelector('.announce-countdown')!.textContent
        expect(countdown()).toBe('0 дн. 00:00:03')
        vi.advanceTimersByTime(1000)
        await nextTick()
        expect(countdown()).toBe('0 дн. 00:00:02')
        vi.advanceTimersByTime(2000)
        expect(expire).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(5000)
        expect(expire).toHaveBeenCalledTimes(1)
    })

    it('без даты: «Скоро» без таймера, не истекает', () => {
        vi.useFakeTimers({ now: Date.parse('2099-01-01T00:00:00Z') })
        const { releaseAt: _r, ...noDate } = base
        const expire = vi.fn()
        const el = mount(AnnounceCard, { announce: noDate, onExpire: expire })
        const countdown = el.querySelector('.announce-countdown')!
        expect(countdown.classList.contains('announce-soon')).toBe(true)
        expect(countdown.textContent).toBe('Скоро')
        expect(el.querySelector('[role="timer"]')).toBeNull()
        expect(el.querySelector('.announce-when')).toBeNull()
        expect(el.querySelector('.announce-card')!.hasAttribute('data-release-at')).toBe(false)
        expect(el.querySelector('.promo-badge')!.textContent).toBe('анонс')
        vi.advanceTimersByTime(10_000)
        expect(expire).not.toHaveBeenCalled()
    })
})

describe('PromoCard', () => {
    it('название экранируется, клик по карточке — событие open', () => {
        const open = vi.fn()
        const release = { type: 'album', title: 'Злая <b>', year: '2026', cover: 'images/a.jpg', audioPath: '', lyricsPath: '', tracks: [] }
        const el = mount(PromoCard, { releaseId: 'zlaya', release, onOpen: open })
        expect(el.querySelector('.promo-title')!.innerHTML).toBe('Злая &lt;b&gt;')
        el.querySelector<HTMLElement>('.promo-cta')!.click()
        expect(open).toHaveBeenCalledTimes(1)
        expect(open).toHaveBeenCalledWith('zlaya')
    })
})
