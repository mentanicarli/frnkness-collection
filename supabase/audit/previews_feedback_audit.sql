-- Аудит прав «списка пользователей, журнала ошибок и обращений» (только чтение;
-- выполнять в SQL Editor после db push). Что должно получиться, написано в
-- строке "ожидается" рядом с каждым пунктом.

-- 1. RLS включён на новых таблицах (ожидается: две строки true).
select '1 rls' as section, c.relname as item, c.relrowsecurity::text as value
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('client_errors', 'feedback_reports')
order by 2;

-- 2. Права на таблицы и счётчики: у anon и authenticated — НИКАКИХ (ожидается: ноль строк).
select '2 table grants (ожидается пусто)' as section, table_name as item, grantee || ': ' || privilege_type as value
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('client_errors', 'feedback_reports')
  and grantee in ('anon', 'authenticated', 'public')
union all
select '2 table grants (ожидается пусто)', s.seq, r.rolname || ': ' || p.priv
from pg_roles r
cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as p(priv)
cross join (values ('public.client_errors_id_seq'), ('public.feedback_reports_id_seq')) as s(seq)
where r.rolname in ('anon', 'authenticated')
  and has_sequence_privilege(r.rolname, s.seq, p.priv)
order by 2, 3;

-- 3. Политики на новые таблицы (ожидается: ноль строк — доступ только через RPC и service role).
select '3 table policies (ожидается пусто)' as section, tablename as item, policyname as value
from pg_policies
where schemaname = 'public' and tablename in ('client_errors', 'feedback_reports');

-- 4. Кто может вызывать функции (ожидается:
--   log_client_error — anon=true authenticated=true (единственная открытая анониму);
--   остальные RPC — anon=false authenticated=true;
--   scrub_client_text и client_errors_site_cap — оба false).
select '4 functions' as section, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
       'anon=' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute') as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('list_discoverable_users', 'log_client_error', 'scrub_client_text', 'client_errors_site_cap', 'admin_errors_list', 'admin_errors_resolve',
                    'submit_feedback', 'admin_feedback_list', 'admin_feedback_set', 'admin_feedback_new_count')
order by 2;

-- 5. Все security definer функции с фиксированным search_path (ожидается: search_path="").
select '5 search_path' as section, p.proname as item, coalesce(array_to_string(p.proconfig, ','), 'НЕТ search_path!') as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and p.proname in ('list_discoverable_users', 'log_client_error', 'admin_errors_list', 'admin_errors_resolve', 'submit_feedback',
                    'admin_feedback_list', 'admin_feedback_set', 'admin_feedback_new_count')
order by 2;

-- 6. Объём журнала ошибок за последний час и потолок сайта (ожидается: не больше 500).
select '6 error log load' as section, 'записей за час' as item, count(*)::text as value
from public.client_errors where created_at > now() - interval '1 hour';

-- 7. Обращения: сколько новых (справочно).
select '7 feedback' as section, status as item, count(*)::text as value
from public.feedback_reports group by status order by 2;
