-- Этап «Список пользователей, журнал ошибок, обращения».
--
-- Что здесь:
--   — list_discoverable_users: список всех активных пользователей для
--     страницы «Друзья» (ник, аватар, отношение ко мне), с поиском и
--     подгрузкой частями. Только вошедшим; без забаненных, удалённых и
--     самого вызывающего;
--   — client_errors + log_client_error: журнал ошибок JavaScript с сайта.
--     Функция открыта и анониму (ошибка может случиться до входа), поэтому
--     защита многослойная: лимит на пользователя или браузер (20 в час),
--     общий потолок на весь сайт (500 в час, сверх — молча отбрасываем),
--     обрезка длины и вычистка токенов, паролей, почты и идентификаторов
--     на стороне базы;
--   — admin_errors_list / admin_errors_resolve: раздел «Ошибки» в админке
--     (группировка по отпечатку, «Отметить решённой»). Записи старше 30
--     дней удаляются при обращении к разделу — pg_cron не нужен;
--   — feedback_reports + submit_feedback: «Сообщить о проблеме» (до 1000
--     символов, не больше 5 в сутки на пользователя);
--   — admin_feedback_list / admin_feedback_set / admin_feedback_new_count:
--     раздел «Обращения» и значок с числом новых.
--
-- Прямого доступа к новым таблицам нет ни у кого, кроме service role:
-- всё идёт через RPC с фиксированным search_path.

-- ── 1. Таблицы ─────────────────────────────────────────────────────────
create table if not exists public.client_errors (
    id bigint generated always as identity primary key,
    -- Одинаковые ошибки: хеш нормализованного текста и первой строки стека.
    fingerprint text not null check (char_length(fingerprint) = 32),
    message text not null check (char_length(message) between 1 and 500),
    stack text not null default '' check (char_length(stack) <= 1500),
    page text not null default '' check (char_length(page) <= 200),
    browser text not null default '' check (char_length(browser) <= 120),
    build text not null default '' check (char_length(build) <= 40),
    user_id uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);
create index if not exists client_errors_fp_idx on public.client_errors (fingerprint, created_at desc);
create index if not exists client_errors_created_idx on public.client_errors (created_at);

create table if not exists public.feedback_reports (
    id bigint generated always as identity primary key,
    user_id uuid references auth.users (id) on delete set null,
    -- Ник на момент обращения: пользователя могут удалить или переименовать.
    nick text not null check (char_length(nick) between 1 and 40),
    message text not null check (char_length(message) between 1 and 1000),
    page text not null default '' check (char_length(page) <= 200),
    browser text not null default '' check (char_length(browser) <= 120),
    build text not null default '' check (char_length(build) <= 40),
    status text not null default 'new' check (status in ('new', 'done')),
    created_at timestamptz not null default now(),
    closed_at timestamptz,
    check ((status = 'done') = (closed_at is not null))
);
create index if not exists feedback_reports_status_idx on public.feedback_reports (status, created_at desc);

-- ── 2. Права на таблицы ────────────────────────────────────────────────
alter table public.client_errors enable row level security;
alter table public.feedback_reports enable row level security;

revoke all on table public.client_errors, public.feedback_reports from public, anon, authenticated;
grant all on table public.client_errors, public.feedback_reports to service_role;

-- ── 3. Список пользователей для «Друзей» ───────────────────────────────
-- Курсор — ключ ника (nick_key): страницы не съезжают, если кто-то
-- зарегистрировался между запросами. Отдаём только то, что нужно для
-- строки списка: id (для заявки), ник, аватар и отношение ко мне.
create or replace function public.list_discoverable_users(p_query text default '', p_after text default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    q text := public.account_nick_key(coalesce(p_query, ''));
    pattern text;
    lim integer := least(greatest(coalesce(p_limit, 30), 1), 50);
    rows_json jsonb;
    cnt integer;
    cursor_key text;
begin
    if char_length(q) > 20 then
        raise exception 'Слишком длинный запрос' using errcode = '22023';
    end if;
    if p_after is not null and char_length(p_after) > 20 then
        raise exception 'Неверный курсор' using errcode = '22023';
    end if;
    pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

    with page as (
        select p.id, p.nick, p.nick_key, p.avatar
        from public.profiles p
        join auth.users u on u.id = p.id
        where p.id <> uid
          and u.deleted_at is null
          and (u.banned_until is null or u.banned_until <= now())
          and (q = '' or p.nick_key like pattern)
          and (p_after is null or p.nick_key > p_after)
        order by p.nick_key
        limit lim + 1
    )
    select count(*), jsonb_agg(
               jsonb_build_object('id', x.id, 'nick', x.nick, 'avatar', x.avatar, 'relation', public.relation_to(x.id))
               order by x.nick_key
           ) filter (where x.rn <= lim),
           max(x.nick_key) filter (where x.rn <= lim)
      into cnt, rows_json, cursor_key
    from (select page.*, row_number() over (order by page.nick_key) as rn from page) x;

    return jsonb_build_object(
        'users', coalesce(rows_json, '[]'::jsonb),
        'has_more', cnt > lim,
        'next', case when cnt > lim then cursor_key end
    );
end;
$$;

-- ── 4. Журнал ошибок: вычистка текста ──────────────────────────────────
-- Внутренняя функция: токены, пароли, почта, uuid, длинные «секретные»
-- строки и параметры адреса заменяются заглушками, потом текст режется.
create or replace function public.scrub_client_text(p text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
    t text := coalesce(p, '');
begin
    t := regexp_replace(t, '[\x01-\x08\x0B-\x1F\x7F]', ' ', 'g');
    t := regexp_replace(t, 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}(\.[A-Za-z0-9_-]*)?', '[токен]', 'g');
    t := regexp_replace(t, 'bearer\s+[A-Za-z0-9._~+/=-]{8,}', 'Bearer [токен]', 'gi');
    t := regexp_replace(t, '(password|passwd|pwd|pass|token|secret|apikey|api_key|access_token|refresh_token|authorization|key)(["'']?\s*[:=]\s*["'']?)[^\s"''&,;)]+', '\1\2[скрыто]', 'gi');
    t := regexp_replace(t, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g');
    t := regexp_replace(t, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '[id]', 'gi');
    t := regexp_replace(t, '\?[A-Za-z0-9_%.-]+=[^\s)"'']*', '?…', 'g');
    t := regexp_replace(t, '[A-Za-z0-9_-]{40,}', '[скрыто]', 'g');
    return left(btrim(t), p_max);
end;
$$;

-- Общий потолок записей в час на весь сайт.
create or replace function public.client_errors_site_cap()
returns integer
language sql
immutable
set search_path = ''
as $$ select 500 $$;

-- ── 5. Журнал ошибок: запись с сайта ───────────────────────────────────
-- Никогда не бросает исключений: сайту незачем знать, записана ли ошибка.
-- Сверх лимитов, а также на мусорные данные — молча ничего не делаем.
create or replace function public.log_client_error(
    p_message text,
    p_stack text default '',
    p_page text default '',
    p_browser text default '',
    p_build text default '',
    p_client text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := case when public.is_active_user() then auth.uid() else null end;
    msg text := public.scrub_client_text(p_message, 500);
    stack_text text;
    first_line text;
    who text;
begin
    if msg = '' then
        return;
    end if;

    -- Первые строки стека: не больше восьми.
    stack_text := public.scrub_client_text(
        (select string_agg(l, E'\n') from (select l from unnest(string_to_array(left(coalesce(p_stack, ''), 4000), E'\n')) with ordinality as s(l, n) where n <= 8 order by n) x),
        1500
    );
    first_line := split_part(stack_text, E'\n', 1);

    -- Кто пишет: вошедший — по id, остальные — по ключу браузера.
    who := case
        when uid is not null then 'u:' || uid::text
        when p_client is not null and p_client ~ '^[a-z0-9]{8,40}$' then 'c:' || p_client
        else 'anon'
    end;

    if not public.rate_limit_hit('client-error', who, 20, interval '1 hour') then
        return;
    end if;
    if not public.rate_limit_hit('client-error-all', 'site', public.client_errors_site_cap(), interval '1 hour') then
        return;
    end if;

    insert into public.client_errors (fingerprint, message, stack, page, browser, build, user_id)
    values (
        md5(regexp_replace(left(msg, 200), '[0-9]+', '#', 'g') || '|' || regexp_replace(first_line, '[0-9]+', '#', 'g')),
        msg,
        coalesce(stack_text, ''),
        coalesce(public.scrub_client_text(p_page, 200), ''),
        coalesce(public.scrub_client_text(p_browser, 120), ''),
        coalesce(public.scrub_client_text(p_build, 40), ''),
        uid
    );

    -- Страховка от разрастания, если админку долго не открывали.
    if random() < 0.01 then
        delete from public.client_errors e where e.created_at < now() - interval '30 days';
    end if;
exception when others then
    -- Журнал — не главное: любая неожиданность не должна ломать сайт.
    return;
end;
$$;

-- ── 6. Журнал ошибок: админка ──────────────────────────────────────────
-- Группы одинаковых ошибок. Старше 30 дней удаляем прямо здесь.
-- p_resolved: false — только нерешённые, true — только решённые.
create or replace function public.admin_errors_list(p_resolved boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    delete from public.client_errors e where e.created_at < now() - interval '30 days';

    return coalesce((
        select jsonb_agg(g order by (g ->> 'last_seen') desc)
        from (
            select jsonb_build_object(
                'fingerprint', e.fingerprint,
                'message', (array_agg(e.message order by e.created_at desc))[1],
                'stack', (array_agg(e.stack order by e.created_at desc))[1],
                'page', (array_agg(e.page order by e.created_at desc))[1],
                'build', (array_agg(e.build order by e.created_at desc))[1],
                'count', count(*),
                'users', count(distinct e.user_id),
                'first_seen', min(e.created_at),
                'last_seen', max(e.created_at),
                'resolved', bool_and(e.resolved_at is not null),
                'browsers', (
                    select coalesce(jsonb_agg(jsonb_build_object('browser', b.browser, 'count', b.n) order by b.n desc), '[]'::jsonb)
                    from (
                        select e2.browser, count(*) as n
                        from public.client_errors e2
                        where e2.fingerprint = e.fingerprint and e2.browser <> ''
                        group by e2.browser
                        order by count(*) desc
                        limit 5
                    ) b
                )
            ) as g
            from public.client_errors e
            group by e.fingerprint
            having bool_and(e.resolved_at is not null) = coalesce(p_resolved, false)
            order by max(e.created_at) desc
            limit 200
        ) s
    ), '[]'::jsonb);
end;
$$;

-- Отметить группу решённой (или вернуть). Если ошибка появится снова,
-- новая запись придёт нерешённой и группа вернётся в список.
create or replace function public.admin_errors_resolve(p_fingerprint text, p_resolved boolean default true)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    n integer;
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{32}$' then
        raise exception 'Неверный отпечаток' using errcode = '22023';
    end if;
    update public.client_errors e
    set resolved_at = case when coalesce(p_resolved, true) then coalesce(e.resolved_at, now()) else null end
    where e.fingerprint = p_fingerprint;
    get diagnostics n = row_count;
    return n;
end;
$$;

-- ── 7. Обращения: отправка ─────────────────────────────────────────────
create or replace function public.submit_feedback(p_message text, p_page text default '', p_browser text default '', p_build text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    msg text := public.clean_user_text(p_message, true);
    nick_text text;
begin
    if msg = '' then
        raise exception 'Напиши, что случилось' using errcode = '22023';
    end if;
    if char_length(msg) > 1000 then
        raise exception 'Не больше 1000 символов' using errcode = '22023';
    end if;
    if not public.rate_limit_hit('feedback', uid::text, 5, interval '1 day') then
        raise exception 'Сегодня уже много обращений — попробуй завтра' using errcode = '54000';
    end if;
    select p.nick into nick_text from public.profiles p where p.id = uid;

    insert into public.feedback_reports (user_id, nick, message, page, browser, build)
    values (
        uid,
        coalesce(nick_text, '—'),
        msg,
        coalesce(public.scrub_client_text(p_page, 200), ''),
        coalesce(public.scrub_client_text(p_browser, 120), ''),
        coalesce(public.scrub_client_text(p_build, 40), '')
    );
    return jsonb_build_object('ok', true);
end;
$$;

-- ── 8. Обращения: админка ──────────────────────────────────────────────
create or replace function public.admin_feedback_list(p_status text default null)
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
    if p_status is not null and p_status not in ('new', 'done') then
        raise exception 'Неверный статус' using errcode = '22023';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', f.id,
            'user_id', f.user_id,
            'nick', coalesce(p.nick, f.nick),
            'message', f.message,
            'page', f.page,
            'browser', f.browser,
            'build', f.build,
            'status', f.status,
            'created_at', f.created_at,
            'closed_at', f.closed_at
        ) order by (f.status = 'new') desc, f.created_at desc)
        from (
            select * from public.feedback_reports r
            where p_status is null or r.status = p_status
            order by (r.status = 'new') desc, r.created_at desc
            limit 200
        ) f
        left join public.profiles p on p.id = f.user_id
    ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_feedback_set(p_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    if p_status not in ('new', 'done') then
        raise exception 'Неверный статус' using errcode = '22023';
    end if;
    update public.feedback_reports f
    set status = p_status, closed_at = case when p_status = 'done' then now() else null end
    where f.id = p_id;
    if not found then
        raise exception 'Обращение не найдено' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.admin_feedback_new_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    return (select count(*)::integer from public.feedback_reports f where f.status = 'new');
end;
$$;

-- ── 9. Права на функции ────────────────────────────────────────────────
revoke all on function public.list_discoverable_users(text, text, integer) from public, anon;
revoke all on function public.scrub_client_text(text, integer) from public, anon, authenticated;
revoke all on function public.client_errors_site_cap() from public, anon, authenticated;
revoke all on function public.log_client_error(text, text, text, text, text, text) from public;
revoke all on function public.admin_errors_list(boolean) from public, anon;
revoke all on function public.admin_errors_resolve(text, boolean) from public, anon;
revoke all on function public.submit_feedback(text, text, text, text) from public, anon;
revoke all on function public.admin_feedback_list(text) from public, anon;
revoke all on function public.admin_feedback_set(bigint, text) from public, anon;
revoke all on function public.admin_feedback_new_count() from public, anon;

grant execute on function public.list_discoverable_users(text, text, integer) to authenticated;
-- Единственная функция, открытая анониму: ошибка бывает до входа.
grant execute on function public.log_client_error(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_errors_list(boolean) to authenticated;
grant execute on function public.admin_errors_resolve(text, boolean) to authenticated;
grant execute on function public.submit_feedback(text, text, text, text) to authenticated;
grant execute on function public.admin_feedback_list(text) to authenticated;
grant execute on function public.admin_feedback_set(bigint, text) to authenticated;
grant execute on function public.admin_feedback_new_count() to authenticated;
