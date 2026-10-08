-- Аудит прав «кода восстановления и тегов» (только чтение; выполнять в SQL Editor
-- после db push). Что должно получиться, написано в строке "ожидается" рядом.

-- 1. RLS включён на новых таблицах (ожидается: три строки true).
select '1 rls' as section, c.relname as item, c.relrowsecurity::text as value
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('recovery_codes', 'user_tags', 'user_tag_assignments')
order by 2;

-- 2. Права на таблицы и счётчик тегов: у anon и authenticated — НИКАКИХ (ожидается: ноль строк).
select '2 table grants (ожидается пусто)' as section, table_name as item, grantee || ': ' || privilege_type as value
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('recovery_codes', 'user_tags', 'user_tag_assignments')
  and grantee in ('anon', 'authenticated', 'public')
union all
select '2 table grants (ожидается пусто)', 'user_tags_id_seq', r.rolname || ': ' || p.priv
from pg_roles r
cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as p(priv)
where r.rolname in ('anon', 'authenticated')
  and has_sequence_privilege(r.rolname, 'public.user_tags_id_seq', p.priv)
order by 2, 3;

-- 3. Политики на новые таблицы (ожидается: ноль строк — доступ только через RPC и service role).
select '3 table policies (ожидается пусто)' as section, tablename as item, policyname as value
from pg_policies
where schemaname = 'public' and tablename in ('recovery_codes', 'user_tags', 'user_tag_assignments');

-- 4. Кто может вызывать функции. Ожидается:
--   recovery_code_set / _consume / _confirm — anon=false authenticated=false (только service role);
--   tags_all, my_recovery_code_state — anon=false authenticated=true;
--   owner_tag_create / _update / _delete и owner_user_set_tag — anon=false authenticated=true
--     (внутри проверка is_owner(): обычному пользователю и админу — «Нет доступа»);
--   tags_limit, tag_clean_name, tag_clean_color, tag_json, require_owner — оба false.
select '4 functions' as section, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as item,
       'anon=' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
       || ' service_role=' || has_function_privilege('service_role', p.oid, 'execute') as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('recovery_code_set', 'recovery_code_consume', 'recovery_code_confirm', 'my_recovery_code_state', 'tags_all',
                    'owner_tag_create', 'owner_tag_update', 'owner_tag_delete', 'owner_user_set_tag',
                    'tags_limit', 'tag_clean_name', 'tag_clean_color', 'tag_json', 'require_owner')
order by 2;

-- 5. security definer функции с фиксированным search_path (ожидается: search_path="").
select '5 search_path' as section, p.proname as item, coalesce(array_to_string(p.proconfig, ','), 'НЕТ search_path!') as value
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and p.proname in ('recovery_code_set', 'recovery_code_consume', 'recovery_code_confirm', 'my_recovery_code_state', 'tags_all',
                    'owner_tag_create', 'owner_tag_update', 'owner_tag_delete', 'owner_user_set_tag', 'require_owner')
order by 2;

-- 6. В recovery_codes только хеши (ожидается: 0 строк с кодом не из 64 hex-символов).
select '6 only hashes (ожидается 0)' as section, 'не хеш' as item, count(*)::text as value
from public.recovery_codes where code_hash !~ '^[0-9a-f]{64}$';

-- 7. Все цвета тегов в формате #rrggbb (ожидается: 0 неверных).
select '7 colors (ожидается 0)' as section, 'неверный цвет' as item, count(*)::text as value
from public.user_tags where color !~ '^#[0-9a-f]{6}$';

-- 8. Справочно: сколько тегов, назначений и кодов.
select '8 counts' as section, 'теги' as item, count(*)::text as value from public.user_tags
union all select '8 counts', 'назначения', count(*)::text from public.user_tag_assignments
union all select '8 counts', 'коды', count(*)::text from public.recovery_codes;
