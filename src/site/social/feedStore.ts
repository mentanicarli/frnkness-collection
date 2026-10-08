import { releases } from '@/config'
import { api } from './api'
import { createFeed } from './feed'

/**
 * Лента этой вкладки: одна на всё приложение, чтобы переход на другую
 * страницу и обратно не гонял запросы (кэш живёт минуту, см. FEED_MIN_POLL_MS).
 * При выходе из аккаунта сбрасывается (social/session.ts).
 */
export const feed = createFeed({
    fetch: (before, limit) => api.friendsFeed(before, limit),
    now: () => Date.now(),
    releases
})
