-- Аудит прав «Топ-4, ленты и реакций» (только чтение; выполнять в SQL Editor после db push).
-- Что должно получиться, написано в строке "ожидается" рядом с каждым пунктом.

-- 1. RLS включён на всех новых таблицах (ожидается: четыре строки true).
select '1 rls' as section, c.relname as item, c.relrowsecurity::text as value
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('profile_top4', 'profile_top4_saves', 'feed_prefs', 'room_visits')
order by 2;

-- 2. Права на таблицы и счётчик журнала: у anon и authenticated — НИКАКИХ (ожидается: ноль строк).
select '2 table grants (ожидается пусто)' as section, table_name as item, grantee || ': ' || privilege_type as value
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('profile_top4', 'profile_top4_saves', 'feed_prefs', 'room_visits')
  and grantee in ('anon', 'authenticated', 'public')
union all
select '2 table grants (ожидается пусто)', 'room_visits_id_seq', r.rolname || ': ' || p.priv
from pg_roles r
cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as p(priv)
where r.rolname in ('anon', 'authenticated')
  and has_sequence_privilege(r.rolname, 'public.room_visits_id_seq', p.priv)
order by 2, 3;

-- 3. Политики на новые таблицы (ожидается: ноль строк — доступ только через RPC и service role).
select '3 table policies (ожидается пусто)' as section, tablename as item, policyname as value
from pg_policies
where schemaname = 'public' and tablename in ('profile_top4', 'profile_top4_saves', 'feed_prefs', 'room_visits');

-- 4. Политики Realtime для реакций (ожидается ровно две: слушают и шлют участники
-- топика roomfx:…; в условии нет «true» без проверки комнаты). Всего на
-- realtime.messages вместе с комнатными должно быть пять политик.
select '4 realtime policies' as section, policyname as item, cmd || ' to ' || array_to_string(roles, ',') || ' :: ' || coalesce(qual, '') || coalesce(with_check, '') as value
from pg_policies
where schemaname = 'realtime' and tablename = 'messages' and policyname like 'rooms: members % reactions'
order by 2;

-- 5. Кто может вызывать функции (ожидается: RPC — authenticated да, anon нет;
-- внутренние помощники user_is_live и top4_json — никто, кроме владельца базы;
-- room_react_access открыта authenticated, потому что её вызывает политика).
select '5 functions' as section, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
       'anon=' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute') as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('top4_set', 'user_top4', 'feed_prefs_get', 'feed_prefs_set', 'friends_feed', 'user_is_live', 'top4_json', 'room_react_access', 'admin_user_social', 'room_visits_on_join', 'room_visits_on_leave')
order by 2;

-- 6. Все новые функции работают с фиксированным search_path (ожидается: config содержит search_path="").
select '6 search_path' as section, p.proname as item, coalesce(array_to_string(p.proconfig, ','), 'НЕТ search_path!') as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and p.proname in ('top4_set', 'user_top4', 'feed_prefs_get', 'feed_prefs_set', 'friends_feed', 'user_is_live', 'top4_json', 'room_react_access', 'admin_user_social', 'room_visits_on_join', 'room_visits_on_leave')
order by 2;

-- 7. Индексы ленты (ожидается: по прослушиваниям и избранному — по пользователю и времени;
-- по публичным плейлистам — свой).
select '7 indexes' as section, indexname as item, indexdef as value
from pg_indexes
where schemaname = 'public'
  and indexname in ('play_events_user_idx', 'favorites_user_idx', 'playlists_public_created_idx', 'profile_top4_saves_at_idx')
order by 2;

-- 8. Состояние: сколько человек заполнили топ-4 и скрыли прослушивания (без ников и треков).
select '8 counts' as section, 'top4 users' as item, count(*)::text as value from public.profile_top4_saves
union all
select '8 counts', 'hide listens', count(*)::text from public.feed_prefs where hide_listens
union all
select '8 counts', 'room visits', count(*)::text from public.room_visits
union all
select '8 counts', 'room visits open', count(*)::text from public.room_visits where left_at is null;
