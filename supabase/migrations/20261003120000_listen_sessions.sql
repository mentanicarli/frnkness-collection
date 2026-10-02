-- Дослушивают или пропускают: сессии прослушивания треков.
--
-- Одна строка — одна сессия трека в браузере: сколько секунд реально
-- прослушано (без учёта перемоток), до какой секунды дошли, длительность,
-- дослушан ли. Персональных данных (IP, user agent) нет.
--
-- Сайт может прислать одну и ту же сессию несколько раз (при скрытии
-- вкладки, закрытии страницы, конце трека): на телефоне вкладку в фоне могут
-- закрыть без предупреждения. Поэтому у сессии есть случайный id, и запись —
-- upsert: в таблице одна строка на сессию, значения только растут.
--
-- Существующий счётчик (play_counts, play_events, increment_play_count) не
-- меняется.

create table if not exists public.listen_sessions (
    id bigint generated always as identity primary key,
    session_id uuid not null unique,
    track_key text not null check (char_length(track_key) between 1 and 200),
    listened_seconds numeric(8, 2) not null check (listened_seconds >= 0),
    max_position numeric(8, 2) not null check (max_position >= 0),
    duration numeric(8, 2) not null check (duration > 0 and duration <= 1800),
    completed boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists listen_sessions_created_at_idx on public.listen_sessions (created_at);
create index if not exists listen_sessions_track_key_idx on public.listen_sessions (track_key, created_at);

alter table public.listen_sessions enable row level security;
-- Политик нет: прямого доступа нет ни у кого, только через функции ниже.
revoke all on table public.listen_sessions from public, anon, authenticated;
revoke all on sequence public.listen_sessions_id_seq from public, anon, authenticated;

insert into public.admin_settings (key, value)
values ('listen_sessions_started_at', to_jsonb(now()))
on conflict (key) do nothing;

-- ── Запись сессии (сайт, anon) ─────────────────────────────────────────
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

    insert into public.listen_sessions (session_id, track_key, listened_seconds, max_position, duration, completed)
    values (
        session_id_input,
        normalized_key,
        round(least(listened_input, duration_input), 2),
        round(least(max_position_input, duration_input), 2),
        round(duration_input, 2),
        coalesce(completed_input, false)
    )
    on conflict (session_id) do update set
        listened_seconds = greatest(public.listen_sessions.listened_seconds, excluded.listened_seconds),
        max_position = greatest(public.listen_sessions.max_position, excluded.max_position),
        completed = public.listen_sessions.completed or excluded.completed,
        updated_at = now()
    -- Сессия не может «переехать» на другой трек.
    where public.listen_sessions.track_key = excluded.track_key;
end;
$$;

revoke all on function public.record_listen_session(uuid, text, numeric, numeric, numeric, boolean) from public;
grant execute on function public.record_listen_session(uuid, text, numeric, numeric, numeric, boolean) to anon, authenticated;

-- ── Admin-only агрегаты ────────────────────────────────────────────────
-- Дослушан: событие ended или прослушано ≥ 95% длительности.

create or replace function public.admin_listen_meta()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    started timestamptz;
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    select (s.value #>> '{}')::timestamptz into started
    from public.admin_settings s where s.key = 'listen_sessions_started_at';
    return jsonb_build_object(
        'started_at', started,
        'sessions', (select count(*) from public.listen_sessions)
    );
end;
$$;

create or replace function public.admin_listen_by_key(p_from date, p_to date)
returns table (track_key text, sessions bigint, completed bigint, avg_share numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
    tz constant text := 'Europe/Moscow';
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    perform public.admin_check_period(p_from, p_to);

    return query
    select
        s.track_key,
        count(*)::bigint,
        count(*) filter (where s.completed or s.listened_seconds >= 0.95 * s.duration)::bigint,
        round(avg(least(s.listened_seconds / s.duration, 1)), 4)
    from public.listen_sessions s
    where s.created_at >= (p_from::timestamp at time zone tz)
      and s.created_at < ((p_to + 1)::timestamp at time zone tz)
    group by s.track_key
    order by 2 desc, 1;
end;
$$;

-- Удержание: сколько сессий дошли до каждой 5-й секунды трека.
create or replace function public.admin_listen_retention(p_track_key text, p_from date, p_to date)
returns table (second integer, listeners bigint, sessions bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
    tz constant text := 'Europe/Moscow';
    total bigint;
    longest numeric;
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    perform public.admin_check_period(p_from, p_to);

    select count(*), max(s.duration) into total, longest
    from public.listen_sessions s
    where s.track_key = p_track_key
      and s.created_at >= (p_from::timestamp at time zone tz)
      and s.created_at < ((p_to + 1)::timestamp at time zone tz);
    if total = 0 then
        return;
    end if;

    return query
    select g.t::integer,
           count(s.id) filter (where s.completed or s.max_position >= g.t)::bigint,
           total
    from generate_series(0, (ceil(longest / 5) * 5)::integer, 5) as g(t)
    left join public.listen_sessions s
      on s.track_key = p_track_key
     and s.created_at >= (p_from::timestamp at time zone tz)
     and s.created_at < ((p_to + 1)::timestamp at time zone tz)
    group by g.t
    order by g.t;
end;
$$;

revoke all on function public.admin_listen_meta() from public, anon;
revoke all on function public.admin_listen_by_key(date, date) from public, anon;
revoke all on function public.admin_listen_retention(text, date, date) from public, anon;
grant execute on function public.admin_listen_meta() to authenticated;
grant execute on function public.admin_listen_by_key(date, date) to authenticated;
grant execute on function public.admin_listen_retention(text, date, date) to authenticated;
