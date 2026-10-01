import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/supabaseConfig'

// Своё хранилище сессии: у сайта и админки общий origin, и без отдельного
// ключа сайт подхватил бы сессию админа и ходил бы в базу от его имени.
export const ADMIN_STORAGE_KEY = 'frnk-admin-auth'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storageKey: ADMIN_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
    }
})

export { SUPABASE_URL, SUPABASE_ANON_KEY }
