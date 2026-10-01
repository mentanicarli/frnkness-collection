-- Аудит текущей статистики перед миграциями админки. Только чтение.
-- Выполни целиком в Supabase → SQL Editor и пришли результат (Export → CSV
-- или скриншот всей таблицы). Один запрос — одна таблица: редактор
-- показывает результат только последнего запроса.
with fn as (
    select p.oid,
           p.oid::regprocedure::text as sig,
           p.prosecdef,
           p.proconfig,
           pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'increment_play_count'
)
select '01 function' as section, sig as item, def as detail from fn
union all
select '01 function', sig, 'security_definer=' || prosecdef || ' config=' || coalesce(array_to_string(proconfig, ','), '-') from fn
union all
select '02 function grants', grantee::text, privilege_type::text
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'increment_play_count'
union all
select '03 columns', column_name::text, data_type || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-')
from information_schema.columns
where table_schema = 'public' and table_name = 'play_counts'
union all
select '04 rls', relname::text, 'enabled=' || relrowsecurity || ' forced=' || relforcerowsecurity
from pg_class where oid = to_regclass('public.play_counts')
union all
select '05 policies', policyname::text,
       cmd || ' roles=' || array_to_string(roles, ',') || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-')
from pg_policies where schemaname = 'public' and tablename = 'play_counts'
union all
select '06 table grants', grantee::text, string_agg(privilege_type::text, ',' order by privilege_type)
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'play_counts'
group by grantee
union all
select '07 indexes', indexname::text, indexdef from pg_indexes where schemaname = 'public' and tablename = 'play_counts'
union all
select '08 triggers', tgname::text, pg_get_triggerdef(t.oid)
from pg_trigger t where tgrelid = to_regclass('public.play_counts') and not tgisinternal
union all
select '09 name conflicts', p.proname::text, n.nspname::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname = 'is_admin' or p.proname like 'admin\_%')
union all
select '09 name conflicts', 'table play_events', coalesce(to_regclass('public.play_events')::text, 'нет')
union all
select '09 name conflicts', 'bucket admin-uploads', coalesce((select id from storage.buckets where id = 'admin-uploads'), 'нет')
union all
select '10 data', 'rows / plays', count(*) || ' / ' || coalesce(sum(plays), 0) from public.play_counts
union all
select '11 other functions', p.oid::regprocedure::text, case when p.prosecdef then 'security definer' else 'invoker' end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f'
order by 1, 2;
