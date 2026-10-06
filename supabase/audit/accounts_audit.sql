-- Аудит прав перед этапом «Аккаунты». Только чтение, ничего не меняет.
-- Выполни целиком в Supabase → SQL Editor и пришли результат (Export → CSV).
-- Один запрос — одна таблица: редактор показывает только последний результат.
--
-- Что смотрим: таблицы public и storage (RLS), политики, права anon /
-- authenticated / PUBLIC на таблицы, колонки, последовательности и функции,
-- тексты security definer функций, бакеты, права по умолчанию, триггеры,
-- realtime, расширения и сводку по ролям аккаунтов (без email).
with roles(oid, name) as (
    select 0::oid, 'PUBLIC'
    union all
    select r.oid, r.rolname from pg_roles r where r.rolname in ('anon', 'authenticated')
),
rels as (
    select c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relowner, c.relacl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
),
fns as (
    select p.oid, p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig, p.proowner, p.proacl, p.prokind
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
)
select '01 tables' as section,
       r.nspname || '.' || r.relname as item,
       'kind=' || r.relkind::text || ' rls=' || r.relrowsecurity || ' forced=' || r.relforcerowsecurity
           || ' owner=' || pg_get_userbyid(r.relowner) as detail
from rels r where r.relkind <> 'S'
union all
select '02 policies', p.schemaname || '.' || p.tablename || ' :: ' || p.policyname,
       p.cmd || ' ' || p.permissive || ' roles=' || array_to_string(p.roles, ',')
           || ' using=' || coalesce(p.qual, '-') || ' check=' || coalesce(p.with_check, '-')
from pg_policies p where p.schemaname in ('public', 'storage')
union all
select '03 table grants', r.nspname || '.' || r.relname || ' -> ' || ro.name,
       string_agg(a.privilege_type, ',' order by a.privilege_type)
from rels r
cross join lateral aclexplode(coalesce(r.relacl, acldefault(case when r.relkind = 'S' then 's' else 'r' end::"char", r.relowner))) a
join roles ro on ro.oid = a.grantee
group by r.nspname, r.relname, ro.name
union all
select '04 column grants', r.nspname || '.' || r.relname || '.' || att.attname || ' -> ' || ro.name,
       string_agg(a.privilege_type, ',' order by a.privilege_type)
from rels r
join pg_attribute att on att.attrelid = r.oid and att.attnum > 0 and not att.attisdropped and att.attacl is not null
cross join lateral aclexplode(att.attacl) a
join roles ro on ro.oid = a.grantee
group by r.nspname, r.relname, att.attname, ro.name
union all
select '05 functions', f.sig,
       case when f.prosecdef then 'SECURITY DEFINER' else 'invoker' end
           || ' kind=' || f.prokind::text
           || ' owner=' || pg_get_userbyid(f.proowner)
           || ' config=' || coalesce(array_to_string(f.proconfig, ','), '-')
           || ' execute=' || coalesce((
               select string_agg(ro.name, ',' order by ro.name)
               from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
               join roles ro on ro.oid = a.grantee
               where a.privilege_type = 'EXECUTE'
           ), '-')
from fns f
union all
select '06 definer source', f.sig, pg_get_functiondef(f.oid)
from fns f where f.prosecdef and f.prokind = 'f'
union all
select '06 definer source', 'normalize_track_key', pg_get_functiondef(f.oid)
from fns f where f.sig like 'normalize_track_key(%' and not f.prosecdef
union all
select '07 buckets', b.id,
       'public=' || b.public || ' size=' || coalesce(b.file_size_limit::text, '-')
           || ' mime=' || coalesce(array_to_string(b.allowed_mime_types, ','), '-')
from storage.buckets b
union all
select '07 bucket objects', o.bucket_id, count(*)::text from storage.objects o group by o.bucket_id
union all
select '08 default privileges',
       coalesce(n.nspname, '(все схемы)') || ' / ' || pg_get_userbyid(d.defaclrole) || ' / ' || d.defaclobjtype::text || ' -> ' || ro.name,
       string_agg(a.privilege_type, ',' order by a.privilege_type)
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
cross join lateral aclexplode(d.defaclacl) a
join roles ro on ro.oid = a.grantee
where n.nspname is null or n.nspname in ('public', 'storage')
group by n.nspname, d.defaclrole, d.defaclobjtype, ro.name
union all
select '09 schema usage', n.nspname || ' -> ' || ro.name, string_agg(a.privilege_type, ',' order by a.privilege_type)
from pg_namespace n
cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
join roles ro on ro.oid = a.grantee
where n.nspname in ('public', 'storage', 'auth', 'extensions', 'graphql_public')
group by n.nspname, ro.name
union all
select '10 triggers', c.relname || ' :: ' || t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))
union all
select '11 realtime', pt.schemaname || '.' || pt.tablename, pt.pubname
from pg_publication_tables pt
union all
select '12 extensions', e.extname, e.extversion || ' schema=' || e.extnamespace::regnamespace::text
from pg_extension e
union all
select '13 accounts by role', coalesce(u.raw_app_meta_data ->> 'role', '(нет роли)'),
       count(*) || ' акк., из них анонимных ' || count(*) filter (where u.is_anonymous)
           || ', забанено ' || count(*) filter (where u.banned_until > now())
from auth.users u
group by 2
union all
select '14 data', 'listen_sessions / play_events / play_counts',
       (select count(*) from public.listen_sessions) || ' / ' || (select count(*) from public.play_events)
           || ' / ' || (select count(*) from public.play_counts)
order by 1, 2;
