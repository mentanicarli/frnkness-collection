// Обложка плейлиста: своя картинка — всегда одна на весь квадрат; коллаж —
// 0 треков заглушка, 1–3 разных релиза одна обложка, 4+ сетка 2×2; пустых клеток нет.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('@/config', () => {
    const rel = (id: string, n: number) => ({
        type: 'album', title: id, year: '2026', cover: `images/${id}.jpg`, audioPath: `audio/${id}/`, lyricsPath: `l/${id}/`,
        tracks: Array.from({ length: n }, (_, i) => ({ id: `${id}/t${i + 1}`, num: i + 1, title: `${id}${i + 1}`, file: `${i}.mp3`, lyricsFile: `${i}.txt` }))
    })
    return { SUPABASE_URL: '', SUPABASE_ANON_KEY: '', releases: { a: rel('a', 3), b: rel('b', 2), c: rel('c', 1), d: rel('d', 1), e: rel('e', 1) } }
})

const { coverLayout, collageCovers } = await import('../social/tracks')
const { default: PlaylistCover } = await import('../components/PlaylistCover.vue')

const ids = (...x: string[]) => x

describe('coverLayout', () => {
    it('0 треков — заглушка, без картинок', () => {
        expect(coverLayout([])).toEqual({ kind: 'empty', covers: [] })
        // Недоступные треки (нет в каталоге) тоже не дают обложки.
        expect(coverLayout(ids('gone/x'))).toEqual({ kind: 'empty', covers: [] })
    })

    it('1–3 разных релиза — одна обложка на весь квадрат', () => {
        expect(coverLayout(ids('a/t1', 'a/t2', 'a/t3'))).toEqual({ kind: 'single', covers: ['images/a.jpg'] })
        expect(coverLayout(ids('a/t1', 'b/t1'))).toEqual({ kind: 'single', covers: ['images/a.jpg'] })
        expect(coverLayout(ids('a/t1', 'b/t1', 'c/t1')).kind).toBe('single')
    })

    it('4 и больше разных релизов — сетка из четырёх разных обложек', () => {
        const l = coverLayout(ids('a/t1', 'a/t2', 'b/t1', 'c/t1', 'd/t1', 'e/t1'))
        expect(l.kind).toBe('grid')
        expect(l.covers).toEqual(['images/a.jpg', 'images/b.jpg', 'images/c.jpg', 'images/d.jpg'])
    })

    it('своя обложка побеждает при любом числе треков', () => {
        for (const tracks of [[], ids('a/t1'), ids('a/t1', 'b/t1', 'c/t1', 'd/t1', 'e/t1')]) {
            expect(coverLayout(tracks, 'https://x/own.webp')).toEqual({ kind: 'custom', covers: ['https://x/own.webp'] })
        }
    })

    it('не загрузившиеся картинки в раскладку не попадают', () => {
        const all = ids('a/t1', 'b/t1', 'c/t1', 'd/t1', 'e/t1')
        // Одна из четырёх упала — берётся пятая, сетка остаётся полной.
        expect(coverLayout(all, null, new Set(['images/b.jpg'])).covers).toEqual(['images/a.jpg', 'images/c.jpg', 'images/d.jpg', 'images/e.jpg'])
        // Меньше четырёх рабочих — одна обложка, а не сетка с дырой.
        expect(coverLayout(ids('a/t1', 'b/t1', 'c/t1', 'd/t1'), null, new Set(['images/a.jpg']))).toEqual({ kind: 'single', covers: ['images/b.jpg'] })
        // Своя картинка не загрузилась — коллаж.
        expect(coverLayout(ids('a/t1'), 'https://x/own.webp', new Set(['https://x/own.webp'])).kind).toBe('single')
        expect(collageCovers(ids('a/t1'), new Set(['images/a.jpg']))).toEqual([])
    })
})

describe('PlaylistCover', () => {
    const els: HTMLElement[] = []
    afterEach(() => els.splice(0).forEach((e) => e.remove()))
    async function render(firstTracks: string[], url?: string | null) {
        const el = document.createElement('div')
        document.body.appendChild(el)
        els.push(el)
        createApp({ render: () => h(PlaylistCover, { firstTracks, url }) }).mount(el)
        await nextTick()
        return el.querySelector('.pl-cover') as HTMLElement
    }

    it('коллаж: 0 / 1 / 2 / 4+ релизов', async () => {
        expect((await render([])).querySelectorAll('img')).toHaveLength(0)
        expect((await render([])).querySelector('svg')).not.toBeNull()
        const one = await render(ids('a/t1', 'a/t2'))
        expect(one.querySelectorAll('img')).toHaveLength(1)
        expect(one.classList.contains('grid')).toBe(false)
        const two = await render(ids('a/t1', 'b/t1'))
        expect(two.querySelectorAll('img')).toHaveLength(1)
        expect(two.classList.contains('grid')).toBe(false)
        const four = await render(ids('a/t1', 'b/t1', 'c/t1', 'd/t1', 'e/t1'))
        expect(four.querySelectorAll('img')).toHaveLength(4)
        expect(four.classList.contains('grid')).toBe(true)
    })

    it('своя обложка — одна картинка без сетки, пока треки добавляются и убираются', async () => {
        for (const tracks of [[], ids('a/t1'), ids('a/t1', 'b/t1', 'c/t1', 'd/t1'), ids('a/t1', 'b/t1')]) {
            const el = await render(tracks, 'https://x/own.webp')
            expect(el.classList.contains('grid')).toBe(false)
            const imgs = el.querySelectorAll('img')
            expect(imgs).toHaveLength(1)
            expect(imgs[0].getAttribute('src')).toBe('https://x/own.webp')
            expect(imgs[0].dataset.testid).toBe('playlist-cover-img')
        }
    })

    it('картинка коллажа не загрузилась — клетки остаются заполненными', async () => {
        const el = await render(ids('a/t1', 'b/t1', 'c/t1', 'd/t1', 'e/t1'))
        el.querySelectorAll('img')[1].dispatchEvent(new Event('error'))
        await nextTick()
        const srcs = Array.from(el.querySelectorAll('img')).map((i) => i.getAttribute('src'))
        expect(srcs).toEqual(['images/a.jpg', 'images/c.jpg', 'images/d.jpg', 'images/e.jpg'])
    })
})
