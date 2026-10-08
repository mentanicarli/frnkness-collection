-- Этап «Код восстановления и теги пользователей».
--
-- Что здесь:
--   — recovery_codes: хеш одноразового кода восстановления пароля (по одному
--     на пользователя; новый код заменяет старый). Хранится только хеш
--     (HMAC-SHA256 с секретом функции, 64 hex-символа), открытого кода в базе
--     нет. Таблица закрыта от всех, кроме service role: код проверяют только
--     Edge Functions. Одноразовость — recovery_code_consume удаляет строку
--     одним запросом, поэтому два одновременных ввода одного кода не пройдут
--     оба. Сайт видит только my_recovery_code_state: «есть ли код, когда создан,
--     подтверждён ли»;
--   — user_tags и user_tag_assignments: теги пользователей. У человека один
--     тег или ни одного (первичный ключ user_id). Тег — только значок рядом
--     с ником, прав не даёт. Читают все вошедшие (tags_all), пишет только
--     владелец (owner_tag_*), цвет проверяется в базе: только #RRGGBB.
--     Удаление тега каскадом снимает его со всех.
--
-- Прямого доступа к таблицам нет ни у кого, кроме service role.

-- ── 1. Код восстановления ──────────────────────────────────────────────
create table if not exists public.recovery_codes (
    user_id uuid primary key references auth.users (id) on delete cascade,
    -- Только хеш: 64 hex-символа не вместят открытый код вида XXXX-XXXX-XXXX-XXXX.
    code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz not null default now(),
    -- Человек нажал «Я сохранил» на экране с кодом.
    confirmed boolean not null default false
);

alter table public.recovery_codes enable row level security;
revoke all on table public.recovery_codes from public, anon, authenticated;
grant all on table public.recovery_codes to service_role;

-- Новый код отменяет старый: строка заменяется целиком.
create or replace function public.recovery_code_set(p_user uuid, p_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.recovery_codes as c (user_id, code_hash, created_at, confirmed)
    values (p_user, p_hash, now(), false)
    on conflict (user_id) do update
        set code_hash = excluded.code_hash, created_at = excluded.created_at, confirmed = false;
end;
$$;

-- true — код подошёл и сгорел. Удаление и проверка — один запрос.
create or replace function public.recovery_code_consume(p_user uuid, p_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    n integer;
begin
    delete from public.recovery_codes c where c.user_id = p_user and c.code_hash = p_hash;
    get diagnostics n = row_count;
    return n > 0;
end;
$$;

create or replace function public.recovery_code_confirm(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.recovery_codes c set confirmed = true where c.user_id = p_user;
end;
$$;

revoke all on function public.recovery_code_set(uuid, text) from public, anon, authenticated;
revoke all on function public.recovery_code_consume(uuid, text) from public, anon, authenticated;
revoke all on function public.recovery_code_confirm(uuid) from public, anon, authenticated;
grant execute on function public.recovery_code_set(uuid, text) to service_role;
grant execute on function public.recovery_code_consume(uuid, text) to service_role;
grant execute on function public.recovery_code_confirm(uuid) to service_role;

-- Состояние своего кода: сам хеш сайту не отдаётся.
create or replace function public.my_recovery_code_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    r public.recovery_codes;
begin
    select * into r from public.recovery_codes c where c.user_id = uid;
    if not found then
        return jsonb_build_object('exists', false, 'created_at', null, 'confirmed', false);
    end if;
    return jsonb_build_object('exists', true, 'created_at', r.created_at, 'confirmed', r.confirmed);
end;
$$;

revoke all on function public.my_recovery_code_state() from public, anon;
grant execute on function public.my_recovery_code_state() to authenticated;

-- ── 2. Теги ────────────────────────────────────────────────────────────
create table if not exists public.user_tags (
    id bigint generated always as identity primary key,
    name text not null check (char_length(name) between 1 and 20 and name = btrim(name)),
    -- Только #rrggbb в нижнем регистре: так цвет безопасно попадает в стиль на сайте.
    color text not null check (color ~ '^#[0-9a-f]{6}$'),
    created_at timestamptz not null default now()
);
create unique index if not exists user_tags_name_key on public.user_tags (lower(name));

create table if not exists public.user_tag_assignments (
    -- Один пользователь — один тег.
    user_id uuid primary key references auth.users (id) on delete cascade,
    tag_id bigint not null references public.user_tags (id) on delete cascade,
    assigned_at timestamptz not null default now()
);
create index if not exists user_tag_assignments_tag_idx on public.user_tag_assignments (tag_id);

alter table public.user_tags enable row level security;
alter table public.user_tag_assignments enable row level security;
revoke all on table public.user_tags, public.user_tag_assignments from public, anon, authenticated;
grant all on table public.user_tags, public.user_tag_assignments to service_role;

-- Не больше 50 тегов: справочник читается целиком.
create or replace function public.tags_limit()
returns integer
language sql
immutable
set search_path = ''
as $$ select 50 $$;

-- Название: без управляющих символов, 1–20 символов.
create or replace function public.tag_clean_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
    t text := public.clean_user_text(p_name, false);
begin
    if char_length(t) < 1 or char_length(t) > 20 then
        raise exception 'Название тега — от 1 до 20 символов' using errcode = '22023';
    end if;
    return t;
end;
$$;

-- Цвет: только #RRGGBB (регистр не важен), хранится в нижнем.
create or replace function public.tag_clean_color(p_color text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
    if p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then
        raise exception 'Цвет — в формате #RRGGBB' using errcode = '22023';
    end if;
    return lower(p_color);
end;
$$;

create or replace function public.tag_json(t public.user_tags)
returns jsonb
language sql
immutable
set search_path = ''
as $$ select jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) $$;

-- Читают все вошедшие: справочник и «кто с каким тегом» (только активные
-- аккаунты — забаненные и удалённые не светятся).
create or replace function public.tags_all()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    perform public.require_active_user();
    return jsonb_build_object(
        'tags', coalesce((select jsonb_agg(public.tag_json(t) order by lower(t.name)) from public.user_tags t), '[]'::jsonb),
        'assignments', coalesce((
            select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'tag_id', a.tag_id))
            from public.user_tag_assignments a
            where public.user_is_live(a.user_id)
        ), '[]'::jsonb)
    );
end;
$$;

create or replace function public.require_owner()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_owner() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
end;
$$;

create or replace function public.owner_tag_create(p_name text, p_color text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    nm text;
    col text;
    t public.user_tags;
begin
    perform public.require_owner();
    nm := public.tag_clean_name(p_name);
    col := public.tag_clean_color(p_color);
    if (select count(*) from public.user_tags) >= public.tags_limit() then
        raise exception 'Слишком много тегов — удали ненужные' using errcode = '22023';
    end if;
    begin
        insert into public.user_tags (name, color) values (nm, col) returning * into t;
    exception when unique_violation then
        raise exception 'Тег с таким названием уже есть' using errcode = '23505';
    end;
    return public.tag_json(t);
end;
$$;

-- Название и цвет меняются в одном месте, поэтому сразу видны у всех, у кого тег стоит.
create or replace function public.owner_tag_update(p_id bigint, p_name text, p_color text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    nm text;
    col text;
    t public.user_tags;
begin
    perform public.require_owner();
    nm := public.tag_clean_name(p_name);
    col := public.tag_clean_color(p_color);
    begin
        update public.user_tags u set name = nm, color = col where u.id = p_id returning * into t;
    exception when unique_violation then
        raise exception 'Тег с таким названием уже есть' using errcode = '23505';
    end;
    if not found then
        raise exception 'Тег не найден' using errcode = 'P0002';
    end if;
    return public.tag_json(t);
end;
$$;

-- Удаление снимает тег со всех (каскад).
create or replace function public.owner_tag_delete(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_owner();
    delete from public.user_tags t where t.id = p_id;
    if not found then
        raise exception 'Тег не найден' using errcode = 'P0002';
    end if;
end;
$$;

-- p_tag = null — «без тега».
create or replace function public.owner_user_set_tag(p_user uuid, p_tag bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_owner();
    if not exists (select 1 from public.profiles p where p.id = p_user) then
        raise exception 'Пользователь не найден' using errcode = 'P0002';
    end if;
    if p_tag is null then
        delete from public.user_tag_assignments a where a.user_id = p_user;
        return;
    end if;
    if not exists (select 1 from public.user_tags t where t.id = p_tag) then
        raise exception 'Тег не найден' using errcode = 'P0002';
    end if;
    insert into public.user_tag_assignments as a (user_id, tag_id, assigned_at)
    values (p_user, p_tag, now())
    on conflict (user_id) do update set tag_id = excluded.tag_id, assigned_at = excluded.assigned_at;
end;
$$;

revoke all on function public.tags_limit() from public, anon, authenticated;
revoke all on function public.tag_clean_name(text) from public, anon, authenticated;
revoke all on function public.tag_clean_color(text) from public, anon, authenticated;
revoke all on function public.tag_json(public.user_tags) from public, anon, authenticated;
revoke all on function public.require_owner() from public, anon, authenticated;
revoke all on function public.tags_all() from public, anon;
revoke all on function public.owner_tag_create(text, text) from public, anon;
revoke all on function public.owner_tag_update(bigint, text, text) from public, anon;
revoke all on function public.owner_tag_delete(bigint) from public, anon;
revoke all on function public.owner_user_set_tag(uuid, bigint) from public, anon;

grant execute on function public.tags_all() to authenticated;
-- Эти четыре открыты authenticated, но внутри проверяют is_owner().
grant execute on function public.owner_tag_create(text, text) to authenticated;
grant execute on function public.owner_tag_update(bigint, text, text) to authenticated;
grant execute on function public.owner_tag_delete(bigint) to authenticated;
grant execute on function public.owner_user_set_tag(uuid, bigint) to authenticated;
