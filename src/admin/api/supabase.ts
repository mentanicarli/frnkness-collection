// Клиент Supabase у админки общий с сайтом (одна сессия на origin): вошёл
// на сайте с ролью admin/owner — админка открывается без повторного входа.
export { supabase } from '@/supabaseClient'
export { AUTH_STORAGE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/supabaseConfig'
