-- «Итоги года» (как Spotify Wrapped): подсчёт из уже накопленных данных
-- (play_events, listen_sessions, favorites, room_visits) и публикация итогов
-- из админки.
--
-- Пока итоги не открыты, пользователь не видит ничего: year_recap и
-- my_recap_state отвечают «Недоступно» / null. Открывает админ — всем сразу
-- или выбранным. «Показать всем» действует и на тех, кто зарегистрируется
-- позже (режим проверяется при каждом запросе, а не копируется в строки).
--
-- Все таблицы закрыты полностью (RLS без политик, нет прав у anon и
-- authenticated): читают и пишут только функции ниже (security definer).
-- Время — московское. Год, который закончился, считается один раз и
-- сохраняется в recap_snapshots: итоги неизменны, даже если потом что-то
-- удалят (например, трек из избранного).

-- ── 1. Таблицы ─────────────────────────────────────────────────────────
-- Режим публикации года: off — закрыто, selected — только выбранным,
-- all — всем (включая будущих).
create table if not exists public.recap_settings (
    year integer primary key check (year between 2024 and 2100),
    mode text not null default 'off' check (mode in ('off', 'selected', 'all')),
    updated_at timestamptz not null default now(),
    updated_by uuid references auth.users (id) on delete set null
);

-- Личные исключения из режима: granted=true — открыто этому человеку,
-- granted=false — скрыто (при режиме «всем»). Нет строки — решает режим.
create table if not exists public.recap_grants (
    year integer not null references public.recap_settings (year) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    granted boolean not null,
    updated_at timestamptz not null default now(),
    primary key (year, user_id)
);
create index if not exists recap_grants_user_idx on public.recap_grants (user_id);

-- Готовые итоги закончившегося года.
create table if not exists public.recap_snapshots (
    year integer not null check (year between 2024 and 2100),
    user_id uuid not null references auth.users (id) on delete cascade,
    data jsonb not null,
    created_at timestamptz not null default now(),
    primary key (year, user_id)
);

alter table public.recap_settings enable row level security;
alter table public.recap_grants enable row level security;
alter table public.recap_snapshots enable row level security;
revoke all on table public.recap_settings, public.recap_grants, public.recap_snapshots from public, anon, authenticated;
grant all on table public.recap_settings, public.recap_grants, public.recap_snapshots to service_role;

-- ── 2. Проверка года ───────────────────────────────────────────────────
-- Год не из будущего (по Москве) и не раньше запуска аккаунтов.
create or replace function public.recap_check_year(p_year integer)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
    if p_year is null
       or p_year < 2024
       or p_year > extract(year from (now() at time zone 'Europe/Moscow'))::integer then
        raise exception 'Неверный год' using errcode = '22023';
    end if;
end;
$$;

-- Открыты ли итоги года этому пользователю (без проверки роли вызывающего).
create or replace function public.recap_can_view(p_user uuid, p_year integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (select g.granted from public.recap_grants g where g.year = p_year and g.user_id = p_user),
        (select s.mode = 'all' from public.recap_settings s where s.year = p_year),
        false
    )
$$;

-- ── 3. Подсчёт ─────────────────────────────────────────────────────────
-- Считает итоги одного пользователя за год. Внутренняя: проверку прав
-- делает year_recap.
create or replace function public.recap_compute(p_user uuid, p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    tz constant text := 'Europe/Moscow';
    v_start timestamptz := make_date(p_year, 1, 1)::timestamp at time zone tz;
    v_end timestamptz := make_date(p_year + 1, 1, 1)::timestamp at time zone tz;
    v_reg timestamptz;
    v_from timestamptz;
    v_plays integer;
    v_seconds numeric;
    v_top jsonb;
    v_release jsonb;
    v_first jsonb;
    v_day jsonb;
    v_parts jsonb;
    v_rooms integer;
    v_with jsonb;
    v_favs integer;
begin
    select p.created_at into v_reg from public.profiles p where p.id = p_user;
    v_from := greatest(v_start, coalesce(v_reg, v_start));

    select count(*) into v_plays
    from public.play_events e
    where e.user_id = p_user and e.created_at >= v_from and e.created_at < v_end;

    select coalesce(sum(s.listened_seconds), 0) into v_seconds
    from public.listen_sessions s
    where s.user_id = p_user and s.created_at >= v_from and s.created_at < v_end;

    -- Топ-5 треков: по числу прослушиваний, при равенстве — по минутам.
    select coalesce(jsonb_agg(jsonb_build_object('track_key', x.track_key, 'plays', x.plays, 'minutes', x.minutes)
                              order by x.plays desc, x.sec desc, x.track_key), '[]'::jsonb)
    into v_top
    from (
        select p.track_key, p.plays, round(coalesce(l.sec, 0) / 60)::integer as minutes, coalesce(l.sec, 0) as sec
        from (
            select e.track_key, count(*)::integer as plays
            from public.play_events e
            where e.user_id = p_user and e.created_at >= v_from and e.created_at < v_end
            group by e.track_key
        ) p
        left join (
            select s.track_key, sum(s.listened_seconds) as sec
            from public.listen_sessions s
            where s.user_id = p_user and s.created_at >= v_from and s.created_at < v_end
            group by s.track_key
        ) l on l.track_key = p.track_key
        order by p.plays desc, coalesce(l.sec, 0) desc, p.track_key
        limit 5
    ) x;

    -- Любимый релиз: id релиза — ключ трека без «-индекс».
    select jsonb_build_object('release_id', r.rid, 'plays', r.plays, 'minutes', round(r.sec / 60)::integer)
    into v_release
    from (
        select regexp_replace(p.track_key, '-[0-9]+$', '') as rid,
               sum(p.plays)::integer as plays,
               sum(coalesce(l.sec, 0)) as sec
        from (
            select e.track_key, count(*)::integer as plays
            from public.play_events e
            where e.user_id = p_user and e.created_at >= v_from and e.created_at < v_end
            group by e.track_key
        ) p
        left join (
            select s.track_key, sum(s.listened_seconds) as sec
            from public.listen_sessions s
            where s.user_id = p_user and s.created_at >= v_from and s.created_at < v_end
            group by s.track_key
        ) l on l.track_key = p.track_key
        group by 1
        order by 2 desc, 3 desc, 1
        limit 1
    ) r;

    select jsonb_build_object('track_key', e.track_key, 'at', e.created_at)
    into v_first
    from public.play_events e
    where e.user_id = p_user and e.created_at >= v_from and e.created_at < v_end
    order by e.created_at, e.id
    limit 1;

    -- Самый активный день: по прослушанным минутам.
    select jsonb_build_object('date', d.day, 'minutes', round(d.sec / 60)::integer)
    into v_day
    from (
        select ((s.created_at at time zone tz)::date)::text as day, sum(s.listened_seconds) as sec
        from public.listen_sessions s
        where s.user_id = p_user and s.created_at >= v_from and s.created_at < v_end
        group by 1
        having sum(s.listened_seconds) > 0
        order by 2 desc, 1
        limit 1
    ) d;

    -- Время суток по московским часам: утро 5–11, день 11–17, вечер 17–23, ночь 23–5.
    select jsonb_build_object(
        'morning', count(*) filter (where h >= 5 and h < 11),
        'day', count(*) filter (where h >= 11 and h < 17),
        'evening', count(*) filter (where h >= 17 and h < 23),
        'night', count(*) filter (where h >= 23 or h < 5)
    )
    into v_parts
    from (
        select extract(hour from e.created_at at time zone tz)::integer as h
        from public.play_events e
        where e.user_id = p_user and e.created_at >= v_from and e.created_at < v_end
    ) t;

    -- Комнаты: сколько и с кем чаще (по времени, когда вы были в комнате вместе).
    select count(distinct v.room_id)::integer into v_rooms
    from public.room_visits v
    where v.user_id = p_user and v.joined_at >= v_from and v.joined_at < v_end;

    select coalesce(jsonb_agg(jsonb_build_object('user_id', c.uid, 'nick', c.nick, 'avatar', c.avatar,
                                                 'rooms', c.rooms, 'minutes', c.minutes)
                              order by c.sec desc, c.nick), '[]'::jsonb)
    into v_with
    from (
        select o.user_id as uid, pr.nick, pr.avatar,
               count(distinct m.room_id)::integer as rooms,
               sum(extract(epoch from least(coalesce(m.left_at, now()), coalesce(o.left_at, now()))
                                      - greatest(m.joined_at, o.joined_at))) as sec,
               round(sum(extract(epoch from least(coalesce(m.left_at, now()), coalesce(o.left_at, now()))
                                      - greatest(m.joined_at, o.joined_at))) / 60)::integer as minutes
        from public.room_visits m
        join public.room_visits o
          on o.room_id = m.room_id
         and o.user_id is not null
         and o.user_id <> p_user
         and o.joined_at < coalesce(m.left_at, now())
         and coalesce(o.left_at, now()) > m.joined_at
        join public.profiles pr on pr.id = o.user_id
        where m.user_id = p_user and m.joined_at >= v_from and m.joined_at < v_end
        group by o.user_id, pr.nick, pr.avatar
        order by sec desc, pr.nick
        limit 3
    ) c;

    select count(*)::integer into v_favs
    from public.favorites f
    where f.user_id = p_user and f.created_at >= v_from and f.created_at < v_end;

    return jsonb_build_object(
        'year', p_year,
        'user', (select jsonb_build_object('id', p.id, 'nick', p.nick, 'avatar', p.avatar)
                 from public.profiles p where p.id = p_user),
        'period', jsonb_build_object('from', v_from, 'to', v_end - interval '1 second'),
        'final', now() >= v_end,
        'sparse', v_plays < 10,
        'plays', v_plays,
        'minutes', round(v_seconds / 60)::integer,
        'top_tracks', v_top,
        'top_release', v_release,
        'first_track', v_first,
        'best_day', v_day,
        'day_parts', v_parts,
        'rooms', jsonb_build_object('count', v_rooms, 'with', v_with),
        'favorites_added', v_favs
    );
end;
$$;

-- Итоги для сайта и админки. Пользователь — только свои и только когда
-- они ему открыты; админ — любого. Любая причина отказа — один и тот же ответ,
-- чтобы нельзя было выяснить, есть ли у кого-то итоги.
create or replace function public.year_recap(p_year integer, p_user uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_uid uuid := auth.uid();
    v_target uuid := coalesce(p_user, auth.uid());
    v_admin boolean;
    v_data jsonb;
begin
    if v_uid is null or not public.is_active_user() then
        raise exception 'Недоступно' using errcode = '42501';
    end if;
    v_admin := public.is_admin();
    if v_target <> v_uid and not v_admin then
        raise exception 'Недоступно' using errcode = '42501';
    end if;
    if not v_admin and not public.recap_can_view(v_uid, p_year) then
        raise exception 'Недоступно' using errcode = '42501';
    end if;
    begin
        perform public.recap_check_year(p_year);
    exception when sqlstate '22023' then
        raise exception 'Недоступно' using errcode = '42501';
    end;
    if not exists (select 1 from public.profiles p where p.id = v_target) then
        raise exception 'Недоступно' using errcode = '42501';
    end if;

    select s.data into v_data from public.recap_snapshots s where s.year = p_year and s.user_id = v_target;
    if v_data is not null then
        -- Цифры зафиксированы, а ник и аватар — всегда нынешние.
        return jsonb_set(v_data, '{user}', (select jsonb_build_object('id', p.id, 'nick', p.nick, 'avatar', p.avatar)
                                            from public.profiles p where p.id = v_target));
    end if;

    v_data := public.recap_compute(v_target, p_year);
    -- Год закончился — фиксируем навсегда.
    if (v_data ->> 'final')::boolean then
        insert into public.recap_snapshots (year, user_id, data) values (p_year, v_target, v_data)
        on conflict (year, user_id) do nothing;
    end if;
    return v_data;
end;
$$;

-- Что открыто мне: null — ничего (на сайте не должно быть и следа функции).
create or replace function public.my_recap_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_years integer[];
begin
    if auth.uid() is null or not public.is_active_user() then
        return null;
    end if;
    select array_agg(s.year order by s.year desc) into v_years
    from public.recap_settings s
    where s.year <= extract(year from (now() at time zone 'Europe/Moscow'))::integer
      and public.recap_can_view(auth.uid(), s.year);
    if v_years is null then
        return null;
    end if;
    return jsonb_build_object('year', v_years[1], 'years', to_jsonb(v_years));
end;
$$;

-- ── 4. Админка ─────────────────────────────────────────────────────────
-- Общие цифры по всем пользователям за год.
create or replace function public.admin_recap_overview(p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    tz constant text := 'Europe/Moscow';
    v_start timestamptz := make_date(p_year, 1, 1)::timestamp at time zone tz;
    v_end timestamptz := make_date(p_year + 1, 1, 1)::timestamp at time zone tz;
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    perform public.recap_check_year(p_year);

    return jsonb_build_object(
        'year', p_year,
        'users_total', (select count(*) from public.profiles),
        'users_listening', (select count(distinct e.user_id) from public.play_events e
                            where e.user_id is not null and e.created_at >= v_start and e.created_at < v_end),
        'plays', (select count(*) from public.play_events e
                  where e.user_id is not null and e.created_at >= v_start and e.created_at < v_end),
        'minutes', (select round(coalesce(sum(s.listened_seconds), 0) / 60)::integer from public.listen_sessions s
                    where s.user_id is not null and s.created_at >= v_start and s.created_at < v_end),
        'favorites_added', (select count(*) from public.favorites f where f.created_at >= v_start and f.created_at < v_end),
        'rooms', (select count(distinct v.room_id) from public.room_visits v
                  where v.user_id is not null and v.joined_at >= v_start and v.joined_at < v_end),
        'top_tracks', (
            select coalesce(jsonb_agg(jsonb_build_object('track_key', t.track_key, 'plays', t.plays) order by t.plays desc, t.track_key), '[]'::jsonb)
            from (
                select e.track_key, count(*)::integer as plays
                from public.play_events e
                where e.user_id is not null and e.created_at >= v_start and e.created_at < v_end
                group by e.track_key order by 2 desc, 1 limit 5
            ) t
        )
    );
end;
$$;

-- Кому открыто сейчас: режим, исключения и сколько человек видит итоги.
create or replace function public.admin_recap_status(p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_mode text;
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    perform public.recap_check_year(p_year);

    select coalesce(s.mode, 'off') into v_mode from (select 1) d left join public.recap_settings s on s.year = p_year;

    return jsonb_build_object(
        'year', p_year,
        'mode', v_mode,
        'visible_count', (select count(*) from public.profiles p where public.recap_can_view(p.id, p_year)),
        'users_total', (select count(*) from public.profiles),
        'grants', (
            select coalesce(jsonb_agg(jsonb_build_object('user_id', g.user_id, 'nick', p.nick, 'avatar', p.avatar, 'granted', g.granted)
                                      order by p.nick), '[]'::jsonb)
            from public.recap_grants g
            join public.profiles p on p.id = g.user_id
            where g.year = p_year
        )
    );
end;
$$;

-- Публикация. Действия: show_all, show_selected, hide_all, hide_selected.
create or replace function public.admin_recap_set(p_year integer, p_action text, p_users uuid[] default '{}')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_users uuid[] := coalesce(p_users, '{}');
    v_mode text;
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    perform public.recap_check_year(p_year);
    if p_action not in ('show_all', 'show_selected', 'hide_all', 'hide_selected') then
        raise exception 'Неизвестное действие' using errcode = '22023';
    end if;
    if cardinality(v_users) > 500 then
        raise exception 'Слишком много пользователей' using errcode = '22023';
    end if;
    if p_action in ('show_selected', 'hide_selected') and cardinality(v_users) = 0 then
        raise exception 'Выберите пользователей' using errcode = '22023';
    end if;
    -- Только существующие профили.
    v_users := coalesce((select array_agg(p.id) from public.profiles p where p.id = any (v_users)), '{}');

    insert into public.recap_settings (year, mode, updated_by) values (p_year, 'off', auth.uid())
    on conflict (year) do nothing;
    select s.mode into v_mode from public.recap_settings s where s.year = p_year for update;

    if p_action = 'show_all' then
        delete from public.recap_grants g where g.year = p_year;
        v_mode := 'all';
    elsif p_action = 'hide_all' then
        delete from public.recap_grants g where g.year = p_year;
        v_mode := 'off';
    elsif p_action = 'show_selected' then
        if v_mode = 'all' then
            -- Всем и так открыто: «показать» снимает личное скрытие.
            delete from public.recap_grants g where g.year = p_year and g.user_id = any (v_users);
        else
            insert into public.recap_grants (year, user_id, granted)
            select p_year, u, true from unnest(v_users) u
            on conflict (year, user_id) do update set granted = true, updated_at = now();
            v_mode := 'selected';
        end if;
    else -- hide_selected
        if v_mode = 'all' then
            insert into public.recap_grants (year, user_id, granted)
            select p_year, u, false from unnest(v_users) u
            on conflict (year, user_id) do update set granted = false, updated_at = now();
        else
            delete from public.recap_grants g where g.year = p_year and g.user_id = any (v_users);
            if v_mode = 'selected' and not exists (select 1 from public.recap_grants g where g.year = p_year and g.granted) then
                v_mode := 'off';
            end if;
        end if;
    end if;

    update public.recap_settings s set mode = v_mode, updated_at = now(), updated_by = auth.uid() where s.year = p_year;
    return public.admin_recap_status(p_year);
end;
$$;

-- ── 5. Права на функции ────────────────────────────────────────────────
-- Внутренние помощники — только владелец базы (их зовут другие функции).
revoke all on function public.recap_check_year(integer) from public, anon, authenticated;
revoke all on function public.recap_can_view(uuid, integer) from public, anon, authenticated;
revoke all on function public.recap_compute(uuid, integer) from public, anon, authenticated;
-- RPC — только вошедшим; роль и права проверяет сама функция.
revoke all on function public.year_recap(integer, uuid) from public, anon, authenticated;
revoke all on function public.my_recap_state() from public, anon, authenticated;
revoke all on function public.admin_recap_overview(integer) from public, anon, authenticated;
revoke all on function public.admin_recap_status(integer) from public, anon, authenticated;
revoke all on function public.admin_recap_set(integer, text, uuid[]) from public, anon, authenticated;
grant execute on function public.year_recap(integer, uuid) to authenticated;
grant execute on function public.my_recap_state() to authenticated;
grant execute on function public.admin_recap_overview(integer) to authenticated;
grant execute on function public.admin_recap_status(integer) to authenticated;
grant execute on function public.admin_recap_set(integer, text, uuid[]) to authenticated;
