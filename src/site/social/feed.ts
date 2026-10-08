import { shallowReactive } from 'vue'
import type { Releases } from '@/types'
import { findTrackById, statsKeyToTrackId } from '@/utils/trackIds'
import type { FeedPage, FeedRow, Profile } from './api'

/**
 * Лента «Что слушают друзья»: события друзей за 7 дней, от новых к старым.
 * База (friends_feed) отдаёт только принятых друзей; здесь — разбор строк,
 * сворачивание подряд идущих прослушиваний одного человека и загрузчик
 * («Показать ещё» по курсору, обновление не чаще раза в минуту).
 * Тексты (ники, названия плейлистов и комнат) сюда приходят как есть и
 * выводятся в шаблонах только интерполяцией, то есть с экранированием.
 */

export type FeedEvent =
    | { kind: 'listen'; key: string; at: string; user: Profile; trackId: string; more: number }
    | { kind: 'favorite'; key: string; at: string; user: Profile; trackId: string }
    | { kind: 'playlist'; key: string; at: string; user: Profile; playlist: { id: string; title: string } }
    | { kind: 'top4'; key: string; at: string; user: Profile; trackIds: string[] }
    | { kind: 'room'; key: string; at: string; user: Profile; canJoin: boolean; room: { id: string; title: string } | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isStr = (v: unknown): v is string => typeof v === 'string'

function parseUser(raw: unknown): Profile | null {
    const u = raw as Partial<Profile> | null
    return u && isStr(u.id) && isStr(u.nick) && isStr(u.avatar) ? { id: u.id, nick: u.nick, avatar: u.avatar } : null
}

/**
 * Строка базы → событие. Всё неожиданное (чужой вид события, битые поля,
 * трек, которого нет в каталоге) — null: событие просто не показывается.
 */
export function parseFeedRow(row: FeedRow, releases: Releases): FeedEvent | null {
    if (!row || !isStr(row.key) || !isStr(row.at) || Number.isNaN(Date.parse(row.at))) return null
    const user = parseUser(row.user)
    if (!user) return null
    const base = { key: row.key, at: row.at, user }
    switch (row.kind) {
        case 'listen': {
            const trackId = isStr(row.track_key) ? statsKeyToTrackId(releases, row.track_key) : null
            return trackId ? { kind: 'listen', ...base, trackId, more: 0 } : null
        }
        case 'favorite':
            return isStr(row.track_id) && findTrackById(releases, row.track_id) ? { kind: 'favorite', ...base, trackId: row.track_id } : null
        case 'playlist':
            return row.playlist && isStr(row.playlist.id) && UUID.test(row.playlist.id) && isStr(row.playlist.title)
                ? { kind: 'playlist', ...base, playlist: { id: row.playlist.id, title: row.playlist.title } }
                : null
        case 'top4': {
            const ids = Array.isArray(row.track_ids) ? row.track_ids.filter((id): id is string => isStr(id) && findTrackById(releases, id) !== null) : []
            return ids.length ? { kind: 'top4', ...base, trackIds: ids } : null
        }
        case 'room': {
            const r = row.room
            const canJoin = row.can_join === true && Boolean(r) && isStr(r!.id) && UUID.test(r!.id) && isStr(r!.title)
            return { kind: 'room', ...base, canJoin, room: canJoin ? { id: r!.id, title: r!.title } : null }
        }
        default:
            return null
    }
}

/**
 * Подряд идущие прослушивания одного человека → одна строка («и ещё N»).
 * Показывается самое свежее; любое другое событие (чужое или другого вида)
 * прерывает серию.
 */
export function collapseListens(events: readonly FeedEvent[]): FeedEvent[] {
    const out: FeedEvent[] = []
    for (const e of events) {
        const last = out[out.length - 1]
        if (e.kind === 'listen' && last?.kind === 'listen' && last.user.id === e.user.id) {
            out[out.length - 1] = { ...last, more: last.more + 1 }
        } else {
            out.push(e.kind === 'listen' ? { ...e } : e)
        }
    }
    return out
}

/** «только что», «15 мин назад», «3 ч назад», «вчера», «4 дн. назад». */
export function formatAgo(iso: string, nowMs: number): string {
    const t = Date.parse(iso)
    if (Number.isNaN(t)) return ''
    const min = Math.floor((nowMs - t) / 60_000)
    if (min < 1) return 'только что'
    if (min < 60) return `${min} мин назад`
    const hours = Math.floor(min / 60)
    if (hours < 24) return `${hours} ч назад`
    const days = Math.floor(hours / 24)
    return days === 1 ? 'вчера' : `${days} дн. назад`
}

/** Обновление ленты — не чаще раза в минуту. */
export const FEED_MIN_POLL_MS = 60_000
export const FEED_PAGE_SIZE = 40

export interface FeedDeps {
    fetch(before: { at: string; key: string } | null, limit: number): Promise<FeedPage>
    now(): number
    releases: Releases
}

export interface FeedState {
    events: FeedEvent[]
    status: 'idle' | 'loading' | 'ready' | 'error'
    hasMore: boolean
    loadingMore: boolean
    moreFailed: boolean
    loadedAt: number
}

/** Одна лента на вкладку: общая для переходов туда-обратно (кэш живёт минуту). */
export function createFeed(deps: FeedDeps, state: FeedState = shallowReactive<FeedState>({ events: [], status: 'idle', hasMore: false, loadingMore: false, moreFailed: false, loadedAt: 0 })) {
    let seq = 0
    let inflight: Promise<void> | null = null
    /** Курсор следующей страницы — по последней СЫРОЙ строке (в том числе непоказанной). */
    let cursor: { at: string; key: string } | null = null
    /** Сырые события (до сворачивания); сворачиваем при показе. */
    let raw: FeedEvent[] = []

    const publish = () => {
        state.events = collapseListens(raw)
    }

    function parsePage(page: FeedPage): FeedEvent[] {
        const out: FeedEvent[] = []
        for (const row of page?.events ?? []) {
            const e = parseFeedRow(row, deps.releases)
            if (e) out.push(e)
        }
        return out
    }

    const lastCursor = (page: FeedPage) => {
        const last = page?.events?.[page.events.length - 1]
        return last && isStr(last.at) && isStr(last.key) ? { at: last.at, key: last.key } : null
    }

    /**
     * Загрузить свежую первую страницу. Без force — не чаще FEED_MIN_POLL_MS
     * (первая загрузка всегда проходит). Возвращает true, если запрос ушёл.
     */
    async function refresh(force = false): Promise<boolean> {
        if (inflight) return false
        if (!force && state.status === 'ready' && deps.now() - state.loadedAt < FEED_MIN_POLL_MS) return false
        const my = ++seq
        if (state.status !== 'ready') state.status = 'loading'
        const run = (async () => {
            try {
                const page = await deps.fetch(null, FEED_PAGE_SIZE)
                if (my !== seq) return
                const fresh = parsePage(page)
                const newCursor = lastCursor(page)
                const keys = new Set(fresh.map((e) => e.key))
                // Уже подгруженные «старые» страницы не выбрасываем.
                const keepTail = page.has_more && state.hasMore && cursor && newCursor && raw.length > 0
                const tail = keepTail ? raw.filter((e) => !keys.has(e.key) && Date.parse(e.at) < Date.parse(newCursor.at)) : []
                raw = [...fresh, ...tail]
                if (!keepTail || !tail.length) {
                    cursor = newCursor
                    state.hasMore = Boolean(page.has_more)
                }
                state.status = 'ready'
                state.loadedAt = deps.now()
                state.moreFailed = false
                publish()
            } catch {
                if (my !== seq) return
                // Уже показанное остаётся; пустая лента получает ошибку.
                if (state.status !== 'ready') state.status = 'error'
            }
        })()
        const tracked = run.finally(() => {
            if (inflight === tracked) inflight = null
        })
        inflight = tracked
        await tracked
        return true
    }

    async function loadMore(): Promise<void> {
        if (inflight || state.loadingMore || !state.hasMore || !cursor || state.status !== 'ready') return
        const my = seq
        const before = cursor
        state.loadingMore = true
        state.moreFailed = false
        try {
            const page = await deps.fetch(before, FEED_PAGE_SIZE)
            if (my !== seq) return
            const keys = new Set(raw.map((e) => e.key))
            raw = [...raw, ...parsePage(page).filter((e) => !keys.has(e.key))]
            cursor = lastCursor(page) ?? cursor
            state.hasMore = Boolean(page.has_more) && lastCursor(page) !== null
            publish()
        } catch {
            if (my === seq) state.moreFailed = true
        } finally {
            if (my === seq) state.loadingMore = false
        }
    }

    function reset(): void {
        seq++
        inflight = null
        cursor = null
        raw = []
        state.events = []
        state.status = 'idle'
        state.hasMore = false
        state.loadingMore = false
        state.moreFailed = false
        state.loadedAt = 0
    }

    return { state, refresh, loadMore, reset }
}
