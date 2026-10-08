-- Аудит прав «Комнат» (только чтение; выполнять в SQL Editor после db push).
-- Что должно получиться, написано в строке "ожидается" рядом с каждым пунктом.

-- 1. RLS включён на всех таблицах комнат (ожидается: rls = true, force не нужен).
select '1 rls' as section, c.relname as item, c.relrowsecurity::text as value
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('rooms', 'room_members', 'room_kicks', 'room_invites')
order by 2;

-- 2. Права на таблицы: у anon и authenticated — НИКАКИХ (ожидается: ноль строк).
select '2 table grants (ожидается пусто)' as section, table_name as item, grantee || ': ' || privilege_type as value
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('rooms', 'room_members', 'room_kicks', 'room_invites')
  and grantee in ('anon', 'authenticated', 'public')
order by 2, 3;

-- 3. Политики на таблицы комнат (ожидается: ноль строк — доступ только через RPC).
select '3 table policies (ожидается пусто)' as section, tablename as item, policyname as value
from pg_policies
where schemaname = 'public' and tablename in ('rooms', 'room_members', 'room_kicks', 'room_invites');

-- 4. Политики Realtime на realtime.messages (ожидается ровно три: слушают участники,
-- команды — хозяин, присутствие — участники; никаких «using (true)»).
select '4 realtime policies' as section, policyname as item, cmd || ' to ' || array_to_string(roles, ',') || ' :: ' || coalesce(qual, '') || coalesce(with_check, '') as value
from pg_policies
where schemaname = 'realtime' and tablename = 'messages'
order by 2;

-- 5. Кто может вызывать функции комнат (ожидается: authenticated — да, anon — нет;
-- внутренние помощники — никто, кроме владельца базы).
select '5 functions' as section, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
       'anon=' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute') as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'room\_%' or p.proname like 'rooms\_%' or p.proname in ('server_now', 'epoch_ms', 'require_own_room', 'admin_user_room', 'admin_room_close'))
order by 2;

-- 6. Все функции комнат работают с фиксированным search_path (ожидается: config содержит search_path='').
select '6 search_path' as section, p.proname as item, coalesce(array_to_string(p.proconfig, ','), 'НЕТ search_path!') as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and (p.proname like 'room\_%' or p.proname like 'rooms\_%' or p.proname in ('server_now', 'admin_user_room', 'admin_room_close'))
order by 2;

-- 7. Триггер на бан и удаление аккаунта (ожидается: одна строка).
select '7 trigger' as section, tgname as item, tgenabled::text as value
from pg_trigger where tgname = 'rooms_on_user_blocked' and not tgisinternal;

-- 8. Состояние: открытые комнаты и участники (без email и без состояния плеера).
select '8 open rooms' as section, r.id::text as item, r.title || ' · участников ' || (select count(*) from public.room_members m where m.room_id = r.id) || ' · активность ' || r.last_activity as value
from public.rooms r where r.closed_at is null order by r.created_at;
