import { SUPABASE_PROXY_URL, SUPABASE_URL } from './supabaseConfig'
import { createRouter } from './supabaseRoute'

/**
 * Единый маршрутизатор запросов к Supabase (напрямую или через посредника).
 * Без посредника (SUPABASE_PROXY_URL пустой) `routedFetch` — обычный fetch,
 * `toActiveUrl` возвращает ссылку как есть.
 */
export const router = createRouter({ directUrl: SUPABASE_URL, proxyUrl: SUPABASE_PROXY_URL })
export const routedFetch = router.fetch
export const toActiveUrl = router.toActiveUrl
