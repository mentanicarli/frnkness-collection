// Клиентский слой «Музыка и друзья»: расчёт топа, порядок плейлиста,
// «сейчас слушает» без лишних запросов, мгновенное избранное.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Releases } from '@/types'

vi.mock('../social/api', async (orig) => {
    const real = await orig<typeof import('../social/api')>()
    return { ...real, api: { favoriteSet: vi.fn(async () => ({})), userFavorites: vi.fn(async () => []) } }
})

const { api, SocialError } = await import('../social/api')
const { buildTop } = await import('../social/top')
const { moveItem } = await import('../social/playlists')
const { createNowPlayingReporter, HEARTBEAT_MS, MIN_INTERVAL_MS } = await import('../social/nowPlaying')
const { favorites, isFavorite, loadFavorites, resetFavorites, toggleFavorite } = await import('../social/favorites')
const { notice } = await import('../social/notice')

const track = (rel: string, slug: string, num: number) => ({ id: `${rel}/${slug}`, num, title: slug, file: `${slug}.mp3`, lyricsFile: `${slug}.txt` })
const RELEASES = {
    alpha: { type: 'album', title: 'A', year: '2026', cover: 'a.jpg', audioPath: 'a/', lyricsPath: 'l/', tracks: [track('alpha', 'one', 1), track('alpha', 'two', 2)] },
    beta: { type: 'single', title: 'B', year: '2026', cover: 'b.jpg', audioPath: 'b/', lyricsPath: 'l/', tracks: [track('beta', 'solo', 1)] }
} as unknown as Releases

describe('«мой топ»', () => {
    it('ключи статистики → id треков, по убыванию, топ-10', () => {
        const rows = Array.from({ length: 14 }, (_, i) => ({ track_key: i % 2 ? 'alpha-1' : 'beta-0', plays: 1 }))
        expect(buildTop([{ track_key: 'alpha-0', plays: 5 }, { track_key: 'beta-0', plays: 9 }], RELEASES)).toEqual([
            { trackId: 'beta/solo', plays: 9 },
            { trackId: 'alpha/one', plays: 5 }
        ])
        expect(buildTop(rows, RELEASES, 1)).toEqual([{ trackId: 'alpha/two', plays: 7 }])
    })

    it('треки, пропавшие из каталога, отбрасываются; старый формат ключа складывается с новым', () => {
        const top = buildTop(
            [
                { track_key: 'gone-0', plays: 100 },
                { track_key: 'alpha-5', plays: 50 },
                { track_key: 'alpha--1', plays: 2 },
                { track_key: 'alpha-0', plays: 3 },
                { track_key: 'beta-0', plays: 0 }
            ],
            RELEASES
        )
        expect(top).toEqual([{ trackId: 'alpha/one', plays: 5 }])
    })

    it('равные — по id, стабильно; пусто — пустой список (заглушка на странице)', () => {
        expect(buildTop([{ track_key: 'beta-0', plays: 2 }, { track_key: 'alpha-1', plays: 2 }], RELEASES).map((t) => t.trackId)).toEqual(['alpha/two', 'beta/solo'])
        expect(buildTop([], RELEASES)).toEqual([])
    })
})

describe('порядок плейлиста', () => {
    const L = ['a', 'b', 'c', 'd']

    it('перетаскивание вниз и вверх', () => {
        expect(moveItem(L, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
        expect(moveItem(L, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    })

    it('кнопки ↑/↓ — сдвиг на одну позицию; за край — без изменений', () => {
        expect(moveItem(L, 1, 0)).toEqual(['b', 'a', 'c', 'd'])
        expect(moveItem(L, 2, 3)).toEqual(['a', 'b', 'd', 'c'])
        expect(moveItem(L, 0, -1)).toEqual(L)
        expect(moveItem(L, 3, 4)).toEqual(L)
    })

    it('исходный список не меняется', () => {
        const copy = [...L]
        moveItem(L, 0, 3)
        expect(L).toEqual(copy)
    })
})

describe('«сейчас слушает»', () => {
    let now: number
    let timers: { at: number; fn: () => void; id: number }[]
    let sent: string[]
    let nextId: number

    function reporter() {
        return createNowPlayingReporter({
            send: async (id) => { sent.push(id) },
            now: () => now,
            setTimeout: (fn, ms) => {
                const t = { at: now + ms, fn, id: nextId++ }
                timers.push(t)
                return t.id
            },
            clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id) }
        })
    }

    /** Промотать время, выполняя таймеры по порядку. */
    function advance(ms: number) {
        const end = now + ms
        for (;;) {
            const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]
            if (!due) break
            timers = timers.filter((t) => t !== due)
            now = due.at
            due.fn()
        }
        now = end
    }

    beforeEach(() => {
        now = 1_000_000
        timers = []
        sent = []
        nextId = 1
    })

    it('смена трека — сразу, если минута прошла; быстрые переключения — одним запросом через минуту', () => {
        const r = reporter()
        r.update('a/1', true)
        expect(sent).toEqual(['a/1'])
        advance(5_000)
        r.update('a/2', true)
        advance(5_000)
        r.update('a/3', true)
        expect(sent).toEqual(['a/1'])
        advance(MIN_INTERVAL_MS)
        expect(sent).toEqual(['a/1', 'a/3'])
    })

    it('пока играет один трек — раз в 2 минуты; на паузе — ничего', () => {
        const r = reporter()
        r.update('a/1', true)
        advance(HEARTBEAT_MS * 3)
        expect(sent).toEqual(['a/1', 'a/1', 'a/1', 'a/1'])
        r.update('a/1', false)
        advance(HEARTBEAT_MS * 5)
        expect(sent).toHaveLength(4)
        expect(timers).toEqual([])
    })

    it('за час непрерывного прослушивания с частой сменой треков — не больше 60 запросов', () => {
        const r = reporter()
        for (let i = 0; i < 3600 / 20; i++) {
            r.update(`a/${i}`, true)
            advance(20_000)
        }
        expect(sent.length).toBeLessThanOrEqual(61)
    })

    it('выход из аккаунта сбрасывает таймеры', () => {
        const r = reporter()
        r.update('a/1', true)
        r.reset()
        expect(timers).toEqual([])
        r.update('a/2', true)
        expect(sent).toEqual(['a/1', 'a/2'])
    })
})

describe('избранное: мгновенный отклик', () => {
    beforeEach(() => {
        vi.mocked(api.favoriteSet).mockReset().mockResolvedValue({})
        vi.mocked(api.userFavorites).mockReset().mockResolvedValue([{ track_id: 'alpha/one', added_at: '2026-10-01T00:00:00Z' }])
        resetFavorites('me')
    })

    it('загрузка и переключение: сердечко меняется до ответа сервера', async () => {
        await loadFavorites()
        expect(isFavorite('alpha/one')).toBe(true)
        let resolve!: (v: unknown) => void
        vi.mocked(api.favoriteSet).mockImplementation(() => new Promise((r) => { resolve = r }))
        const done = toggleFavorite('beta/solo')
        await Promise.resolve()
        expect(isFavorite('beta/solo')).toBe(true)
        expect(favorites.items[0].track_id).toBe('beta/solo')
        resolve({})
        await done
        expect(api.favoriteSet).toHaveBeenCalledWith('beta/solo', true)
    })

    it('ошибка сервера — состояние возвращается, показывается текст ошибки', async () => {
        await loadFavorites()
        vi.mocked(api.favoriteSet).mockRejectedValue(new SocialError('Не больше 2000 треков в избранном', '54000'))
        await toggleFavorite('alpha/one')
        expect(isFavorite('alpha/one')).toBe(true)
        expect(notice.text).toBe('Не больше 2000 треков в избранном')
        expect(notice.error).toBe(true)
    })

    it('двойное нажатие — запросы по очереди, итог как после двух нажатий', async () => {
        await loadFavorites()
        await Promise.all([toggleFavorite('beta/solo'), toggleFavorite('beta/solo')])
        expect(vi.mocked(api.favoriteSet).mock.calls).toEqual([['beta/solo', true], ['beta/solo', false]])
        expect(isFavorite('beta/solo')).toBe(false)
    })

    it('выход: избранное очищается, поздний ответ не возвращает чужие данные', async () => {
        let resolve!: (v: { track_id: string; added_at: string }[]) => void
        vi.mocked(api.userFavorites).mockImplementation(() => new Promise((r) => { resolve = r }))
        const loading = loadFavorites()
        resetFavorites(null)
        resolve([{ track_id: 'alpha/two', added_at: '' }])
        await loading
        expect(favorites.items).toEqual([])
    })
})
