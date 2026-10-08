-- Этап «Топ-4, лента друзей и реакции в комнатах».
--
-- Что здесь:
--   — «Мой топ-4»: до четырёх значимых для человека треков, по постоянному
--     id, в порядке, который он задал. Видят все вошедшие. Пишет только
--     top4_set (RPC), прямого доступа к таблицам нет;
--   — «Лента»: события друзей за 7 дней (прослушивания, избранное, публичные
--     плейлисты, обновление топ-4, «в комнате»). Читается одной функцией
--     friends_feed, которая берёт только принятых друзей: чужих данных
--     по ней не получить. Переключатель «Не показывать мои прослушивания
--     в ленте» (feed_prefs) скрывает только прослушивания;
--   — журнал комнат room_visits: кто, где, хозяин или гость, вход и выход
--     (для будущих итогов года; закрыт от всех, кроме service role);
--   — реакции в комнатах: отдельный приватный топик «roomfx:<uuid>:<эпоха>»,
--     в который пишут и слушают ВСЕ участники. Команды плеера по-прежнему
--     идут по топику «room:…», куда пишет только хозяин (этап 4).
--     Реакции не сохраняются нигде.
--
-- Почему реакции — отдельный топик, а не отдельное событие в том же канале:
-- политика Realtime на запись видит только топик и вид сообщения
-- (extension), но не имя события, поэтому «разрешить событие reaction,
-- но не state» одной политикой не выразить. Отдельный топик решает это
-- без догадок о внутренностях Realtime.

-- ── 1. Таблицы ─────────────────────────────────────────────────────────
create table if not exists public.profile_top4 (
    user_id uuid not null references auth.users (id) on delete cascade,
    position smallint not null check (position between 1 and 4),
    track_id text not null check (char_length(track_id) <= 160 and track_id ~ '^[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*$'),
    primary key (user_id, position),
    -- Один трек — одно место.
    unique (user_id, track_id)
);

-- Одна строка на человека: когда топ-4 последний раз реально менялся.
-- По ней лента показывает одно событие на одно сохранение, а не по
-- событию на каждое место.
create table if not exists public.profile_top4_saves (
    user_id uuid primary key references auth.users (id) on delete cascade,
    saved_at timestamptz not null default now()
);

create table if not exists public.feed_prefs (
    user_id uuid primary key references auth.users (id) on delete cascade,
    hide_listens boolean not null default false
);

-- Лента читает по каждому источнику «свежее вперёд»: нужны индексы по
-- (пользователь, время). play_events_user_idx (user_id, created_at) и
-- favorites_user_idx (user_id, created_at desc) уже есть; для публичных
-- плейлистов — свой.
create index if not exists playlists_public_created_idx on public.playlists (owner_id, created_at desc) where is_public;
create index if not exists profile_top4_saves_at_idx on public.profile_top4_saves (saved_at desc);

-- ── 2. Права на таблицы ────────────────────────────────────────────────
-- Прямого доступа нет ни у кого, кроме service role: всё идёт через RPC.
alter table public.profile_top4 enable row level security;
alter table public.profile_top4_saves enable row level security;
alter table public.feed_prefs enable row level security;

revoke all on table public.profile_top4, public.profile_top4_saves, public.feed_prefs from public, anon, authenticated;
grant all on table public.profile_top4, public.profile_top4_saves, public.feed_prefs to service_role;

-- ── 3. Помощники ───────────────────────────────────────────────────────
-- Аккаунт существует и не забанен. Внутренняя: сайту не открыта.
create or replace function public.user_is_live(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1 from auth.users u
        where u.id = p_user
          and u.deleted_at is null
          and (u.banned_until is null or u.banned_until <= now())
    )
$$;

-- Топ-4 человека: [{position, track_id}] по порядку. Внутренняя.
create or replace function public.top4_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(jsonb_agg(jsonb_build_object('position', t.position, 'track_id', t.track_id) order by t.position), '[]'::jsonb)
    from public.profile_top4 t
    where t.user_id = p_user
$$;

-- ── 4. Топ-4 ───────────────────────────────────────────────────────────
-- Заменяет весь список за один вызов: порядок задаётся порядком массива.
-- Пустой массив очищает топ. Не меняется — ничего не пишем и события
-- в ленте не будет. Не больше 60 сохранений в час.
create or replace function public.top4_set(p_track_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    ids text[] := coalesce(p_track_ids, '{}'::text[]);
    id text;
    current_ids text[];
begin
    if coalesce(array_length(ids, 1), 0) > 4 then
        raise exception 'В топ-4 — не больше четырёх треков' using errcode = '22023';
    end if;
    foreach id in array ids loop
        if id is null or char_length(id) > 160 or id !~ '^[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*$' then
            raise exception 'Не получилось распознать трек' using errcode = '22023';
        end if;
    end loop;
    if (select count(distinct x) from unnest(ids) x) <> coalesce(array_length(ids, 1), 0) then
        raise exception 'Один трек нельзя поставить дважды' using errcode = '22023';
    end if;

    select coalesce(array_agg(t.track_id order by t.position), '{}'::text[]) into current_ids
    from public.profile_top4 t where t.user_id = uid;
    if current_ids = ids then
        return public.top4_json(uid);
    end if;

    if not public.rate_limit_hit('top4-save', uid::text, 60, interval '1 hour') then
        raise exception 'Слишком часто — попробуй позже' using errcode = '54000';
    end if;

    delete from public.profile_top4 t where t.user_id = uid;
    if coalesce(array_length(ids, 1), 0) = 0 then
        delete from public.profile_top4_saves s where s.user_id = uid;
    else
        insert into public.profile_top4 (user_id, position, track_id)
        select uid, o.n::smallint, o.track_id from unnest(ids) with ordinality as o(track_id, n);
        insert into public.profile_top4_saves as s (user_id, saved_at) values (uid, now())
        on conflict (user_id) do update set saved_at = excluded.saved_at;
    end if;
    return public.top4_json(uid);
end;
$$;

-- Топ-4 пользователя: видят все вошедшие (не только друзья). Забаненного
-- и удалённого не показываем.
create or replace function public.user_top4(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    perform public.require_active_user();
    if p_user is null or not public.user_is_live(p_user) then
        return '[]'::jsonb;
    end if;
    return public.top4_json(p_user);
end;
$$;

-- ── 5. Настройки ленты ─────────────────────────────────────────────────
create or replace function public.feed_prefs_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    return jsonb_build_object('hide_listens', coalesce((select p.hide_listens from public.feed_prefs p where p.user_id = uid), false));
end;
$$;

create or replace function public.feed_prefs_set(p_hide_listens boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    if p_hide_listens is null then
        raise exception 'Не получилось сохранить' using errcode = '22023';
    end if;
    insert into public.feed_prefs as p (user_id, hide_listens) values (uid, p_hide_listens)
    on conflict (user_id) do update set hide_listens = excluded.hide_listens;
    return jsonb_build_object('hide_listens', p_hide_listens);
end;
$$;

-- ── 6. Лента друзей ────────────────────────────────────────────────────
-- События ТОЛЬКО принятых друзей (и не забаненных) за последние 7 дней,
-- от новых к старым. Параметра «чей» нет: чужую ленту запросить нельзя.
--   listen   — прослушивание (play_events: засчитано после 10 секунд, как
--              для «моего топа»); не показывается тем, кто включил
--              «Не показывать мои прослушивания в ленте»;
--   favorite — добавил(а) в избранное;
--   playlist — новый публичный плейлист;
--   top4     — сохранил(а) топ-4 (одно событие на сохранение);
--   room     — друг сейчас в комнате. Название и id комнаты — только тем,
--              кого в неё пригласили или кто в ней сам (can_join);
--              остальные видят лишь «слушает в комнате».
-- Страницы — по курсору (p_before_at, p_before_key): ключ события уникален
-- и упорядочен, поэтому события с одним временем не теряются.
create or replace function public.friends_feed(p_before_at timestamptz default null, p_before_key text default null, p_limit integer default 40)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    lim integer := least(greatest(coalesce(p_limit, 40), 1), 50);
    since timestamptz := now() - interval '7 days';
    rows jsonb;
    n integer;
begin
    if (p_before_at is null) <> (p_before_key is null) then
        raise exception 'Не получилось загрузить ленту' using errcode = '22023';
    end if;
    if p_before_key is not null and char_length(p_before_key) > 120 then
        raise exception 'Не получилось загрузить ленту' using errcode = '22023';
    end if;

    with friends as materialized (
        select case when f.requester = uid then f.addressee else f.requester end as id
        from public.friendships f
        where f.status = 'accepted' and uid in (f.requester, f.addressee)
    ),
    live_friends as materialized (
        select fr.id from friends fr where public.user_is_live(fr.id)
    ),
    listens as (
        select e.created_at as ts,
               'listen:' || lpad(e.id::text, 20, '0') as ekey,
               e.user_id as who,
               jsonb_build_object('track_key', e.track_key) as data
        from public.play_events e
        where e.user_id in (select id from live_friends)
          and e.created_at > since
          and not coalesce((select p.hide_listens from public.feed_prefs p where p.user_id = e.user_id), false)
          and (p_before_at is null or (e.created_at, 'listen:' || lpad(e.id::text, 20, '0')) < (p_before_at, p_before_key))
        order by e.created_at desc, e.id desc
        limit lim + 1
    ),
    favs as (
        select v.created_at as ts,
               'favorite:' || v.user_id::text || ':' || v.track_id as ekey,
               v.user_id as who,
               jsonb_build_object('track_id', v.track_id) as data
        from public.favorites v
        where v.user_id in (select id from live_friends)
          and v.created_at > since
          and (p_before_at is null or (v.created_at, 'favorite:' || v.user_id::text || ':' || v.track_id) < (p_before_at, p_before_key))
        order by v.created_at desc, 2 desc
        limit lim + 1
    ),
    lists as (
        select p.created_at as ts,
               'playlist:' || p.id::text as ekey,
               p.owner_id as who,
               jsonb_build_object('playlist', jsonb_build_object('id', p.id, 'title', p.title)) as data
        from public.playlists p
        where p.owner_id in (select id from live_friends)
          and p.is_public
          and p.created_at > since
          and (p_before_at is null or (p.created_at, 'playlist:' || p.id::text) < (p_before_at, p_before_key))
        order by p.created_at desc, 2 desc
        limit lim + 1
    ),
    tops as (
        select s.saved_at as ts,
               'top4:' || s.user_id::text as ekey,
               s.user_id as who,
               jsonb_build_object('track_ids', (select coalesce(jsonb_agg(t.track_id order by t.position), '[]'::jsonb) from public.profile_top4 t where t.user_id = s.user_id)) as data
        from public.profile_top4_saves s
        where s.user_id in (select id from live_friends)
          and s.saved_at > since
          and exists (select 1 from public.profile_top4 t where t.user_id = s.user_id)
          and (p_before_at is null or (s.saved_at, 'top4:' || s.user_id::text) < (p_before_at, p_before_key))
        order by s.saved_at desc, 2 desc
        limit lim + 1
    ),
    rooms as (
        select m.joined_at as ts,
               'room:' || m.user_id::text as ekey,
               m.user_id as who,
               case
                   when invited.room_id is not null or mine.room_id is not null
                       then jsonb_build_object('room', jsonb_build_object('id', r.id, 'title', r.title), 'can_join', true)
                   else jsonb_build_object('can_join', false)
               end as data
        from public.room_members m
        join public.rooms r on r.id = m.room_id and r.closed_at is null
        left join public.room_invites invited
               on invited.room_id = r.id and invited.to_user = uid and invited.created_at > now() - interval '6 hours'
        left join public.room_members mine on mine.room_id = r.id and mine.user_id = uid
        where m.user_id in (select id from live_friends)
          -- Участник «живой»: заглядывал в комнату за последние 10 минут
          -- (хозяин — по признакам жизни хозяина), как в rooms_sweep.
          and greatest(m.last_seen, case when m.user_id = r.owner_id then r.owner_seen_at end) > now() - interval '10 minutes'
          and (p_before_at is null or (m.joined_at, 'room:' || m.user_id::text) < (p_before_at, p_before_key))
        order by m.joined_at desc, 2 desc
        limit lim + 1
    ),
    merged as (
        select 'listen' as kind, * from listens
        union all select 'favorite', * from favs
        union all select 'playlist', * from lists
        union all select 'top4', * from tops
        union all select 'room', * from rooms
    ),
    page as (
        select * from merged order by ts desc, ekey desc limit lim + 1
    )
    select count(*)::integer,
           coalesce(jsonb_agg(
               jsonb_build_object('kind', x.kind, 'at', x.ts, 'key', x.ekey, 'user', public.profile_card(x.who)) || x.data
               order by x.ts desc, x.ekey desc
           ) filter (where x.rn <= lim), '[]'::jsonb)
      into n, rows
    from (select page.*, row_number() over (order by ts desc, ekey desc) as rn from page) x;

    return jsonb_build_object('events', rows, 'has_more', n > lim);
end;
$$;

-- ── 7. Админка: топ-4 в карточке пользователя ──────────────────────────
-- Та же функция, что на этапе 3, плюс ключ top4.
create or replace function public.admin_user_social(p_user uuid)
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
        'favorites', coalesce((
            select jsonb_agg(jsonb_build_object('track_id', f.track_id, 'added_at', f.created_at) order by f.created_at desc, f.track_id)
            from public.favorites f where f.user_id = p_user
        ), '[]'::jsonb),
        'playlists', coalesce((
            select jsonb_agg(public.playlist_json(p, true) order by p.updated_at desc, p.id)
            from public.playlists p where p.owner_id = p_user
        ), '[]'::jsonb),
        'friends', coalesce((
            select jsonb_agg(public.profile_card(o.other) || jsonb_build_object('status', o.status, 'direction', o.direction, 'since', o.at) order by o.status, lower(p.nick))
            from (
                select case when f.requester = p_user then f.addressee else f.requester end as other,
                       f.status,
                       case when f.status = 'accepted' then 'both' when f.requester = p_user then 'outgoing' else 'incoming' end as direction,
                       coalesce(f.accepted_at, f.created_at) as at
                from public.friendships f
                where p_user in (f.requester, f.addressee)
            ) o
            join public.profiles p on p.id = o.other
        ), '[]'::jsonb),
        'top4', public.top4_json(p_user)
    );
end;
$$;

-- ── 8. Реакции в комнатах (Realtime Authorization) ─────────────────────
-- Топик «roomfx:<uuid комнаты>:<эпоха>». Слушать и писать — любой участник
-- открытой комнаты в ТЕКУЩЕЙ эпохе (выгнанный теряет доступ сразу: после
-- исключения эпоха растёт, а старой для реакций нет даже у хозяина).
-- Аккаунт должен быть не забанен и не удалён.
create or replace function public.room_react_access(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    m text[] := regexp_match(coalesce(p_topic, ''), '^roomfx:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9]{1,9})$');
begin
    if m is null or not public.is_active_user() then
        return false;
    end if;
    return exists (
        select 1
        from public.rooms r
        join public.room_members mm on mm.room_id = r.id and mm.user_id = auth.uid()
        where r.id = m[1]::uuid
          and r.epoch = m[2]::integer
          and r.closed_at is null
    );
end;
$$;

drop policy if exists "rooms: members hear reactions" on realtime.messages;
create policy "rooms: members hear reactions" on realtime.messages
    for select to authenticated
    using (extension = 'broadcast' and public.room_react_access(realtime.topic()));

drop policy if exists "rooms: members send reactions" on realtime.messages;
create policy "rooms: members send reactions" on realtime.messages
    for insert to authenticated
    with check (extension = 'broadcast' and public.room_react_access(realtime.topic()));

-- ── 9. Журнал комнат (для будущих итогов года) ─────────────────────────
-- Запись участника в room_members удаляется при выходе, поэтому потом не
-- узнать, кто в каких комнатах был. Журнал хранит каждое пребывание:
-- кто, в какой комнате, хозяин или гость, когда вошёл и когда вышел.
-- Пишут триггеры на room_members, поэтому журнал ловит ВСЕ пути: выход,
-- исключение, закрытие комнаты, бан, удаление аккаунта, уборку по простою
-- и переход в другую комнату. Ни сайт, ни пользователи, ни админка его не
-- видят и не пишут: только service role (будущая статистика).
--   — room_id без внешнего ключа: комната может быть удалена, а история остаётся;
--   — user_id при удалении аккаунта становится null (обезличивание, как у
--     play_events);
--   — left_at null — пребывание ещё идёт.
create table if not exists public.room_visits (
    id bigint generated always as identity primary key,
    user_id uuid references auth.users (id) on delete set null,
    room_id uuid not null,
    role text not null check (role in ('owner', 'guest')),
    joined_at timestamptz not null default now(),
    left_at timestamptz,
    check (left_at is null or left_at >= joined_at)
);
create index if not exists room_visits_user_idx on public.room_visits (user_id, joined_at) where user_id is not null;
create index if not exists room_visits_room_idx on public.room_visits (room_id, joined_at);
create index if not exists room_visits_open_idx on public.room_visits (room_id, user_id) where left_at is null;

alter table public.room_visits enable row level security;
revoke all on table public.room_visits from public, anon, authenticated;
revoke all on sequence public.room_visits_id_seq from public, anon, authenticated;
grant all on table public.room_visits to service_role;
grant all on sequence public.room_visits_id_seq to service_role;

create or replace function public.room_visits_on_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.room_visits (user_id, room_id, role, joined_at)
    select new.user_id, new.room_id,
           case when r.owner_id = new.user_id then 'owner' else 'guest' end,
           new.joined_at
    from public.rooms r
    where r.id = new.room_id;
    return null;
end;
$$;

-- Закрываем пребывание. Ищем по комнате и времени входа, а не только по
-- user_id: при удалении аккаунта база могла уже обнулить user_id в журнале.
create or replace function public.room_visits_on_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.room_visits v
    set left_at = greatest(now(), v.joined_at)
    where v.room_id = old.room_id
      and v.left_at is null
      and v.joined_at = old.joined_at
      and (v.user_id = old.user_id or v.user_id is null);
    return null;
end;
$$;

drop trigger if exists room_visits_join on public.room_members;
create trigger room_visits_join
    after insert on public.room_members
    for each row execute function public.room_visits_on_join();

drop trigger if exists room_visits_leave on public.room_members;
create trigger room_visits_leave
    after delete on public.room_members
    for each row execute function public.room_visits_on_leave();

-- Те, кто уже сидит в комнатах в момент миграции, тоже попадают в журнал.
insert into public.room_visits (user_id, room_id, role, joined_at)
select m.user_id, m.room_id, case when r.owner_id = m.user_id then 'owner' else 'guest' end, m.joined_at
from public.room_members m
join public.rooms r on r.id = m.room_id
where not exists (
    select 1 from public.room_visits v
    where v.room_id = m.room_id and v.user_id = m.user_id and v.joined_at = m.joined_at
);

-- ── 10. Права на функции ───────────────────────────────────────────────
revoke all on function public.room_visits_on_join() from public, anon, authenticated;
revoke all on function public.room_visits_on_leave() from public, anon, authenticated;
revoke all on function public.user_is_live(uuid) from public, anon, authenticated;
revoke all on function public.top4_json(uuid) from public, anon, authenticated;
-- Политики Realtime вызываются от имени authenticated.
revoke all on function public.room_react_access(text) from public, anon;
grant execute on function public.room_react_access(text) to authenticated;

do $$
declare
    sig text;
begin
    foreach sig in array array[
        'public.top4_set(text[])',
        'public.user_top4(uuid)',
        'public.feed_prefs_get()',
        'public.feed_prefs_set(boolean)',
        'public.friends_feed(timestamptz, text, integer)',
        'public.admin_user_social(uuid)'
    ] loop
        execute format('revoke all on function %s from public, anon', sig);
        execute format('grant execute on function %s to authenticated', sig);
    end loop;
end
$$;
