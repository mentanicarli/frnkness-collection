-- Этап «Аккаунты»: RPC админки — раздел «Пользователи» и статистика
-- пользователей. Все функции: security definer + is_admin() по базе.
-- Изменения (сброс пароля, бан, роли, удаление) делает функция admin-users.

-- Список пользователей с поиском по нику (без учёта регистра).
create or replace function public.admin_users_list(p_search text default '')
returns table (
    id uuid,
    nick text,
    avatar text,
    role text,
    created_at timestamptz,
    last_sign_in_at timestamptz,
    banned_until timestamptz,
    has_profile boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
    pattern text := '%' || replace(replace(replace(coalesce(btrim(p_search), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    if char_length(coalesce(p_search, '')) > 40 then
        raise exception 'Слишком длинный запрос' using errcode = '22023';
    end if;

    return query
    select u.id,
           p.nick,
           p.avatar,
           coalesce(u.raw_app_meta_data ->> 'role', 'user'),
           u.created_at,
           u.last_sign_in_at,
           case when u.banned_until > now() then u.banned_until end,
           p.id is not null
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.deleted_at is null
      and coalesce(u.is_anonymous, false) = false
      and (pattern = '%%' or p.nick ilike pattern)
    order by u.created_at desc
    limit 500;
end;
$$;

-- Карточка пользователя: профиль, роль, входы, статистика прослушиваний.
create or replace function public.admin_user_card(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    result jsonb;
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;

    select jsonb_build_object(
        'id', u.id,
        'nick', p.nick,
        'avatar', p.avatar,
        'bio', p.bio,
        'role', coalesce(u.raw_app_meta_data ->> 'role', 'user'),
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'banned_until', case when u.banned_until > now() then u.banned_until end,
        'must_change_password', coalesce(a.must_change_password, false),
        'nick_changed_at', a.nick_changed_at,
        'sessions', (select count(*) from auth.sessions s where s.user_id = u.id),
        'plays', (select count(*) from public.play_events e where e.user_id = u.id),
        'plays_30d', (select count(*) from public.play_events e where e.user_id = u.id and e.created_at > now() - interval '30 days'),
        'last_play_at', (select max(e.created_at) from public.play_events e where e.user_id = u.id),
        'listen_seconds', (select coalesce(round(sum(l.listened_seconds)), 0) from public.listen_sessions l where l.user_id = u.id),
        'top', coalesce((
            select jsonb_agg(jsonb_build_object('track_key', t.track_key, 'plays', t.n) order by t.n desc, t.track_key)
            from (
                select e.track_key, count(*) as n
                from public.play_events e
                where e.user_id = u.id
                group by e.track_key
                order by count(*) desc, e.track_key
                limit 10
            ) t
        ), '[]'::jsonb)
    )
    into result
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.account_private a on a.id = u.id
    where u.id = p_user and u.deleted_at is null;

    if result is null then
        raise exception 'Пользователь не найден' using errcode = 'P0002';
    end if;
    return result;
end;
$$;

-- «Статистика»: число пользователей, активные за неделю, регистрации по дням.
-- Активный — было прослушивание или вход за последние 7 дней.
create or replace function public.admin_users_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;

    return jsonb_build_object(
        'total', (select count(*) from auth.users u where u.deleted_at is null and coalesce(u.is_anonymous, false) = false),
        'active7', (
            select count(*) from (
                select e.user_id as id from public.play_events e
                where e.user_id is not null and e.created_at > now() - interval '7 days'
                union
                select l.user_id from public.listen_sessions l
                where l.user_id is not null and l.updated_at > now() - interval '7 days'
                union
                select u.id from auth.users u
                where u.deleted_at is null and u.last_sign_in_at > now() - interval '7 days'
            ) a
        ),
        'new7', (select count(*) from auth.users u where u.deleted_at is null and u.created_at > now() - interval '7 days'),
        'banned', (select count(*) from auth.users u where u.deleted_at is null and u.banned_until > now())
    );
end;
$$;

create or replace function public.admin_users_daily(p_from date, p_to date)
returns table (day date, registrations bigint)
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
        select (u.created_at at time zone tz)::date as dd, count(*) as n
        from auth.users u
        where u.deleted_at is null
          and u.created_at >= (p_from::timestamp at time zone tz)
          and u.created_at < ((p_to + 1)::timestamp at time zone tz)
        group by 1
    ) c on c.dd = g.d::date
    order by 1;
end;
$$;

revoke all on function public.admin_users_list(text) from public, anon;
revoke all on function public.admin_user_card(uuid) from public, anon;
revoke all on function public.admin_users_overview() from public, anon;
revoke all on function public.admin_users_daily(date, date) from public, anon;
grant execute on function public.admin_users_list(text) to authenticated;
grant execute on function public.admin_user_card(uuid) to authenticated;
grant execute on function public.admin_users_overview() to authenticated;
grant execute on function public.admin_users_daily(date, date) to authenticated;
