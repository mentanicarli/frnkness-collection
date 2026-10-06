-- Этап «Музыка и друзья»: избранное, плейлисты (со своими обложками и
-- публичностью), «мой топ», друзья, «сейчас слушает»
-- (docs/frnkness-accounts-update.md, разделы 5–7 и 9).
--
-- Треки — только по постоянному id «<releaseId>/<slug>» (releases.json).
-- Каталог живёт в git, поэтому база проверяет лишь формат id: трек,
-- пропавший из каталога, сайт показывает как «недоступен».
--
-- Видимость: всем вошедшим — профиль и число друзей (profiles, этап 2);
-- только друзьям — избранное, плейлисты, топ, «сейчас слушает»; публичный
-- плейлист — всем вошедшим. Админы видят всё через admin_user_social.
--
-- Сайт читает и пишет только через RPC ниже (security definer, роль и бан
-- — по базе). Прямая запись в таблицы закрыта; прямое чтение разрешено
-- с теми же правилами (RLS), что у RPC.

-- ── 1. Таблицы ─────────────────────────────────────────────────────────
create table if not exists public.favorites (
    user_id uuid not null references auth.users (id) on delete cascade,
    track_id text not null check (char_length(track_id) <= 160 and track_id ~ '^[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*$'),
    created_at timestamptz not null default now(),
    primary key (user_id, track_id)
);
create index if not exists favorites_user_idx on public.favorites (user_id, created_at desc);

create table if not exists public.playlists (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    title text not null check (char_length(title) between 1 and 80),
    description text not null default '' check (char_length(description) <= 300),
    is_public boolean not null default false,
    -- null — обложка-коллаж; число — версия своей картинки
    -- (файл <owner_id>/<id> в бакете playlist-covers).
    cover_version bigint check (cover_version > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists playlists_owner_idx on public.playlists (owner_id, updated_at desc);

create table if not exists public.playlist_tracks (
    playlist_id uuid not null references public.playlists (id) on delete cascade,
    track_id text not null check (char_length(track_id) <= 160 and track_id ~ '^[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*$'),
    position integer not null check (position >= 1),
    added_at timestamptz not null default now(),
    -- Один трек в плейлисте — один раз.
    primary key (playlist_id, track_id),
    -- Проверка в конце запроса: перестановка — одним update.
    constraint playlist_tracks_position_key unique (playlist_id, position) deferrable initially immediate
);

create table if not exists public.friendships (
    id bigint generated always as identity primary key,
    requester uuid not null references auth.users (id) on delete cascade,
    addressee uuid not null references auth.users (id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'accepted')),
    created_at timestamptz not null default now(),
    accepted_at timestamptz,
    check (requester <> addressee),
    check ((status = 'accepted') = (accepted_at is not null))
);
-- Одна запись на пару в обе стороны.
create unique index if not exists friendships_pair_idx on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee_idx on public.friendships (addressee, status);
create index if not exists friendships_requester_idx on public.friendships (requester, status);

create table if not exists public.now_playing (
    user_id uuid primary key references auth.users (id) on delete cascade,
    track_id text not null check (char_length(track_id) <= 160 and track_id ~ '^[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*$'),
    updated_at timestamptz not null default now()
);

-- ── 2. Помощники ───────────────────────────────────────────────────────
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select a is not null and b is not null and exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and least(f.requester, f.addressee) = least(a, b)
          and greatest(f.requester, f.addressee) = greatest(a, b)
    )
$$;

-- Вошедший видит закрытое (избранное, все плейлисты, топ, «сейчас
-- слушает») пользователя p_user: это он сам или его друг.
create or replace function public.can_see_private(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.is_active_user() and (p_user = auth.uid() or public.are_friends(auth.uid(), p_user))
$$;

create or replace function public.can_view_playlist(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.is_active_user() and exists (
        select 1 from public.playlists p
        where p.id = p_id
          and (p.owner_id = auth.uid() or p.is_public or public.are_friends(auth.uid(), p.owner_id))
    )
$$;

-- Кто p_user для вошедшего: self | friend | incoming (он прислал заявку) |
-- outgoing (я прислал) | none.
create or replace function public.relation_to(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when p_user = auth.uid() then 'self'
        else coalesce((
            select case
                when f.status = 'accepted' then 'friend'
                when f.requester = auth.uid() then 'outgoing'
                else 'incoming'
            end
            from public.friendships f
            where least(f.requester, f.addressee) = least(p_user, auth.uid())
              and greatest(f.requester, f.addressee) = greatest(p_user, auth.uid())
        ), 'none')
    end
$$;

create or replace function public.friends_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
    select count(*)::integer from public.friendships f
    where f.status = 'accepted' and (f.requester = p_user or f.addressee = p_user)
$$;

-- «Сейчас слушает»: запись свежее 5 минут, иначе null.
create or replace function public.fresh_now_playing(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object('track_id', n.track_id, 'updated_at', n.updated_at)
    from public.now_playing n
    where n.user_id = p_user and n.updated_at > now() - interval '5 minutes'
$$;

-- Пользовательский текст: без управляющих символов (перевод строки в
-- описании оставляем), пробелы по краям убираем.
create or replace function public.clean_user_text(p text, p_multiline boolean)
returns text
language sql
immutable
set search_path = ''
as $$
    select btrim(
        case when p_multiline
            then regexp_replace(coalesce(p, ''), '[\x01-\x09\x0B-\x1F\x7F]', '', 'g')
            else regexp_replace(coalesce(p, ''), '[\x01-\x1F\x7F]', ' ', 'g')
        end
    )
$$;

create or replace function public.require_active_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.is_active_user() then
        raise exception 'Нужно войти' using errcode = '42501';
    end if;
    return auth.uid();
end;
$$;

-- Плейлист, которым владеет вошедший; иначе «не найден» (не выдаём, что
-- чужой плейлист существует).
create or replace function public.require_own_playlist(p_id uuid)
returns public.playlists
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    pl public.playlists;
begin
    select * into pl from public.playlists p where p.id = p_id and p.owner_id = uid for update;
    if not found then
        raise exception 'Плейлист не найден' using errcode = 'P0002';
    end if;
    return pl;
end;
$$;

-- ── 3. Лимиты (действуют для всех, включая service role) ──────────────
create or replace function public.playlists_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    perform pg_advisory_xact_lock(hashtext('playlists:' || new.owner_id::text));
    if (select count(*) from public.playlists p where p.owner_id = new.owner_id) >= 50 then
        raise exception 'Не больше 50 плейлистов' using errcode = '54000';
    end if;
    return new;
end;
$$;

drop trigger if exists playlists_limit on public.playlists;
create trigger playlists_limit
    before insert on public.playlists
    for each row execute function public.playlists_limit();

create or replace function public.playlist_tracks_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    perform pg_advisory_xact_lock(hashtext('playlist-tracks:' || new.playlist_id::text));
    if (select count(*) from public.playlist_tracks t where t.playlist_id = new.playlist_id) >= 200 then
        raise exception 'Не больше 200 треков в плейлисте' using errcode = '54000';
    end if;
    return new;
end;
$$;

drop trigger if exists playlist_tracks_limit on public.playlist_tracks;
create trigger playlist_tracks_limit
    before insert on public.playlist_tracks
    for each row execute function public.playlist_tracks_limit();

revoke all on function public.playlists_limit() from public, anon, authenticated;
revoke all on function public.playlist_tracks_limit() from public, anon, authenticated;

-- ── 4. Права на таблицы (RLS) ──────────────────────────────────────────
alter table public.favorites enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.friendships enable row level security;
alter table public.now_playing enable row level security;

revoke all on table public.favorites, public.playlists, public.playlist_tracks, public.friendships, public.now_playing from public, anon, authenticated;
grant select on table public.favorites, public.playlists, public.playlist_tracks, public.friendships, public.now_playing to authenticated;
grant all on table public.favorites, public.playlists, public.playlist_tracks, public.friendships, public.now_playing to service_role;

drop policy if exists "favorites: own or friend" on public.favorites;
create policy "favorites: own or friend" on public.favorites
    for select to authenticated
    using (public.can_see_private(user_id));

drop policy if exists "playlists: visible" on public.playlists;
create policy "playlists: visible" on public.playlists
    for select to authenticated
    using (public.is_active_user() and (owner_id = auth.uid() or is_public or public.are_friends(auth.uid(), owner_id)));

drop policy if exists "playlist_tracks: visible" on public.playlist_tracks;
create policy "playlist_tracks: visible" on public.playlist_tracks
    for select to authenticated
    using (public.can_view_playlist(playlist_id));

drop policy if exists "friendships: own" on public.friendships;
create policy "friendships: own" on public.friendships
    for select to authenticated
    using (public.is_active_user() and auth.uid() in (requester, addressee));

drop policy if exists "now_playing: own or friend" on public.now_playing;
create policy "now_playing: own or friend" on public.now_playing
    for select to authenticated
    using (public.can_see_private(user_id) and updated_at > now() - interval '5 minutes');

-- ── 5. Избранное ───────────────────────────────────────────────────────
create or replace function public.favorite_set(p_track_id text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    if p_on then
        perform pg_advisory_xact_lock(hashtext('favorites:' || uid::text));
        if (select count(*) from public.favorites f where f.user_id = uid) >= 2000 then
            raise exception 'Не больше 2000 треков в избранном' using errcode = '54000';
        end if;
        insert into public.favorites (user_id, track_id) values (uid, p_track_id)
        on conflict (user_id, track_id) do nothing;
    else
        delete from public.favorites f where f.user_id = uid and f.track_id = p_track_id;
    end if;
    return jsonb_build_object('track_id', p_track_id, 'on', p_on);
end;
$$;

-- Избранное пользователя (новые сверху): сам или друг.
create or replace function public.user_favorites(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    perform public.require_active_user();
    if not public.can_see_private(p_user) then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object('track_id', f.track_id, 'added_at', f.created_at) order by f.created_at desc, f.track_id)
        from public.favorites f where f.user_id = p_user
    ), '[]'::jsonb);
end;
$$;

-- ── 6. Плейлисты ───────────────────────────────────────────────────────
create or replace function public.playlist_json(pl public.playlists, p_with_tracks boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'id', pl.id,
        'owner_id', pl.owner_id,
        'title', pl.title,
        'description', pl.description,
        'is_public', pl.is_public,
        'cover_version', pl.cover_version,
        'created_at', pl.created_at,
        'updated_at', pl.updated_at,
        'track_count', (select count(*) from public.playlist_tracks t where t.playlist_id = pl.id),
        -- Для коллажа: первые треки.
        'first_tracks', coalesce((
            select jsonb_agg(x.track_id order by x.position)
            from (select t.track_id, t.position from public.playlist_tracks t where t.playlist_id = pl.id order by t.position limit 8) x
        ), '[]'::jsonb)
    ) || case when p_with_tracks then jsonb_build_object(
        'tracks', coalesce((
            select jsonb_agg(t.track_id order by t.position)
            from public.playlist_tracks t where t.playlist_id = pl.id
        ), '[]'::jsonb),
        'owner', (select jsonb_build_object('id', p.id, 'nick', p.nick, 'avatar', p.avatar) from public.profiles p where p.id = pl.owner_id)
    ) else '{}'::jsonb end
$$;

create or replace function public.playlist_create(p_title text, p_description text default '', p_is_public boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    v_title text := public.clean_user_text(p_title, false);
    v_descr text := public.clean_user_text(p_description, true);
    pl public.playlists;
begin
    if char_length(v_title) < 1 or char_length(v_title) > 80 then
        raise exception 'Название — от 1 до 80 символов' using errcode = '22023';
    end if;
    if char_length(v_descr) > 300 then
        raise exception 'Описание — до 300 символов' using errcode = '22023';
    end if;
    insert into public.playlists (owner_id, title, description, is_public)
    values (uid, v_title, v_descr, coalesce(p_is_public, false))
    returning * into pl;
    return public.playlist_json(pl, true);
end;
$$;

-- null в поле — не менять.
create or replace function public.playlist_update(p_id uuid, p_title text default null, p_description text default null, p_is_public boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    pl public.playlists := public.require_own_playlist(p_id);
    v_title text := case when p_title is null then pl.title else public.clean_user_text(p_title, false) end;
    v_descr text := case when p_description is null then pl.description else public.clean_user_text(p_description, true) end;
begin
    if char_length(v_title) < 1 or char_length(v_title) > 80 then
        raise exception 'Название — от 1 до 80 символов' using errcode = '22023';
    end if;
    if char_length(v_descr) > 300 then
        raise exception 'Описание — до 300 символов' using errcode = '22023';
    end if;
    update public.playlists p
    set title = v_title,
        description = v_descr,
        is_public = coalesce(p_is_public, p.is_public),
        updated_at = now()
    where p.id = p_id
    returning * into pl;
    return public.playlist_json(pl, false);
end;
$$;

-- Свою картинку сайт сначала удаляет из Storage (файл <owner>/<id>),
-- потом удаляет плейлист: файлы Storage удаляются только через его API.
create or replace function public.playlist_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_own_playlist(p_id);
    delete from public.playlists p where p.id = p_id;
end;
$$;

create or replace function public.playlist_add_track(p_id uuid, p_track_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    pl public.playlists := public.require_own_playlist(p_id);
begin
    if exists (select 1 from public.playlist_tracks t where t.playlist_id = p_id and t.track_id = p_track_id) then
        raise exception 'Трек уже в плейлисте' using errcode = '23505';
    end if;
    insert into public.playlist_tracks (playlist_id, track_id, position)
    values (p_id, p_track_id, coalesce((select max(t.position) from public.playlist_tracks t where t.playlist_id = p_id), 0) + 1);
    update public.playlists p set updated_at = now() where p.id = p_id returning * into pl;
    return public.playlist_json(pl, false);
end;
$$;

create or replace function public.playlist_remove_track(p_id uuid, p_track_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    pl public.playlists := public.require_own_playlist(p_id);
begin
    delete from public.playlist_tracks t where t.playlist_id = p_id and t.track_id = p_track_id;
    update public.playlist_tracks t set position = r.rn
    from (select x.track_id, row_number() over (order by x.position)::integer as rn from public.playlist_tracks x where x.playlist_id = p_id) r
    where t.playlist_id = p_id and t.track_id = r.track_id and t.position <> r.rn;
    update public.playlists p set updated_at = now() where p.id = p_id returning * into pl;
    return public.playlist_json(pl, false);
end;
$$;

-- Новый порядок: p_track_ids — ровно те же треки, что в плейлисте.
create or replace function public.playlist_reorder(p_id uuid, p_track_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    pl public.playlists := public.require_own_playlist(p_id);
    n integer := coalesce(cardinality(p_track_ids), 0);
begin
    if n <> (select count(*) from public.playlist_tracks t where t.playlist_id = p_id)
       or n <> (select count(distinct x) from unnest(p_track_ids) x)
       or exists (
           select 1 from unnest(p_track_ids) x
           where not exists (select 1 from public.playlist_tracks t where t.playlist_id = p_id and t.track_id = x)
       ) then
        raise exception 'Плейлист изменился — обнови страницу' using errcode = '22023';
    end if;
    update public.playlist_tracks t set position = o.ord::integer
    from unnest(p_track_ids) with ordinality as o(track_id, ord)
    where t.playlist_id = p_id and t.track_id = o.track_id;
    update public.playlists p set updated_at = now() where p.id = p_id returning * into pl;
    return public.playlist_json(pl, true);
end;
$$;

-- Своя обложка: сайт загружает файл <owner>/<id> в playlist-covers и
-- записывает версию; null — вернуться к коллажу (файл сайт удаляет сам).
create or replace function public.playlist_set_cover(p_id uuid, p_version bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    pl public.playlists := public.require_own_playlist(p_id);
begin
    if p_version is not null and p_version <= 0 then
        raise exception 'Неверная версия обложки' using errcode = '22023';
    end if;
    update public.playlists p set cover_version = p_version, updated_at = now() where p.id = p_id returning * into pl;
    return public.playlist_json(pl, false);
end;
$$;

-- Плейлист с треками, если его можно видеть; иначе «не найден».
create or replace function public.playlist_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    pl public.playlists;
begin
    perform public.require_active_user();
    if not public.can_view_playlist(p_id) then
        raise exception 'Плейлист не найден' using errcode = 'P0002';
    end if;
    select * into pl from public.playlists p where p.id = p_id;
    return public.playlist_json(pl, true);
end;
$$;

-- Плейлисты пользователя: себе и друзьям — все, остальным — публичные.
create or replace function public.user_playlists(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    all_visible boolean;
begin
    perform public.require_active_user();
    all_visible := public.can_see_private(p_user);
    return coalesce((
        select jsonb_agg(public.playlist_json(p, false) order by p.updated_at desc, p.id)
        from public.playlists p
        where p.owner_id = p_user and (all_visible or p.is_public)
    ), '[]'::jsonb);
end;
$$;

-- ── 7. «Мой топ» ───────────────────────────────────────────────────────
-- Как общий счётчик и чарт: прослушивание засчитано после 10 секунд
-- (play_events с user_id). p_days: 7, 30 или null — за всё время.
-- Ключи — «<releaseId>-<индекс>»; в id треков переводит сайт. Отдаём с
-- запасом: ключи пропавших из каталога треков сайт отбросит.
create or replace function public.user_top(p_user uuid, p_days integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    perform public.require_active_user();
    if not public.can_see_private(p_user) then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    if p_days is not null and p_days not in (7, 30) then
        raise exception 'Период — 7 или 30 дней или всё время' using errcode = '22023';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object('track_key', t.track_key, 'plays', t.n) order by t.n desc, t.track_key)
        from (
            select e.track_key, count(*)::integer as n
            from public.play_events e
            where e.user_id = p_user
              and (p_days is null or e.created_at > now() - make_interval(days => p_days))
            group by e.track_key
            order by count(*) desc, e.track_key
            limit 40
        ) t
    ), '[]'::jsonb);
end;
$$;

-- ── 8. «Сейчас слушает» ────────────────────────────────────────────────
-- Сайт шлёт при смене трека (не чаще раза в минуту) и раз в 2 минуты, пока
-- играет. База пишет не чаще раза в 30 секунд — лишние вызовы ничего не стоят.
create or replace function public.now_playing_set(p_track_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    insert into public.now_playing as n (user_id, track_id, updated_at)
    values (uid, p_track_id, now())
    on conflict (user_id) do update set track_id = excluded.track_id, updated_at = excluded.updated_at
    where n.updated_at < now() - interval '30 seconds';
end;
$$;

-- ── 9. Друзья ──────────────────────────────────────────────────────────
create or replace function public.profile_card(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object('id', p.id, 'nick', p.nick, 'avatar', p.avatar)
    from public.profiles p where p.id = p_user
$$;

-- Заявка в друзья. Встречная заявка принимается сразу. Не больше 20
-- исходящих заявок в сутки.
create or replace function public.friend_request(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    f public.friendships;
begin
    if p_user = uid then
        raise exception 'Нельзя добавить в друзья себя' using errcode = '22023';
    end if;
    if not exists (select 1 from public.profiles p where p.id = p_user) then
        raise exception 'Пользователь не найден' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(hashtext('friends:' || least(uid, p_user)::text || greatest(uid, p_user)::text));
    select * into f from public.friendships x
    where least(x.requester, x.addressee) = least(uid, p_user) and greatest(x.requester, x.addressee) = greatest(uid, p_user);
    if found then
        if f.status = 'accepted' then
            raise exception 'Вы уже друзья' using errcode = '23505';
        end if;
        if f.requester = uid then
            raise exception 'Заявка уже отправлена' using errcode = '23505';
        end if;
        update public.friendships x set status = 'accepted', accepted_at = now() where x.id = f.id;
        return jsonb_build_object('status', 'accepted');
    end if;
    if not public.rate_limit_hit('friend-request', uid::text, 20, interval '1 day') then
        raise exception 'Не больше 20 заявок в сутки — попробуй завтра' using errcode = '54000';
    end if;
    insert into public.friendships (requester, addressee) values (uid, p_user);
    return jsonb_build_object('status', 'pending');
end;
$$;

-- Входящая заявка от p_user: принять или отклонить.
create or replace function public.friend_respond(p_user uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    if p_accept then
        update public.friendships f set status = 'accepted', accepted_at = now()
        where f.requester = p_user and f.addressee = uid and f.status = 'pending';
    else
        delete from public.friendships f where f.requester = p_user and f.addressee = uid and f.status = 'pending';
    end if;
    if not found then
        raise exception 'Заявка не найдена' using errcode = 'P0002';
    end if;
    return jsonb_build_object('status', case when p_accept then 'accepted' else 'none' end);
end;
$$;

-- Отменить свою заявку.
create or replace function public.friend_cancel(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    delete from public.friendships f where f.requester = uid and f.addressee = p_user and f.status = 'pending';
    if not found then
        raise exception 'Заявка не найдена' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.friend_remove(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    delete from public.friendships f
    where f.status = 'accepted'
      and least(f.requester, f.addressee) = least(uid, p_user)
      and greatest(f.requester, f.addressee) = greatest(uid, p_user);
    if not found then
        raise exception 'Вы не друзья' using errcode = 'P0002';
    end if;
end;
$$;

-- Мои друзья (с «сейчас слушает»), входящие и исходящие заявки.
create or replace function public.friends_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    return jsonb_build_object(
        'friends', coalesce((
            select jsonb_agg(public.profile_card(o.other) || jsonb_build_object('since', o.accepted_at, 'now_playing', public.fresh_now_playing(o.other)) order by lower(p.nick))
            from (
                select case when f.requester = uid then f.addressee else f.requester end as other, f.accepted_at
                from public.friendships f
                where f.status = 'accepted' and uid in (f.requester, f.addressee)
            ) o
            join public.profiles p on p.id = o.other
        ), '[]'::jsonb),
        'incoming', coalesce((
            select jsonb_agg(public.profile_card(f.requester) || jsonb_build_object('created_at', f.created_at) order by f.created_at desc)
            from public.friendships f join public.profiles p on p.id = f.requester
            where f.addressee = uid and f.status = 'pending'
        ), '[]'::jsonb),
        'outgoing', coalesce((
            select jsonb_agg(public.profile_card(f.addressee) || jsonb_build_object('created_at', f.created_at) order by f.created_at desc)
            from public.friendships f join public.profiles p on p.id = f.addressee
            where f.requester = uid and f.status = 'pending'
        ), '[]'::jsonb)
    );
end;
$$;

-- Индикатор в шапке: входящие заявки, ещё не принятые и не отклонённые.
create or replace function public.friend_requests_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    return (select count(*)::integer from public.friendships f where f.addressee = uid and f.status = 'pending');
end;
$$;

-- Поиск по нику (без учёта регистра, е = ё, похожие латинские = кириллические).
create or replace function public.user_search(p_query text)
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
begin
    if char_length(q) < 1 then
        return '[]'::jsonb;
    end if;
    if char_length(q) > 20 then
        raise exception 'Слишком длинный запрос' using errcode = '22023';
    end if;
    pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    return coalesce((
        select jsonb_agg(public.profile_card(x.id) || jsonb_build_object('relation', public.relation_to(x.id)) order by x.exact desc, x.nick_len, lower(x.nick))
        from (
            select p.id, p.nick, char_length(p.nick) as nick_len, p.nick_key = q as exact
            from public.profiles p
            where p.nick_key like pattern and p.id <> uid
            order by p.nick_key = q desc, char_length(p.nick), lower(p.nick)
            limit 20
        ) x
    ), '[]'::jsonb);
end;
$$;

-- Страница пользователя по нику: открытое всем вошедшим, отношение ко мне
-- и — только себе и друзьям — «сейчас слушает». null — такого ника нет.
create or replace function public.profile_by_nick(p_nick text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    p public.profiles;
    rel text;
begin
    perform public.require_active_user();
    if char_length(coalesce(p_nick, '')) > 40 then
        return null;
    end if;
    select * into p from public.profiles x where x.nick_key = public.account_nick_key(p_nick);
    if not found then
        return null;
    end if;
    rel := public.relation_to(p.id);
    return jsonb_build_object(
        'id', p.id,
        'nick', p.nick,
        'avatar', p.avatar,
        'bio', p.bio,
        'created_at', p.created_at,
        'friends_count', public.friends_count(p.id),
        'relation', rel,
        'now_playing', case when rel in ('self', 'friend') then public.fresh_now_playing(p.id) end
    );
end;
$$;

-- ── 10. Админка: данные в карточке пользователя ────────────────────────
-- Модерация (переименовать, удалить плейлист, удалить обложку) — функция
-- admin-users: обложки удаляются через API Storage.
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
        ), '[]'::jsonb)
    );
end;
$$;

-- ── 11. Права на функции ───────────────────────────────────────────────
-- Внутренние помощники — только для политик и других функций.
revoke all on function public.are_friends(uuid, uuid) from public, anon;
revoke all on function public.can_see_private(uuid) from public, anon;
revoke all on function public.can_view_playlist(uuid) from public, anon;
revoke all on function public.relation_to(uuid) from public, anon, authenticated;
revoke all on function public.friends_count(uuid) from public, anon, authenticated;
revoke all on function public.fresh_now_playing(uuid) from public, anon, authenticated;
revoke all on function public.clean_user_text(text, boolean) from public, anon, authenticated;
revoke all on function public.require_active_user() from public, anon, authenticated;
revoke all on function public.require_own_playlist(uuid) from public, anon, authenticated;
revoke all on function public.playlist_json(public.playlists, boolean) from public, anon, authenticated;
revoke all on function public.profile_card(uuid) from public, anon, authenticated;
-- Политики RLS вызываются от имени authenticated.
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.can_see_private(uuid) to authenticated;
grant execute on function public.can_view_playlist(uuid) to authenticated;

do $$
declare
    sig text;
begin
    foreach sig in array array[
        'public.favorite_set(text, boolean)',
        'public.user_favorites(uuid)',
        'public.playlist_create(text, text, boolean)',
        'public.playlist_update(uuid, text, text, boolean)',
        'public.playlist_delete(uuid)',
        'public.playlist_add_track(uuid, text)',
        'public.playlist_remove_track(uuid, text)',
        'public.playlist_reorder(uuid, text[])',
        'public.playlist_set_cover(uuid, bigint)',
        'public.playlist_get(uuid)',
        'public.user_playlists(uuid)',
        'public.user_top(uuid, integer)',
        'public.now_playing_set(text)',
        'public.friend_request(uuid)',
        'public.friend_respond(uuid, boolean)',
        'public.friend_cancel(uuid)',
        'public.friend_remove(uuid)',
        'public.friends_list()',
        'public.friend_requests_count()',
        'public.user_search(text)',
        'public.profile_by_nick(text)',
        'public.admin_user_social(uuid)'
    ] loop
        execute format('revoke all on function %s from public, anon', sig);
        execute format('grant execute on function %s to authenticated', sig);
    end loop;
end
$$;

-- ── 12. Обложки плейлистов ─────────────────────────────────────────────
-- Приватный бакет: видимость как у плейлиста (сайт берёт подписанные
-- ссылки). Файл — <owner_id>/<playlist_id>, браузер ужимает до 512×512.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('playlist-covers', 'playlist-covers', false, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- id плейлиста из имени файла «<uuid>/<uuid>», иначе null.
create or replace function public.playlist_cover_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
    select case
        when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then split_part(p_name, '/', 2)::uuid
    end
$$;

-- Загрузить и заменить: только владелец плейлиста, в свою папку.
create or replace function public.playlist_cover_writable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.is_active_user()
       and split_part(p_name, '/', 1) = auth.uid()::text
       and exists (
           select 1 from public.playlists p
           where p.id = public.playlist_cover_id(p_name) and p.owner_id = auth.uid()
       )
$$;

create or replace function public.playlist_cover_visible(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.can_view_playlist(public.playlist_cover_id(p_name))
       and exists (
           select 1 from public.playlists p
           where p.id = public.playlist_cover_id(p_name) and p.owner_id::text = split_part(p_name, '/', 1)
       )
$$;

revoke all on function public.playlist_cover_id(text) from public, anon;
revoke all on function public.playlist_cover_writable(text) from public, anon;
revoke all on function public.playlist_cover_visible(text) from public, anon;
grant execute on function public.playlist_cover_id(text) to authenticated;
grant execute on function public.playlist_cover_writable(text) to authenticated;
grant execute on function public.playlist_cover_visible(text) to authenticated;

drop policy if exists "playlist-covers: owner insert" on storage.objects;
create policy "playlist-covers: owner insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'playlist-covers' and public.playlist_cover_writable(name));

drop policy if exists "playlist-covers: owner update" on storage.objects;
create policy "playlist-covers: owner update" on storage.objects
    for update to authenticated
    using (bucket_id = 'playlist-covers' and public.playlist_cover_writable(name))
    with check (bucket_id = 'playlist-covers' and public.playlist_cover_writable(name));

-- Удалить — любой файл в своей папке (в том числе оставшийся от
-- удалённого плейлиста).
drop policy if exists "playlist-covers: owner delete" on storage.objects;
create policy "playlist-covers: owner delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'playlist-covers' and public.is_active_user() and split_part(name, '/', 1) = (select auth.uid()::text));

drop policy if exists "playlist-covers: visible" on storage.objects;
create policy "playlist-covers: visible" on storage.objects
    for select to authenticated
    using (bucket_id = 'playlist-covers' and public.playlist_cover_visible(name));
