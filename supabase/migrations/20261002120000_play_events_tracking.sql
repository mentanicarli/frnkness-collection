-- Админка, этап 2: журнал прослушиваний и admin-only RPC для дашборда.
--
-- increment_play_count сохраняет прежнее поведение (нормализация ключа,
-- ошибка 22023 на неверный формат, +1 в play_counts) и дополнительно
-- пишет событие в play_events. Меняется только search_path: было 'public',
-- стало '' — все объекты и так указаны со схемой.

-- ── Самопроверка перед заменой функции ─────────────────────────────────
-- normalize_track_key вызывается из increment_play_count и наследует её
-- search_path. Если с пустым search_path она ведёт себя иначе, чем с
-- 'public', миграция падает целиком и счётчик остаётся как был.
do $$
declare
    samples text[] := array[
        'faaa-0', 'zlaya-nostalgia-6', 'most-venture-poopsicks-4',
        'most-venture-poopsicks--1', 'disinvolto--1', 'boxik-00',
        'Boxik-0', ' faaa-0 ', 'faaa', 'faaa-', '-0', 'faaa--0', '', 'a b-1'
    ];
    original text := current_setting('search_path');
    s text;
    with_public text;
    with_empty text;
    err_public text;
    err_empty text;
begin
    foreach s in array samples loop
        err_public := null;
        err_empty := null;
        begin
            perform set_config('search_path', 'public', true);
            with_public := public.normalize_track_key(s);
        exception when others then
            with_public := null;
            err_public := sqlstate;
        end;
        begin
            perform set_config('search_path', '', true);
            with_empty := public.normalize_track_key(s);
        exception when others then
            with_empty := null;
            err_empty := sqlstate;
        end;
        if with_public is distinct from with_empty or err_public is distinct from err_empty then
            raise exception 'normalize_track_key(%) зависит от search_path: % / % (ошибки % / %). Пришли определение функции.',
                quote_literal(s), with_public, with_empty, err_public, err_empty;
        end if;
    end loop;
    perform set_config('search_path', original, true);
end
$$;

-- ── Настройки админки ──────────────────────────────────────────────────
-- Дата запуска журнала: графики по дням честно начинаются с неё.
create table if not exists public.admin_settings (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now()
);
alter table public.admin_settings enable row level security;
revoke all on table public.admin_settings from public, anon, authenticated;

insert into public.admin_settings (key, value)
values ('play_events_started_at', to_jsonb(now()))
on conflict (key) do nothing;

-- ── Счётчик ────────────────────────────────────────────────────────────
create or replace function public.increment_play_count(track_key_input text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_key text;
begin
    normalized_key := public.normalize_track_key(track_key_input);

    if normalized_key is null then
        raise exception 'Invalid track_key format: %', track_key_input
            using errcode = '22023';
    end if;

    insert into public.play_counts (track_key, plays)
    values (normalized_key, 1)
    on conflict (track_key)
    do update set plays = public.play_counts.plays + 1;

    insert into public.play_events (track_key) values (normalized_key);
end;
$$;

-- ── RPC дашборда ───────────────────────────────────────────────────────
-- Все функции: security definer + проверка is_admin() по JWT. Агрегация в
-- базе, в браузер уходят только суммы. Дни считаются по Москве.

create or replace function public.admin_stats_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    tz constant text := 'Europe/Moscow';
    today date := (now() at time zone tz)::date;
    started timestamptz;
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;

    select (s.value #>> '{}')::timestamptz into started
    from public.admin_settings s where s.key = 'play_events_started_at';

    return jsonb_build_object(
        'total', (select coalesce(sum(c.plays), 0) from public.play_counts c),
        'today', (select count(*) from public.play_events e where e.created_at >= (today::timestamp at time zone tz)),
        'last7', (select count(*) from public.play_events e where e.created_at >= ((today - 6)::timestamp at time zone tz)),
        'last30', (select count(*) from public.play_events e where e.created_at >= ((today - 29)::timestamp at time zone tz)),
        'tracking_since', started,
        'today_date', today
    );
end;
$$;

-- Проверка периода: from <= to, не длиннее двух лет.
create or replace function public.admin_check_period(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
    if p_from is null or p_to is null or p_from > p_to then
        raise exception 'Неверный период' using errcode = '22023';
    end if;
    if p_to - p_from > 731 then
        raise exception 'Период длиннее двух лет' using errcode = '22023';
    end if;
end;
$$;

create or replace function public.admin_stats_daily(p_from date, p_to date)
returns table (day date, plays bigint)
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
    select g.d::date, coalesce(c.n, 0)::bigint
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g(d)
    left join (
        select (e.created_at at time zone tz)::date as dd, count(*) as n
        from public.play_events e
        where e.created_at >= (p_from::timestamp at time zone tz)
          and e.created_at < ((p_to + 1)::timestamp at time zone tz)
        group by 1
    ) c on c.dd = g.d::date
    order by 1;
end;
$$;

create or replace function public.admin_stats_daily_by_key(p_from date, p_to date)
returns table (day date, track_key text, plays bigint)
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
    select (e.created_at at time zone tz)::date, e.track_key, count(*)::bigint
    from public.play_events e
    where e.created_at >= (p_from::timestamp at time zone tz)
      and e.created_at < ((p_to + 1)::timestamp at time zone tz)
    group by 1, 2
    order by 1, 2;
end;
$$;

create or replace function public.admin_stats_by_key(p_from date, p_to date)
returns table (track_key text, plays bigint)
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
    select e.track_key, count(*)::bigint
    from public.play_events e
    where e.created_at >= (p_from::timestamp at time zone tz)
      and e.created_at < ((p_to + 1)::timestamp at time zone tz)
    group by 1
    order by 2 desc, 1;
end;
$$;

-- Итоги за всё время — из play_counts (там история с самого начала).
create or replace function public.admin_stats_all_time()
returns table (track_key text, plays bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;

    return query
    select c.track_key, coalesce(c.plays, 0)::bigint
    from public.play_counts c
    order by 2 desc, 1;
end;
$$;

-- Supabase по умолчанию выдаёт execute на новые функции всем ролям.
-- Оставляем только authenticated (и проверку is_admin() внутри).
revoke all on function public.admin_stats_overview() from public, anon;
revoke all on function public.admin_stats_daily(date, date) from public, anon;
revoke all on function public.admin_stats_daily_by_key(date, date) from public, anon;
revoke all on function public.admin_stats_by_key(date, date) from public, anon;
revoke all on function public.admin_stats_all_time() from public, anon;
revoke all on function public.admin_check_period(date, date) from public, anon, authenticated;

grant execute on function public.admin_stats_overview() to authenticated;
grant execute on function public.admin_stats_daily(date, date) to authenticated;
grant execute on function public.admin_stats_daily_by_key(date, date) to authenticated;
grant execute on function public.admin_stats_by_key(date, date) to authenticated;
grant execute on function public.admin_stats_all_time() to authenticated;
