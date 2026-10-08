import { markSafeRpc } from '@/supabaseRoute'
// Клиент Supabase у админки общий с сайтом (одна сессия на origin): вошёл
// на сайте с ролью admin/owner — админка открывается без повторного входа.
export { supabase } from '@/supabaseClient'
export { AUTH_STORAGE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/supabaseConfig'

// Эти RPC админки только читают, их можно повторить по запасному маршруту
// (см. src/supabaseRoute.ts). Имена тут, а не в supabaseRoute.ts: код админки
// не должен попадать в бандл сайта.
markSafeRpc([
    'admin_users_list', 'admin_user_card', 'admin_user_social', 'admin_user_room', 'admin_users_overview',
    'admin_users_daily', 'owner_recovery_list', 'owner_recovery_new_count', 'admin_recap_overview',
    'admin_recap_status', 'admin_stats_overview', 'admin_stats_daily', 'admin_stats_daily_by_key',
    'admin_stats_by_key', 'admin_stats_all_time', 'admin_listen_meta', 'admin_listen_by_key',
    'admin_listen_retention', 'admin_feedback_list', 'admin_feedback_new_count'
])
