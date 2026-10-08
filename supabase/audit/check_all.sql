-- Проверить всё: права, закрытые таблицы и функции, роли, бакеты.
-- Только чтение, ничего не меняет. Выполнять целиком в Supabase → SQL Editor
-- после любого `db push` и после деплоя новых миграций.
--
-- Результат — одна таблица. В каждой строке «статус» = OK или ПРОБЛЕМА, а в
-- «деталях» перечислено, что именно не так. Все строки должны быть OK; что делать
-- с ПРОБЛЕМОЙ, написано в docs/operations.md (раздел «Проверка прав»).
--
-- Что проверяется:
--   1–7   таблицы public: RLS, политики, прямые права anon, PUBLIC и authenticated,
--         права на колонки профилей, счётчики (sequence);
--   8–12  функции public: что доступно анониму, права PUBLIC, внутренние помощники
--         закрыты, search_path у security definer, проверка роли внутри admin_*
--         и owner_*;
--   13–15 Realtime-политики комнат, бакеты Storage, триггер защиты аккаунтов;
--   16–18 владелец один; в recovery_codes только хеши; цвета и названия тегов.
--
-- Что изменилось намеренно (новая таблица для сайта, новая открытая функция) —
-- поправь списки «разрешено» ниже, в тех же строках, и опиши причину в миграции.

with
-- Таблицы public.
tbl as (
    select c.oid, c.relname, c.relrowsecurity, c.relowner, c.relacl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
),
-- Права на таблицы целиком: кому и что.
tbl_acl as (
    select t.relname, a.grantee, a.privilege_type
    from tbl t, aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
    where a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))
),
-- Права на отдельные колонки (профили открывают только часть колонок).
col_acl as (
    select c.relname, att.attname, a.grantee, a.privilege_type
    from pg_attribute att
    join pg_class c on c.oid = att.attrelid
    join pg_namespace n on n.oid = c.relnamespace,
    aclexplode(att.attacl) a
    where n.nspname = 'public' and att.attacl is not null and not att.attisdropped
      and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
),
-- Функции public (кроме функций расширений).
fn as (
    select p.oid, p.proname, p.prosecdef, p.proconfig, p.proowner, p.proacl,
           pg_get_functiondef(p.oid) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
-- ── РАЗРЕШЕНО (менять только осознанно) ──
-- Таблицы, которые authenticated читает напрямую (остальное — только через RPC).
ok_tables(name) as (
    values ('account_private'), ('favorites'), ('friendships'), ('now_playing'), ('play_counts'), ('playlist_tracks'), ('playlists')
),
-- Что можно анониму: сайт до входа.
ok_anon_functions(name) as (
    values ('keepalive'), ('log_client_error')
),
-- Внутренние помощники: сайту (authenticated) и анониму недоступны, зовутся только
-- из других функций, триггеров и Edge Functions (service role).
closed_functions(name) as (
    values ('account_nick_key'), ('account_tech_email'), ('admin_check_period'), ('auth_hook_send_email_noop'),
           ('clean_user_text'), ('client_errors_site_cap'), ('current_app_role'), ('epoch_ms'), ('fresh_now_playing'),
           ('friends_count'), ('guard_auth_users'), ('playlist_json'), ('playlist_tracks_limit'), ('playlists_limit'),
           ('profile_card'), ('rate_limit_hit'), ('recap_can_view'), ('recap_check_year'), ('recap_compute'),
           ('recovery_code_confirm'), ('recovery_code_consume'), ('recovery_code_set'), ('relation_to'),
           ('require_active_user'), ('require_own_playlist'), ('require_own_room'), ('require_owner'),
           ('room_close_internal'), ('room_json'), ('room_visits_on_join'), ('room_visits_on_leave'),
           ('rooms_on_user_blocked'), ('rooms_sweep'), ('scrub_client_text'), ('service_sign_out_user'),
           ('tag_clean_color'), ('tag_clean_name'), ('tag_json'), ('tags_limit'), ('top4_json'), ('user_is_live')
),
ok_realtime_policies(name) as (
    values ('rooms: members announce presence'), ('rooms: members hear reactions'), ('rooms: members listen'),
           ('rooms: members send reactions'), ('rooms: owner sends commands')
),
ok_buckets(id, is_public) as (
    values ('admin-uploads', false), ('avatars', true), ('playlist-covers', false)
),
checks(n, name, bad) as (
    -- 1
    select 1, 'таблицы public: RLS включён везде',
        (select string_agg(relname, ', ' order by relname) from tbl where not relrowsecurity)
    union all
    -- 2
    select 2, 'таблицы public: политики есть только у таблиц, которые читает сайт',
        (select string_agg(distinct tablename, ', ') from pg_policies p
         where p.schemaname = 'public' and p.tablename not in (select name from ok_tables) and p.tablename <> 'profiles')
    union all
    -- 3
    select 3, 'таблицы public: у anon нет никаких прав (ни на таблицы, ни на колонки)',
        (select string_agg(distinct x.relname || ' (' || x.privilege_type || ')', ', ')
         from (select relname, privilege_type from tbl_acl where grantee = (select oid from pg_roles where rolname = 'anon')
               union all select relname, privilege_type from col_acl where grantee = (select oid from pg_roles where rolname = 'anon')) x)
    union all
    -- 4
    select 4, 'таблицы public: у всех (PUBLIC) нет никаких прав',
        (select string_agg(distinct x.relname || ' (' || x.privilege_type || ')', ', ')
         from (select relname, privilege_type from tbl_acl where grantee = 0
               union all select relname, privilege_type from col_acl where grantee = 0) x)
    union all
    -- 5
    select 5, 'таблицы public: authenticated читает напрямую только разрешённые таблицы и ничего не пишет',
        (select string_agg(distinct a.relname || ' (' || a.privilege_type || ')', ', ')
         from tbl_acl a
         where a.grantee = (select oid from pg_roles where rolname = 'authenticated')
           and not (a.privilege_type = 'SELECT' and a.relname in (select name from ok_tables)))
    union all
    -- 6
    select 6, 'таблицы public: права на колонки — только профили (читать id, ник, аватар, «о себе», дату; менять аватар и «о себе»)',
        (select string_agg(distinct c.relname || '.' || c.attname || ' (' || c.privilege_type || ')', ', ')
         from col_acl c
         where not (
             c.relname = 'profiles'
             and c.grantee = (select oid from pg_roles where rolname = 'authenticated')
             and ((c.privilege_type = 'SELECT' and c.attname in ('id', 'nick', 'avatar', 'bio', 'created_at'))
                  or (c.privilege_type = 'UPDATE' and c.attname in ('avatar', 'bio')))))
    union all
    -- 7
    select 7, 'счётчики (sequence) public: у anon и authenticated нет прав',
        (select string_agg(c.relname || ' → ' || r.rolname, ', ')
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         cross join pg_roles r
         where n.nspname = 'public' and c.relkind = 'S' and r.rolname in ('anon', 'authenticated')
           and (has_sequence_privilege(r.rolname, c.oid, 'USAGE') or has_sequence_privilege(r.rolname, c.oid, 'SELECT')
                or has_sequence_privilege(r.rolname, c.oid, 'UPDATE')))
    union all
    -- 8
    select 8, 'функции public: аноним может вызвать только разрешённые',
        (select string_agg(proname, ', ' order by proname) from fn
         where has_function_privilege('anon', oid, 'execute') and proname not in (select name from ok_anon_functions))
    union all
    -- 9
    select 9, 'функции public: у всех (PUBLIC) нет права вызова',
        (select string_agg(distinct proname, ', ') from fn,
         aclexplode(coalesce(proacl, acldefault('f', proowner))) a
         where a.grantee = 0 and a.privilege_type = 'EXECUTE')
    union all
    -- 10
    select 10, 'функции public: внутренние помощники закрыты и для сайта, и для анонима',
        (select string_agg(proname, ', ' order by proname) from fn
         where proname in (select name from closed_functions)
           and (has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute')))
    union all
    -- 11
    select 11, 'функции public: у каждой security definer задан search_path',
        (select string_agg(proname, ', ' order by proname) from fn
         where prosecdef and not coalesce(proconfig::text, '') like '%search_path%')
    union all
    -- 12
    select 12, 'функции public: admin_* проверяют is_admin(), owner_* — is_owner(), прямо внутри',
        (select string_agg(proname, ', ' order by proname) from fn
         where has_function_privilege('authenticated', oid, 'execute')
           and ((proname like 'admin\_%' and def not like '%is\_admin()%')
             or (proname like 'owner\_%' and def not like '%is\_owner()%' and def not like '%require\_owner()%')))
    union all
    -- 13
    select 13, 'Realtime: ровно пять политик комнат и реакций',
        (select nullif(concat_ws('; ',
            (select 'нет: ' || string_agg(name, ', ') from ok_realtime_policies
             where name not in (select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages')),
            (select 'лишние: ' || string_agg(policyname, ', ') from pg_policies
             where schemaname = 'realtime' and tablename = 'messages' and policyname not in (select name from ok_realtime_policies))), ''))
    union all
    -- 14
    select 14, 'Storage: бакеты те же, приватные закрыты (admin-uploads, playlist-covers), аватары открыты',
        (select nullif(concat_ws('; ',
            (select 'нет или не тот доступ: ' || string_agg(o.id, ', ') from ok_buckets o
             where not exists (select 1 from storage.buckets b where b.id = o.id and b.public = o.is_public)),
            (select 'лишние: ' || string_agg(b.id, ', ') from storage.buckets b where b.id not in (select id from ok_buckets))), ''))
    union all
    -- 15
    select 15, 'аккаунты: защитный триггер на auth.users на месте и включён',
        (select case when exists (select 1 from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'guard_auth_users' and not t.tgisinternal and t.tgenabled <> 'D')
                     then null else 'нет (или выключен) триггер guard_auth_users' end)
    union all
    -- 16
    select 16, 'аккаунты: владелец ровно один',
        (select case when n = 1 then null else 'владельцев: ' || n end
         from (select count(*) as n from auth.users where raw_app_meta_data ->> 'role' = 'owner') o)
    union all
    -- 17
    select 17, 'код восстановления: в таблице только хеши (64 hex-символа)',
        (select case when n = 0 then null else 'не хешей: ' || n end
         from (select count(*) as n from public.recovery_codes where code_hash !~ '^[0-9a-f]{64}$') r)
    union all
    -- 18
    select 18, 'теги: цвета только #rrggbb, названия до 20 символов',
        (select case when n = 0 then null else 'неверных тегов: ' || n end
         from (select count(*) as n from public.user_tags where color !~ '^#[0-9a-f]{6}$' or char_length(name) not between 1 and 20) t)
)
select
    n as "№",
    name as "проверка",
    case when bad is null then 'OK' else 'ПРОБЛЕМА' end as "статус",
    coalesce(bad, '') as "детали"
from checks
order by n;
