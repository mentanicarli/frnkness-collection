-- Аудит прав «Итогов года» (только чтение; выполнять в SQL Editor после db push).
-- Что должно получиться, написано в строке "ожидается" рядом с каждым пунктом.

-- 1. RLS включён на всех новых таблицах (ожидается: три строки true).
select '1 rls' as section, c.relname as item, c.relrowsecurity::text as value
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('recap_settings', 'recap_grants', 'recap_snapshots')
order by 2;

-- 2. Права на таблицы: у anon, authenticated и public — НИКАКИХ (ожидается: ноль строк).
select '2 table grants (ожидается пусто)' as section, table_name as item, grantee || ': ' || privilege_type as value
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('recap_settings', 'recap_grants', 'recap_snapshots')
  and grantee in ('anon', 'authenticated', 'public')
order by 2, 3;

-- 3. Политики на новые таблицы (ожидается: ноль строк — доступ только через RPC).
select '3 table policies (ожидается пусто)' as section, tablename as item, policyname as value
from pg_policies
where schemaname = 'public' and tablename in ('recap_settings', 'recap_grants', 'recap_snapshots');

-- 4. Кто может вызывать функции. Ожидается:
--   year_recap, my_recap_state, admin_recap_*  — authenticated да, anon нет;
--   recap_compute, recap_can_view, recap_check_year — никто (внутренние помощники).
select '4 functions' as section, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
       'anon=' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute') as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('year_recap', 'my_recap_state', 'admin_recap_overview', 'admin_recap_status', 'admin_recap_set', 'recap_compute', 'recap_can_view', 'recap_check_year')
order by 2;

-- 5. Все функции, кроме recap_check_year, — security definer с пустым search_path
-- (ожидается: config содержит search_path="").
select '5 search_path' as section, p.proname as item,
       case when p.prosecdef then 'definer' else 'invoker' end || ' / ' || coalesce(array_to_string(p.proconfig, ','), 'НЕТ search_path!') as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like '%recap%'
order by 2;

-- 6. Состояние: что открыто (без ников). Ожидается до публикации: ноль строк.
select '6 publication' as section, s.year::text as item, s.mode || ', исключений: ' || (select count(*) from public.recap_grants g where g.year = s.year) as value
from public.recap_settings s
order by s.year;

-- 7. Сколько итогов уже зафиксировано (по закончившимся годам).
select '7 snapshots' as section, year::text as item, count(*)::text as value
from public.recap_snapshots
group by year
order by year;
