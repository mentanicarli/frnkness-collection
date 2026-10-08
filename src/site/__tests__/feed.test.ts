// Лента друзей: разбор строк базы, сворачивание прослушиваний, «15 мин назад»,
// «Показать ещё» по курсору и обновление не чаще раза в минуту.
import { describe, it, expect } from 'vitest'
import type { Releases } from '@/types'
import type { FeedPage, FeedRow } from '../social/api'
import { FEED_MIN_POLL_MS, FEED_PAGE_SIZE, collapseListens, createFeed, formatAgo, parseFeedRow, type FeedEvent } from '../social/feed'

const track = (rel: string, slug: string, num: number) => ({ id: `${rel}/${slug}`, num, title: slug, file: `${slug}.mp3`, lyricsFile: `${slug}.txt` })
const RELEASES = {
    alpha: { type: 'album', title: 'A', year: '2026', cover: 'a.jpg', audioPath: 'a/', lyricsPath: 'l/', tracks: [track('alpha', 'one', 1), track('alpha', 'two', 2)] },
    beta: { type: 'single', title: 'B', year: '2026', cover: 'b.jpg', audioPath: 'b/', lyricsPath: 'l/', tracks: [track('beta', 'solo', 1)] }
} as unknown as Releases

const YANA = { id: '00000000-0000-4000-8000-000000000001', nick: 'Яна', avatar: 'initials:0' }
const BOB = { id: '00000000-0000-4000-8000-000000000002', nick: 'Боб', avatar: 'emoji:1' }
const ROOM = '11111111-2222-4333-8444-555555555555'
const PL = '99999999-2222-4333-8444-555555555555'

let n = 0
const row = (over: Partial<FeedRow>): FeedRow => ({ kind: 'listen', at: `2026-10-09T10:00:${String(59 - (n++ % 59)).padStart(2, '0')}.000000+00:00`, key: `listen:${String(++n).padStart(20, '0')}`, user: YANA, track_key: 'alpha-0', ...over })
const listen = (user = YANA, key = 'alpha-0'): FeedRow => row({ user, track_key: key })

describe('лента: разбор строк', () => {
    it('прослушивание: ключ статистики → id трека', () => {
        expect(parseFeedRow(listen(), RELEASES)).toMatchObject({ kind: 'listen', trackId: 'alpha/one', more: 0, user: YANA })
        // Старый формат ключа тоже понятен.
        expect(parseFeedRow(listen(YANA, 'alpha--2'), RELEASES)).toMatchObject({ trackId: 'alpha/two' })
    })

    it('трек пропал из каталога — событие не показывается, ошибки нет', () => {
        expect(parseFeedRow(listen(YANA, 'gone-0'), RELEASES)).toBeNull()
        expect(parseFeedRow(row({ kind: 'favorite', track_id: 'gone/x' }), RELEASES)).toBeNull()
        expect(parseFeedRow(row({ kind: 'top4', track_ids: ['gone/x', 'gone/y'] }), RELEASES)).toBeNull()
    })

    it('избранное, плейлист, топ-4 (без пропавших треков), комната', () => {
        expect(parseFeedRow(row({ kind: 'favorite', track_id: 'beta/solo' }), RELEASES)).toMatchObject({ kind: 'favorite', trackId: 'beta/solo' })
        expect(parseFeedRow(row({ kind: 'playlist', playlist: { id: PL, title: 'Ночное' } }), RELEASES)).toMatchObject({ kind: 'playlist', playlist: { id: PL, title: 'Ночное' } })
        expect(parseFeedRow(row({ kind: 'top4', track_ids: ['alpha/two', 'gone/x', 'beta/solo'] }), RELEASES)).toMatchObject({ kind: 'top4', trackIds: ['alpha/two', 'beta/solo'] })
        expect(parseFeedRow(row({ kind: 'room', can_join: true, room: { id: ROOM, title: 'Вечер' } }), RELEASES)).toMatchObject({ kind: 'room', canJoin: true, room: { id: ROOM, title: 'Вечер' } })
    })

    it('комната без приглашения: ни названия, ни id, даже если база что-то прислала', () => {
        const hidden = parseFeedRow(row({ kind: 'room', can_join: false, room: { id: ROOM, title: 'Секрет' } }), RELEASES)
        expect(hidden).toMatchObject({ kind: 'room', canJoin: false, room: null })
        expect(JSON.stringify(hidden)).not.toContain('Секрет')
        expect(JSON.stringify(hidden)).not.toContain(ROOM)
        // Приглашён, но id кривой — тоже без кнопки.
        expect(parseFeedRow(row({ kind: 'room', can_join: true, room: { id: 'не-uuid', title: 'X' } }), RELEASES)).toMatchObject({ canJoin: false, room: null })
    })

    it('чужие виды событий и битые строки отбрасываются', () => {
        for (const bad of [
            row({ kind: 'secret' }),
            row({ user: null as never }),
            row({ user: { id: 1 } as never }),
            row({ at: 'вчера' }),
            row({ key: 5 as never }),
            row({ kind: 'playlist', playlist: { id: 'x', title: 'y' } }),
            row({ kind: 'playlist' }),
            null as never
        ]) {
            expect(parseFeedRow(bad, RELEASES), JSON.stringify(bad)).toBeNull()
        }
    })

    it('тексты не меняются и не интерпретируются как разметка (экранирует шаблон)', () => {
        const e = parseFeedRow(row({ kind: 'playlist', user: { ...YANA, nick: '<img src=x onerror=alert(1)>' }, playlist: { id: PL, title: '<b>жирно</b>' } }), RELEASES)
        expect(e).toMatchObject({ user: { nick: '<img src=x onerror=alert(1)>' }, playlist: { title: '<b>жирно</b>' } })
    })
})

describe('лента: сворачивание прослушиваний', () => {
    const l = (user: typeof YANA, key: string): FeedEvent => parseFeedRow(listen(user, key), RELEASES)!
    const fav: FeedEvent = parseFeedRow(row({ kind: 'favorite', track_id: 'beta/solo' }), RELEASES)!

    it('подряд идущие прослушивания одного человека → одна строка «и ещё N» с самым свежим', () => {
        const a = l(YANA, 'alpha-0')
        const out = collapseListens([a, l(YANA, 'alpha-1'), l(YANA, 'beta-0'), l(YANA, 'alpha-0')])
        expect(out).toHaveLength(1)
        expect(out[0]).toMatchObject({ kind: 'listen', trackId: 'alpha/one', more: 3, key: a.key })
    })

    it('другой человек или другой вид события прерывает серию', () => {
        const out = collapseListens([l(YANA, 'alpha-0'), l(YANA, 'alpha-1'), l(BOB, 'beta-0'), l(YANA, 'alpha-0'), fav, l(YANA, 'alpha-1')])
        expect(out.map((e) => `${e.kind}:${e.user.nick}:${e.kind === 'listen' ? e.more : '-'}`)).toEqual(['listen:Яна:1', 'listen:Боб:0', 'listen:Яна:0', 'favorite:Яна:-', 'listen:Яна:0'])
    })

    it('не меняет исходный список', () => {
        const src = [l(YANA, 'alpha-0'), l(YANA, 'alpha-1')]
        collapseListens(src)
        expect(src.map((e) => (e.kind === 'listen' ? e.more : -1))).toEqual([0, 0])
        expect(collapseListens([])).toEqual([])
    })
})

describe('лента: «15 мин назад»', () => {
    const now = Date.parse('2026-10-09T12:00:00Z')
    it('только что / минуты / часы / вчера / дни', () => {
        expect(formatAgo('2026-10-09T11:59:40Z', now)).toBe('только что')
        expect(formatAgo('2026-10-09T11:45:00Z', now)).toBe('15 мин назад')
        expect(formatAgo('2026-10-09T11:00:30Z', now)).toBe('59 мин назад')
        expect(formatAgo('2026-10-09T09:00:00Z', now)).toBe('3 ч назад')
        expect(formatAgo('2026-10-08T11:00:00Z', now)).toBe('вчера')
        expect(formatAgo('2026-10-05T11:00:00Z', now)).toBe('4 дн. назад')
        expect(formatAgo('2026-10-09T12:05:00Z', now)).toBe('только что') // часы устройства спешат
        expect(formatAgo('мусор', now)).toBe('')
    })
})

/** События «из базы» с убывающим временем: key возрастает с номером, время убывает. */
function db(total: number) {
    const rows: FeedRow[] = Array.from({ length: total }, (_, i) => ({
        kind: 'favorite',
        at: new Date(Date.parse('2026-10-09T12:00:00Z') - i * 60_000).toISOString().replace('Z', '000+00:00'),
        key: `favorite:${String(i).padStart(4, '0')}`,
        user: i % 2 ? BOB : YANA,
        track_id: i % 3 ? 'beta/solo' : 'alpha/one'
    }))
    const calls: ({ at: string; key: string } | null)[] = []
    const fetch = async (before: { at: string; key: string } | null, limit: number): Promise<FeedPage> => {
        calls.push(before)
        const start = before ? rows.findIndex((r) => r.key === before.key) + 1 : 0
        const events = rows.slice(start, start + limit)
        return { events, has_more: start + limit < rows.length }
    }
    return { rows, calls, fetch }
}

describe('лента: загрузчик', () => {
    function loader(total: number, clock = { t: 1_000_000 }) {
        const d = db(total)
        let failNext = 0
        const feed = createFeed({
            fetch: async (before, limit) => {
                if (failNext > 0) {
                    failNext--
                    throw new Error('сеть')
                }
                return d.fetch(before, limit)
            },
            now: () => clock.t,
            releases: RELEASES
        })
        return { feed, d, clock, fail: (k = 1) => (failNext = k) }
    }

    it('первая загрузка, «Показать ещё» по курсору последней строки, без дублей и пропусков', async () => {
        const { feed, d } = loader(100)
        expect(feed.state.status).toBe('idle')
        await feed.refresh()
        expect(feed.state.status).toBe('ready')
        expect(feed.state.events).toHaveLength(FEED_PAGE_SIZE)
        expect(feed.state.hasMore).toBe(true)
        await feed.loadMore()
        await feed.loadMore()
        expect(feed.state.events.map((e) => e.key)).toEqual(d.rows.map((r) => r.key))
        expect(feed.state.hasMore).toBe(false)
        // Курсор — ключ последней строки предыдущей страницы.
        expect(d.calls.map((c) => c?.key ?? null)).toEqual([null, d.rows[FEED_PAGE_SIZE - 1].key, d.rows[FEED_PAGE_SIZE * 2 - 1].key])
        // Когда больше нечего показывать, запросов нет.
        await feed.loadMore()
        expect(d.calls).toHaveLength(3)
    })

    it('обновление — не чаще раза в минуту; принудительное проходит', async () => {
        const { feed, d, clock } = loader(10)
        expect(await feed.refresh()).toBe(true)
        expect(await feed.refresh()).toBe(false)
        clock.t += FEED_MIN_POLL_MS - 1
        expect(await feed.refresh()).toBe(false)
        expect(d.calls).toHaveLength(1)
        clock.t += 1
        expect(await feed.refresh()).toBe(true)
        expect(d.calls).toHaveLength(2)
        expect(await feed.refresh(true)).toBe(true)
        expect(d.calls).toHaveLength(3)
    })

    it('одновременные вызовы не плодят запросы', async () => {
        const { feed, d } = loader(100)
        await Promise.all([feed.refresh(), feed.refresh(), feed.refresh()])
        expect(d.calls).toHaveLength(1)
        await Promise.all([feed.loadMore(), feed.loadMore()])
        expect(d.calls).toHaveLength(2)
    })

    it('ошибка первой загрузки — статус error, дальше можно повторить; ошибка «ещё» не стирает показанное', async () => {
        const { feed, fail, clock } = loader(100)
        fail()
        await feed.refresh()
        expect(feed.state.status).toBe('error')
        expect(feed.state.events).toEqual([])
        // Повтор сразу (после ошибки минутное ожидание не действует).
        await feed.refresh()
        expect(feed.state.status).toBe('ready')
        fail()
        await feed.loadMore()
        expect(feed.state.moreFailed).toBe(true)
        expect(feed.state.events).toHaveLength(FEED_PAGE_SIZE)
        expect(feed.state.loadingMore).toBe(false)
        await feed.loadMore()
        expect(feed.state.moreFailed).toBe(false)
        expect(feed.state.events).toHaveLength(FEED_PAGE_SIZE * 2)
        // Ошибка обновления при уже показанной ленте оставляет её как есть.
        clock.t += FEED_MIN_POLL_MS
        fail()
        await feed.refresh()
        expect(feed.state.status).toBe('ready')
        expect(feed.state.events).toHaveLength(FEED_PAGE_SIZE * 2)
    })

    it('обновление добавляет новое сверху и сохраняет уже подгруженное', async () => {
        const { feed, d, clock } = loader(100)
        await feed.refresh()
        await feed.loadMore()
        expect(feed.state.events).toHaveLength(FEED_PAGE_SIZE * 2)
        // В базе появилось новое событие.
        d.rows.unshift({ ...d.rows[0], key: 'favorite:new', at: '2026-10-09T12:01:00.000000+00:00', track_id: 'beta/solo' })
        clock.t += FEED_MIN_POLL_MS
        await feed.refresh()
        expect(feed.state.events[0].key).toBe('favorite:new')
        expect(new Set(feed.state.events.map((e) => e.key)).size).toBe(feed.state.events.length)
        expect(feed.state.events.length).toBeGreaterThanOrEqual(FEED_PAGE_SIZE * 2)
        expect(feed.state.hasMore).toBe(true)
    })

    it('курсор идёт по сырым строкам: непоказанные события (пропавший трек) не застревают на границе страницы', async () => {
        const d = db(50)
        // Вся первая страница — про трек, которого нет в каталоге.
        for (let i = 0; i < FEED_PAGE_SIZE; i++) d.rows[i] = { ...d.rows[i], track_id: 'gone/x' }
        const feed = createFeed({ fetch: d.fetch, now: () => 0, releases: RELEASES })
        await feed.refresh()
        expect(feed.state.events).toEqual([])
        expect(feed.state.hasMore).toBe(true)
        await feed.loadMore()
        expect(feed.state.events).toHaveLength(10)
    })

    it('серия прослушиваний одного человека в выдаче сворачивается в одну строку', async () => {
        const rows: FeedRow[] = Array.from({ length: 6 }, (_, i) => ({ kind: 'listen', at: `2026-10-09T10:00:0${9 - i}.000000+00:00`, key: `listen:${String(9 - i).padStart(20, '0')}`, user: YANA, track_key: 'alpha-0' }))
        const feed = createFeed({
            fetch: async (before, limit) => {
                const start = before ? rows.findIndex((r) => r.key === before.key) + 1 : 0
                return { events: rows.slice(start, start + limit), has_more: start + limit < rows.length }
            },
            now: () => 0,
            releases: RELEASES
        })
        await feed.refresh()
        expect(feed.state.events).toHaveLength(1)
        expect(feed.state.events[0]).toMatchObject({ kind: 'listen', more: 5 })
    })

    it('reset() забывает всё (выход из аккаунта)', async () => {
        const { feed } = loader(10)
        await feed.refresh()
        feed.reset()
        expect(feed.state).toMatchObject({ events: [], status: 'idle', hasMore: false, loadedAt: 0 })
        expect(await feed.refresh()).toBe(true)
    })
})
