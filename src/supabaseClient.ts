import { createClient } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL } from './supabaseConfig'
import { router } from './supabaseNet'

/**
 * Единственный клиент Supabase на странице — у сайта и у админки он общий
 * по хранилищу сессии (AUTH_STORAGE_KEY): вход на сайте действует и в
 * админке. Запросы идут от имени вошедшего (RLS, RPC статистики).
 *
 * Клиент всегда создаётся с прямым адресом; если задан посредник
 * (SUPABASE_PROXY_URL), REST, auth, storage, functions и realtime идут через
 * router (src/supabaseRoute.ts): он подменяет адрес и сам переключает маршрут.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
    },
    ...(router.enabled
        ? {
              global: { fetch: router.fetch },
              realtime: {
                  fetch: router.fetch,
                  ...(typeof WebSocket === 'undefined' ? {} : { transport: router.webSocket(WebSocket) })
              }
          }
        : {})
})
