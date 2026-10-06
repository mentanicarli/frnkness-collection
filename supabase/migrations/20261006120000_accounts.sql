-- Этап «Аккаунты»: роли, профили, заявки на восстановление, лимиты,
-- статистика с привязкой к пользователю, бакет аватаров, исправления аудита.
--
-- Аккаунт = пользователь Supabase Auth с техническим адресом
-- u-<32 hex>@id.frnkness.ru (хеш нормализованного ника, см.
-- supabase/functions/_shared/accounts.ts). Почта не используется.
-- Роль — app_metadata.role: нет / 'user' — пользователь, 'admin', 'owner'.

-- ── 1. Исправления по аудиту 2026-10-06 ────────────────────────────────
-- Права по умолчанию в public выдавали anon/authenticated всё на новые
-- таблицы, последовательности и функции. Отзываем у всего, что есть, и
-- меняем умолчания: дальше каждое право выдаётся явно.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;

alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- Резервная копия счётчика: RLS был выключен, anon мог всё. Данные не трогаем.
do $$
begin
    if to_regclass('public.play_counts_backup') is not null then
        execute 'alter table public.play_counts_backup enable row level security';
    end if;
end
$$;

-- Чарт и счётчики — только для вошедших.
drop policy if exists "play_counts: public read" on public.play_counts;
drop policy if exists "play_counts: authenticated read" on public.play_counts;
create policy "play_counts: authenticated read" on public.play_counts
    for select to authenticated
    using (true);
grant select on table public.play_counts to authenticated;

-- ── 2. Роли ────────────────────────────────────────────────────────────
-- Роль читается из auth.users, а не из JWT: снятая роль, бан и удаление
-- действуют сразу, без ожидания истечения токена (до часа).
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(u.raw_app_meta_data ->> 'role', 'user')
    from auth.users u
    where u.id = auth.uid()
      and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
$$;

-- Вошедший, существующий и не забаненный пользователь.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.current_app_role() is not null
$$;

-- Админка: admin и owner.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(public.current_app_role() in ('admin', 'owner'), false)
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(public.current_app_role() = 'owner', false)
$$;

revoke all on function public.current_app_role() from public, anon, authenticated;
revoke all on function public.is_active_user() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_owner() to authenticated;

-- ── 3. Защита auth.users ───────────────────────────────────────────────
-- Действует и для service role (функции, admin API): владельца нельзя
-- удалить, забанить или понизить, роль owner выдаётся только вручную,
-- адрес аккаунта может быть только техническим.
-- Аварийный обход (только SQL Editor): set local app.owner_override = 'on';
create or replace function public.guard_auth_users()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    override boolean := coalesce(current_setting('app.owner_override', true), '') = 'on';
    old_role text;
    new_role text;
begin
    if override then
        return coalesce(new, old);
    end if;

    if tg_op = 'DELETE' then
        if old.raw_app_meta_data ->> 'role' = 'owner' then
            raise exception 'Владельца нельзя удалить' using errcode = '42501';
        end if;
        return old;
    end if;

    new_role := new.raw_app_meta_data ->> 'role';
    if new_role is not null and new_role not in ('user', 'admin', 'owner') then
        raise exception 'Неизвестная роль: %', new_role using errcode = '22023';
    end if;

    if tg_op = 'INSERT' then
        if new_role = 'owner' then
            raise exception 'Роль владельца выдаётся только вручную' using errcode = '42501';
        end if;
    else
        old_role := old.raw_app_meta_data ->> 'role';
        if old_role = 'owner' and new_role is distinct from 'owner' then
            raise exception 'Владельца нельзя понизить' using errcode = '42501';
        end if;
        if new_role = 'owner' and old_role is distinct from 'owner' then
            raise exception 'Роль владельца выдаётся только вручную' using errcode = '42501';
        end if;
        if old_role = 'owner' and new.banned_until is not null and new.banned_until > now() then
            raise exception 'Владельца нельзя забанить' using errcode = '42501';
        end if;
        if old_role = 'owner' and new.deleted_at is not null and old.deleted_at is null then
            raise exception 'Владельца нельзя удалить' using errcode = '42501';
        end if;
    end if;

    -- Только технический адрес: настоящий email (и смена адреса через
    -- updateUser) невозможны, письма уходить некуда.
    if (tg_op = 'INSERT' or new.email is distinct from old.email)
       and new.email is not null
       and new.email !~ '^u-[0-9a-f]{32}@id\.frnkness\.ru$' then
        raise exception 'Адрес аккаунта может быть только техническим' using errcode = '42501';
    end if;
    if coalesce(new.email_change, '') <> ''
       and (tg_op = 'INSERT' or new.email_change is distinct from old.email_change)
       and new.email_change !~ '^u-[0-9a-f]{32}@id\.frnkness\.ru$' then
        raise exception 'Адрес аккаунта может быть только техническим' using errcode = '42501';
    end if;

    return new;
end;
$$;

revoke all on function public.guard_auth_users() from public, anon, authenticated;

drop trigger if exists guard_auth_users on auth.users;
create trigger guard_auth_users
    before insert or update or delete on auth.users
    for each row execute function public.guard_auth_users();

-- ── 4. Профили ─────────────────────────────────────────────────────────
-- Видно всем вошедшим: ник, аватар, «о себе», дата регистрации.
-- Ник и ключ ника пишут только функции (service role): ключ — нормализованный
-- ник для уникальности (Ян = ян, е = ё, похожие латинские = кириллические).
create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    nick text not null check (char_length(nick) between 3 and 20 and nick ~ '^[A-Za-zА-Яа-яЁё0-9_.-]+$'),
    nick_key text not null unique check (char_length(nick_key) between 3 and 20),
    -- initials:<цвет> | emoji:<номер> | cover:<releaseId> | upload:<версия>
    avatar text not null default 'initials:0'
        check (avatar ~ '^(initials:[0-9]{1,2}|emoji:[0-9]{1,2}|cover:[a-z0-9][a-z0-9-]{0,79}|upload:[0-9]{1,15})$'),
    bio text not null default '' check (char_length(bio) <= 200),
    created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from public, anon, authenticated;
grant select (id, nick, avatar, bio, created_at) on table public.profiles to authenticated;
grant update (avatar, bio) on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles
    for select to authenticated
    using (public.is_active_user());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
    for update to authenticated
    using (id = auth.uid() and public.is_active_user())
    with check (id = auth.uid());

-- Только своё: флаг «сменить пароль при входе» и дата смены ника.
create table if not exists public.account_private (
    id uuid primary key references auth.users (id) on delete cascade,
    must_change_password boolean not null default false,
    nick_changed_at timestamptz
);

alter table public.account_private enable row level security;
revoke all on table public.account_private from public, anon, authenticated;
grant select on table public.account_private to authenticated;
grant all on table public.account_private to service_role;

drop policy if exists "account_private: read own" on public.account_private;
create policy "account_private: read own" on public.account_private
    for select to authenticated
    using (id = auth.uid());

-- ── 5. Лимиты (регистрация, заявки, проверка пароля) ───────────────────
-- Ключ — хеш (IP или ника) с секретом функции, сырой IP не хранится.
create table if not exists public.rate_limits (
    id bigint generated always as identity primary key,
    action text not null check (char_length(action) between 1 and 40),
    key_hash text not null check (char_length(key_hash) between 1 and 128),
    created_at timestamptz not null default now()
);
create index if not exists rate_limits_lookup_idx on public.rate_limits (action, key_hash, created_at);

alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from public, anon, authenticated;
grant all on table public.rate_limits to service_role;

-- true — попытка засчитана и разрешена; false — лимит исчерпан.
create or replace function public.rate_limit_hit(p_action text, p_key text, p_max integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    used integer;
begin
    delete from public.rate_limits r where r.created_at < now() - interval '2 days';
    select count(*) into used
    from public.rate_limits r
    where r.action = p_action and r.key_hash = p_key and r.created_at > now() - p_window;
    if used >= p_max then
        return false;
    end if;
    insert into public.rate_limits (action, key_hash) values (p_action, p_key);
    return true;
end;
$$;

revoke all on function public.rate_limit_hit(text, text, integer, interval) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, interval) to service_role;

-- ── 6. Заявки на восстановление (только владелец) ──────────────────────
create table if not exists public.recovery_requests (
    id bigint generated always as identity primary key,
    nick text not null check (char_length(nick) between 1 and 40),
    nick_key text not null check (char_length(nick_key) between 1 and 40),
    user_id uuid references auth.users (id) on delete set null,
    contact text check (char_length(contact) between 1 and 200),
    comment text not null default '' check (char_length(comment) <= 500),
    status text not null default 'new' check (status in ('new', 'done', 'rejected')),
    created_at timestamptz not null default now(),
    closed_at timestamptz,
    -- Контакт хранится, только пока заявка открыта.
    check (status = 'new' or contact is null),
    check ((status = 'new') = (closed_at is null))
);
create index if not exists recovery_requests_status_idx on public.recovery_requests (status, created_at);

alter table public.recovery_requests enable row level security;
revoke all on table public.recovery_requests from public, anon, authenticated;
grant all on table public.recovery_requests to service_role;

create or replace function public.owner_recovery_list()
returns table (id bigint, nick text, user_id uuid, current_nick text, contact text, comment text, status text, created_at timestamptz, closed_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
    if not public.is_owner() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    return query
    select r.id, r.nick, r.user_id, p.nick, r.contact, r.comment, r.status, r.created_at, r.closed_at
    from public.recovery_requests r
    left join public.profiles p on p.id = r.user_id
    order by (r.status = 'new') desc, r.created_at desc
    limit 200;
end;
$$;

create or replace function public.owner_recovery_close(p_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_owner() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    if p_status not in ('done', 'rejected') then
        raise exception 'Неверный статус' using errcode = '22023';
    end if;
    update public.recovery_requests r
    set status = p_status, contact = null, closed_at = now()
    where r.id = p_id and r.status = 'new';
    if not found then
        raise exception 'Заявка не найдена или уже закрыта' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.owner_recovery_new_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_owner() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    return (select count(*) from public.recovery_requests r where r.status = 'new');
end;
$$;

revoke all on function public.owner_recovery_list() from public, anon;
revoke all on function public.owner_recovery_close(bigint, text) from public, anon;
revoke all on function public.owner_recovery_new_count() from public, anon;
grant execute on function public.owner_recovery_list() to authenticated;
grant execute on function public.owner_recovery_close(bigint, text) to authenticated;
grant execute on function public.owner_recovery_new_count() to authenticated;

-- ── 7. Статистика: только вошедшие, с привязкой к пользователю ─────────
-- Старые записи остаются без user_id. При удалении аккаунта — null
-- (прослушивание остаётся в общих цифрах).
alter table public.play_events add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.listen_sessions add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists play_events_user_idx on public.play_events (user_id, created_at) where user_id is not null;
create index if not exists listen_sessions_user_idx on public.listen_sessions (user_id, created_at) where user_id is not null;

create or replace function public.increment_play_count(track_key_input text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_key text;
begin
    if not public.is_active_user() then
        raise exception 'Нужно войти' using errcode = '42501';
    end if;

    normalized_key := public.normalize_track_key(track_key_input);
    if normalized_key is null then
        raise exception 'Invalid track_key format: %', track_key_input
            using errcode = '22023';
    end if;

    insert into public.play_counts (track_key, plays)
    values (normalized_key, 1)
    on conflict (track_key)
    do update set plays = public.play_counts.plays + 1;

    insert into public.play_events (track_key, user_id) values (normalized_key, auth.uid());
end;
$$;

create or replace function public.record_listen_session(
    session_id_input uuid,
    track_key_input text,
    listened_input numeric,
    max_position_input numeric,
    duration_input numeric,
    completed_input boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_key text;
begin
    if not public.is_active_user() then
        raise exception 'Нужно войти' using errcode = '42501';
    end if;
    if session_id_input is null then
        raise exception 'Нет id сессии' using errcode = '22023';
    end if;
    normalized_key := public.normalize_track_key(track_key_input);
    if normalized_key is null then
        raise exception 'Invalid track_key format: %', track_key_input using errcode = '22023';
    end if;
    if duration_input is null or duration_input <= 0 or duration_input > 1800 then
        raise exception 'Длительность вне границ: %', duration_input using errcode = '22023';
    end if;
    -- Небольшой запас: timeupdate приходит неравномерно.
    if listened_input is null or listened_input < 3 or listened_input > duration_input + 5 then
        raise exception 'Прослушанное время вне границ: %', listened_input using errcode = '22023';
    end if;
    if max_position_input is null or max_position_input < 0 or max_position_input > duration_input + 1 then
        raise exception 'Позиция вне границ: %', max_position_input using errcode = '22023';
    end if;

    insert into public.listen_sessions (session_id, track_key, listened_seconds, max_position, duration, completed, user_id)
    values (
        session_id_input,
        normalized_key,
        round(least(listened_input, duration_input), 2),
        round(least(max_position_input, duration_input), 2),
        round(duration_input, 2),
        coalesce(completed_input, false),
        auth.uid()
    )
    on conflict (session_id) do update set
        listened_seconds = greatest(public.listen_sessions.listened_seconds, excluded.listened_seconds),
        max_position = greatest(public.listen_sessions.max_position, excluded.max_position),
        completed = public.listen_sessions.completed or excluded.completed,
        updated_at = now()
    -- Сессия не может «переехать» на другой трек или к другому пользователю.
    where public.listen_sessions.track_key = excluded.track_key
      and public.listen_sessions.user_id is not distinct from excluded.user_id;
end;
$$;

revoke all on function public.increment_play_count(text) from public, anon;
revoke all on function public.record_listen_session(uuid, text, numeric, numeric, numeric, boolean) from public, anon;
grant execute on function public.increment_play_count(text) to authenticated;
grant execute on function public.record_listen_session(uuid, text, numeric, numeric, numeric, boolean) to authenticated;

-- ── 8. Аватары ─────────────────────────────────────────────────────────
-- Публичный бакет (картинку видно по прямой ссылке, как mp3 сайта).
-- Каждый пишет только файл <свой id>/avatar; браузер ужимает до 256×256.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: own insert" on storage.objects;
create policy "avatars: own insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'avatars' and name = (select auth.uid()::text) || '/avatar' and public.is_active_user());

drop policy if exists "avatars: own select" on storage.objects;
create policy "avatars: own select" on storage.objects
    for select to authenticated
    using (bucket_id = 'avatars' and name = (select auth.uid()::text) || '/avatar');

drop policy if exists "avatars: own update" on storage.objects;
create policy "avatars: own update" on storage.objects
    for update to authenticated
    using (bucket_id = 'avatars' and name = (select auth.uid()::text) || '/avatar' and public.is_active_user())
    with check (bucket_id = 'avatars' and name = (select auth.uid()::text) || '/avatar');

drop policy if exists "avatars: own delete" on storage.objects;
create policy "avatars: own delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'avatars' and name = (select auth.uid()::text) || '/avatar');

-- ── 9. Сервисные функции для Edge Functions (только service role) ──────
-- Завершить все сеансы: refresh-токены перестают работать сразу, выданный
-- access-токен доживает до часа, но роль и бан функции проверяют по базе.
create or replace function public.service_sign_out_user(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
    delete from auth.sessions s where s.user_id = p_user;
$$;

revoke all on function public.service_sign_out_user(uuid) from public, anon, authenticated;
grant execute on function public.service_sign_out_user(uuid) to service_role;

-- ── 10. «Будильник» (GitHub Actions раз в 3 дня) ───────────────────────
create or replace function public.keepalive()
returns integer
language sql
stable
set search_path = ''
as $$
    select 1
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- ── 11. Почта не отправляется никогда ──────────────────────────────────
-- Подключается в Authentication → Hooks → Send Email (Postgres). Supabase
-- вызывает её вместо отправки письма: сброс пароля, magic link, OTP,
-- смена адреса — всё «отправляется» в никуда, возвратов нет.
create or replace function public.auth_hook_send_email_noop(event jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
    select '{}'::jsonb
$$;

revoke all on function public.auth_hook_send_email_noop(jsonb) from public, anon, authenticated;
grant execute on function public.auth_hook_send_email_noop(jsonb) to supabase_auth_admin;

-- Identity-колонки новых таблиц: функции пишут от service role.
grant usage, select on all sequences in schema public to service_role;
