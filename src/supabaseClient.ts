import { createClient } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL } from './supabaseConfig'

/**
 * Единственный клиент Supabase на странице — у сайта и у админки он общий
 * по хранилищу сессии (AUTH_STORAGE_KEY): вход на сайте действует и в
 * админке. Запросы идут от имени вошедшего (RLS, RPC статистики).
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
    }
})
