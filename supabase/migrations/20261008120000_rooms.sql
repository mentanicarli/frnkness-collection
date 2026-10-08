-- Этап «Комнаты»: совместное прослушивание. Хозяин управляет плеером,
-- остальные слушают то же самое в то же время.
--
-- Что здесь:
--   — таблицы rooms, room_members, room_kicks, room_invites;
--   — RPC для сайта и админки (security definer, роль и бан — по базе);
--   — Realtime Authorization: политики на realtime.messages, по которым
--     канал комнаты слушают только её участники, а команды шлёт только хозяин;
--   — закрытие комнат при бане и удалении аккаунта.
--
-- Сайт читает и пишет только через RPC: прямого доступа к таблицам нет.
-- Время считается по часам сервера (server_now, state_at): seq и at
-- выдаёт room_set_state, клиенту их выдумывать нельзя.
--
-- Канал комнаты — приватный топик «room:<uuid комнаты>:<эпоха>». Эпоха
-- растёт при каждом исключении участника: Realtime проверяет права при входе
-- в канал, поэтому выгнанный мог бы слушать старый топик на уже открытом
-- соединении. После исключения все остальные переезжают на новый топик,
-- а политика пускает только в текущую эпоху.

-- ── 1. Таблицы ─────────────────────────────────────────────────────────
create table if not exists public.rooms (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users (id) on delete cascade,
    title text not null check (char_length(title) between 1 and 40),
    -- Растёт при исключении участника (см. выше).
    epoch integer not null default 0 check (epoch >= 0),
    -- Состояние плеера хозяина: трек, очередь, позиция, играет/пауза.
    state jsonb not null default '{}'::jsonb
        check (jsonb_typeof(state) = 'object' and pg_column_size(state) <= 65536),
    -- Номер и момент (часы сервера) последнего сохранённого состояния.
    seq bigint not null default 0,
    state_at timestamptz,
    -- Когда хозяин в последний раз подавал признаки жизни.
    owner_seen_at timestamptz not null default now(),
    -- Любая активность участников: по ней комната закрывается через 30 минут пустоты.
    last_activity timestamptz not null default now(),
    created_at timestamptz not null default now(),
    closed_at timestamptz,
    closed_reason text check (closed_reason in ('owner', 'idle', 'owner_blocked', 'admin')),
    check ((closed_at is null) = (closed_reason is null))
);
-- У хозяина одна открытая комната.
create unique index if not exists rooms_one_open_per_owner on public.rooms (owner_id) where closed_at is null;
create index if not exists rooms_open_activity_idx on public.rooms (last_activity) where closed_at is null;

create table if not exists public.room_members (
    room_id uuid not null references public.rooms (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    joined_at timestamptz not null default now(),
    last_seen timestamptz not null default now(),
    primary key (room_id, user_id)
);
-- Пользователь одновременно только в одной комнате.
create unique index if not exists room_members_one_room_per_user on public.room_members (user_id);

create table if not exists public.room_kicks (
    room_id uuid not null references public.rooms (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    kicked_at timestamptz not null default now(),
    primary key (room_id, user_id)
);

create table if not exists public.room_invites (
    room_id uuid not null references public.rooms (id) on delete cascade,
    to_user uuid not null references auth.users (id) on delete cascade,
    from_user uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (room_id, to_user),
    check (to_user <> from_user)
);
create index if not exists room_invites_to_idx on public.room_invites (to_user, created_at desc);

-- ── 2. Права на таблицы ────────────────────────────────────────────────
-- Прямого доступа нет ни у кого, кроме service role: всё идёт через RPC.
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_kicks enable row level security;
alter table public.room_invites enable row level security;

revoke all on table public.rooms, public.room_members, public.room_kicks, public.room_invites from public, anon, authenticated;
grant all on table public.rooms, public.room_members, public.room_kicks, public.room_invites to service_role;

-- ── 3. Помощники ───────────────────────────────────────────────────────
create or replace function public.epoch_ms(p_ts timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$
    select case when p_ts is null then null else floor(extract(epoch from p_ts) * 1000)::bigint end
$$;

-- Закрыть комнату: участники выходят, приглашения и список выгнанных удаляются.
create or replace function public.room_close_internal(p_room uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.rooms r set closed_at = now(), closed_reason = p_reason
    where r.id = p_room and r.closed_at is null;
    if not found then
        return false;
    end if;
    delete from public.room_members m where m.room_id = p_room;
    delete from public.room_invites i where i.room_id = p_room;
    delete from public.room_kicks k where k.room_id = p_room;
    return true;
end;
$$;

-- Уборка «при обращении» (pg_cron на бесплатном тарифе не нужен): комнаты без
-- признаков жизни 30 минут закрываются, давно пропавшие участники (кроме
-- хозяина — он может вернуться после перезагрузки) выходят, старые приглашения
-- удаляются. Вызывается из RPC комнат.
create or replace function public.rooms_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    idle uuid;
begin
    for idle in
        select r.id from public.rooms r
        where r.closed_at is null and r.last_activity < now() - interval '30 minutes'
    loop
        perform public.room_close_internal(idle, 'idle');
    end loop;
    delete from public.room_members m
    using public.rooms r
    where m.room_id = r.id and m.user_id <> r.owner_id and m.last_seen < now() - interval '10 minutes';
    delete from public.room_invites i where i.created_at < now() - interval '6 hours';
end;
$$;

-- Комната, которой владеет вошедший (открытая); иначе «не найдена».
create or replace function public.require_own_room(p_room uuid)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    r public.rooms;
begin
    select * into r from public.rooms x where x.id = p_room and x.owner_id = uid and x.closed_at is null for update;
    if not found then
        raise exception 'Комната не найдена' using errcode = 'P0002';
    end if;
    return r;
end;
$$;

-- Комната для сайта: участники, состояние, часы сервера.
create or replace function public.room_json(r public.rooms, uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'epoch', r.epoch,
        'owner', public.profile_card(r.owner_id),
        'is_owner', r.owner_id = uid,
        'capacity', 20,
        'members', coalesce((
            select jsonb_agg(
                public.profile_card(m.user_id) || jsonb_build_object('joined_at', m.joined_at, 'owner', m.user_id = r.owner_id)
                order by (m.user_id = r.owner_id) desc, m.joined_at, m.user_id
            )
            from public.room_members m where m.room_id = r.id
        ), '[]'::jsonb),
        'state', r.state,
        'seq', r.seq,
        'at_ms', public.epoch_ms(r.state_at),
        'owner_seen_ms', public.epoch_ms(r.owner_seen_at),
        'server_ms', public.epoch_ms(clock_timestamp())
    )
$$;

-- Доступ к приватному каналу комнаты (политики realtime.messages).
-- Топик: room:<uuid>:<эпоха>. p_owner_only — только хозяин. Участник
-- должен быть в комнате сейчас, комната — открыта, эпоха — текущей, аккаунт —
-- не забанен и не удалён.
create or replace function public.room_topic_access(p_topic text, p_owner_only boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    m text[] := regexp_match(coalesce(p_topic, ''), '^room:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9]{1,9})$');
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
          and (not p_owner_only or r.owner_id = auth.uid())
    );
end;
$$;

-- ── 4. Realtime Authorization ──────────────────────────────────────────
-- Слушать (broadcast и presence): участники комнаты. Отправлять команды
-- (broadcast): только хозяин. Объявлять себя в Presence: участники.
-- Других политик на realtime.messages нет — всё остальное запрещено.
drop policy if exists "rooms: members listen" on realtime.messages;
create policy "rooms: members listen" on realtime.messages
    for select to authenticated
    using (extension in ('broadcast', 'presence') and public.room_topic_access(realtime.topic(), false));

drop policy if exists "rooms: owner sends commands" on realtime.messages;
create policy "rooms: owner sends commands" on realtime.messages
    for insert to authenticated
    with check (extension = 'broadcast' and public.room_topic_access(realtime.topic(), true));

drop policy if exists "rooms: members announce presence" on realtime.messages;
create policy "rooms: members announce presence" on realtime.messages
    for insert to authenticated
    with check (extension = 'presence' and public.room_topic_access(realtime.topic(), false));

-- ── 5. Часы сервера ────────────────────────────────────────────────────
-- Сайт оценивает сдвиг своих часов несколькими вызовами (src/site/rooms/sync.ts).
create or replace function public.server_now()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    perform public.require_active_user();
    return public.epoch_ms(clock_timestamp());
end;
$$;

-- ── 6. Комнаты: создать, войти, выйти, закрыть ─────────────────────────
create or replace function public.room_create(p_title text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    v_title text := public.clean_user_text(p_title, false);
    r public.rooms;
begin
    if char_length(v_title) > 40 then
        raise exception 'Название — до 40 символов' using errcode = '22023';
    end if;
    if v_title = '' then
        v_title := left('Комната ' || (select p.nick from public.profiles p where p.id = uid), 40);
    end if;
    perform public.rooms_sweep();
    perform pg_advisory_xact_lock(hashtext('room-owner:' || uid::text));
    if exists (select 1 from public.rooms x where x.owner_id = uid and x.closed_at is null) then
        raise exception 'У тебя уже есть открытая комната' using errcode = '23505';
    end if;
    if not public.rate_limit_hit('room-create', uid::text, 20, interval '1 hour') then
        raise exception 'Слишком часто — попробуй позже' using errcode = '54000';
    end if;
    -- Из чужой комнаты выходим: одновременно — только в одной.
    delete from public.room_members m where m.user_id = uid;
    insert into public.rooms (owner_id, title) values (uid, v_title) returning * into r;
    insert into public.room_members (room_id, user_id) values (r.id, uid);
    return public.room_json(r, uid);
end;
$$;

create or replace function public.room_join(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    r public.rooms;
begin
    perform public.rooms_sweep();
    select * into r from public.rooms x where x.id = p_room and x.closed_at is null for update;
    if not found then
        raise exception 'Комната не найдена или уже закрыта' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.room_kicks k where k.room_id = r.id and k.user_id = uid) then
        raise exception 'Тебя выгнали из этой комнаты' using errcode = '42501';
    end if;
    if exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = uid) then
        update public.room_members m set last_seen = now() where m.room_id = r.id and m.user_id = uid;
        return public.room_json(r, uid);
    end if;
    if exists (select 1 from public.rooms o where o.owner_id = uid and o.closed_at is null) then
        raise exception 'Сначала закрой свою комнату' using errcode = '22023';
    end if;
    if (select count(*) from public.room_members m where m.room_id = r.id) >= 20 then
        raise exception 'В комнате уже 20 человек' using errcode = '54000';
    end if;
    delete from public.room_members m where m.user_id = uid;
    insert into public.room_members (room_id, user_id) values (r.id, uid);
    delete from public.room_invites i where i.room_id = r.id and i.to_user = uid;
    update public.rooms x set last_activity = now() where x.id = r.id;
    select * into r from public.rooms x where x.id = r.id;
    return public.room_json(r, uid);
end;
$$;

-- Выйти из текущей комнаты. Хозяин не выходит, а закрывает комнату.
create or replace function public.room_leave()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    rid uuid;
    owner uuid;
begin
    select m.room_id, r.owner_id into rid, owner
    from public.room_members m join public.rooms r on r.id = m.room_id
    where m.user_id = uid;
    if not found then
        return;
    end if;
    if owner = uid then
        raise exception 'Хозяин не выходит из комнаты, а закрывает её' using errcode = '22023';
    end if;
    delete from public.room_members m where m.user_id = uid;
end;
$$;

create or replace function public.room_close(p_room uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    r public.rooms := public.require_own_room(p_room);
begin
    perform public.room_close_internal(r.id, 'owner');
end;
$$;

-- ── 7. Чтение ──────────────────────────────────────────────────────────
-- Комната участника целиком. Не участнику — «не найдена».
create or replace function public.room_get(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    r public.rooms;
begin
    perform public.rooms_sweep();
    select x.* into r
    from public.rooms x
    join public.room_members m on m.room_id = x.id and m.user_id = uid
    where x.id = p_room and x.closed_at is null;
    if not found then
        raise exception 'Комната не найдена или уже закрыта' using errcode = 'P0002';
    end if;
    return public.room_json(r, uid);
end;
$$;

-- Моя текущая комната (если есть).
create or replace function public.room_my()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    r public.rooms;
begin
    perform public.rooms_sweep();
    select x.* into r
    from public.rooms x
    join public.room_members m on m.room_id = x.id and m.user_id = uid
    where x.closed_at is null;
    if not found then
        return null;
    end if;
    return public.room_json(r, uid);
end;
$$;

-- Что видит человек, открывший ссылку на комнату (ещё не участник): название,
-- хозяин, сколько людей. Состояния и списка участников здесь нет.
create or replace function public.room_info(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    r public.rooms;
    n integer;
begin
    perform public.rooms_sweep();
    select * into r from public.rooms x where x.id = p_room;
    if not found or r.closed_at is not null then
        return jsonb_build_object('closed', true);
    end if;
    select count(*)::integer into n from public.room_members m where m.room_id = r.id;
    return jsonb_build_object(
        'closed', false,
        'id', r.id,
        'title', r.title,
        'owner', public.profile_card(r.owner_id),
        'members', n,
        'capacity', 20,
        'full', n >= 20,
        'is_member', exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = uid),
        'kicked', exists (select 1 from public.room_kicks k where k.room_id = r.id and k.user_id = uid)
    );
end;
$$;

-- ── 8. Состояние и «признаки жизни» ────────────────────────────────────
-- Хозяин сохраняет состояние плеера при каждом изменении. seq и at (часы
-- сервера) выдаёт база: после перезагрузки хозяина номера не начинаются
-- заново, и гости не отбросят его команды. Возвращает то, что хозяин
-- рассылает по каналу вместе с состоянием.
create or replace function public.room_set_state(p_room uuid, p_state jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    r public.rooms := public.require_own_room(p_room);
    t timestamptz := clock_timestamp();
    new_seq bigint;
begin
    if p_state is null or jsonb_typeof(p_state) <> 'object' then
        raise exception 'Состояние должно быть объектом' using errcode = '22023';
    end if;
    if octet_length(p_state::text) > 40000 then
        raise exception 'Слишком большое состояние' using errcode = '54000';
    end if;
    if jsonb_typeof(p_state -> 'playing') is distinct from 'boolean'
       or jsonb_typeof(p_state -> 'pos_ms') is distinct from 'number'
       or coalesce(jsonb_typeof(p_state -> 'track_id'), '') not in ('string', 'null')
       or coalesce(jsonb_typeof(p_state -> 'queue'), '') not in ('object', 'null') then
        raise exception 'Неверное состояние плеера' using errcode = '22023';
    end if;
    if (p_state ->> 'pos_ms')::numeric < 0 or (p_state ->> 'pos_ms')::numeric > 86400000 then
        raise exception 'Неверная позиция' using errcode = '22023';
    end if;
    if jsonb_typeof(p_state -> 'track_id') = 'string'
       and (p_state ->> 'track_id' !~ '^[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_state ->> 'track_id') > 160) then
        raise exception 'Неверный трек' using errcode = '22023';
    end if;
    update public.rooms x
    set state = p_state, seq = x.seq + 1, state_at = t, owner_seen_at = t, last_activity = t
    where x.id = r.id
    returning x.seq into new_seq;
    return jsonb_build_object('seq', new_seq, 'at_ms', public.epoch_ms(t), 'epoch', r.epoch);
end;
$$;

-- Сердцебиение участника (раз в ~45 секунд): держит комнату открытой и
-- отвечает, остался ли он в комнате и не сменилась ли эпоха. Не участник и
-- закрытая комната — не ошибка, а ответ: сайт тихо выходит.
create or replace function public.room_heartbeat(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
    r public.rooms;
begin
    update public.room_members m set last_seen = now()
    from public.rooms x
    where m.room_id = p_room and m.user_id = uid and x.id = m.room_id and x.closed_at is null;
    if found then
        update public.rooms x
        set last_activity = now(), owner_seen_at = case when x.owner_id = uid then now() else x.owner_seen_at end
        where x.id = p_room;
    end if;
    perform public.rooms_sweep();
    select x.* into r
    from public.rooms x
    join public.room_members m on m.room_id = x.id and m.user_id = uid
    where x.id = p_room and x.closed_at is null;
    if not found then
        return jsonb_build_object(
            'member', false,
            'closed', coalesce((select x.closed_at is not null from public.rooms x where x.id = p_room), true),
            'server_ms', public.epoch_ms(clock_timestamp())
        );
    end if;
    return jsonb_build_object('member', true, 'closed', false, 'epoch', r.epoch, 'server_ms', public.epoch_ms(clock_timestamp()));
end;
$$;

-- ── 9. Хозяин: выгнать, пригласить ─────────────────────────────────────
create or replace function public.room_kick(p_room uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    r public.rooms := public.require_own_room(p_room);
    new_epoch integer;
begin
    if p_user = r.owner_id then
        raise exception 'Себя выгнать нельзя' using errcode = '22023';
    end if;
    delete from public.room_members m where m.room_id = r.id and m.user_id = p_user;
    if not found then
        raise exception 'Этого человека нет в комнате' using errcode = 'P0002';
    end if;
    insert into public.room_kicks (room_id, user_id) values (r.id, p_user) on conflict do nothing;
    delete from public.room_invites i where i.room_id = r.id and i.to_user = p_user;
    update public.rooms x set epoch = x.epoch + 1 where x.id = r.id returning x.epoch into new_epoch;
    return jsonb_build_object('epoch', new_epoch);
end;
$$;

-- Пригласить друга: приглашение приходит как заявка в друзья (значок на
-- аватаре, кнопка «Войти»). Только друзьям; не больше 40 в час.
create or replace function public.room_invite(p_room uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    r public.rooms := public.require_own_room(p_room);
begin
    if not public.are_friends(r.owner_id, p_user) then
        raise exception 'Приглашать можно только друзей' using errcode = '42501';
    end if;
    if exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = p_user) then
        raise exception 'Уже в комнате' using errcode = '23505';
    end if;
    if exists (select 1 from public.room_kicks k where k.room_id = r.id and k.user_id = p_user) then
        raise exception 'Этого человека выгнали из комнаты' using errcode = '42501';
    end if;
    if not public.rate_limit_hit('room-invite', r.owner_id::text, 40, interval '1 hour') then
        raise exception 'Слишком много приглашений — попробуй позже' using errcode = '54000';
    end if;
    insert into public.room_invites (room_id, to_user, from_user) values (r.id, p_user, r.owner_id)
    on conflict (room_id, to_user) do update set created_at = now();
end;
$$;

create or replace function public.room_invites_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    return coalesce((
        select jsonb_agg(
            jsonb_build_object('room_id', r.id, 'title', r.title, 'from', public.profile_card(i.from_user), 'created_at', i.created_at)
            order by i.created_at desc
        )
        from public.room_invites i
        join public.rooms r on r.id = i.room_id and r.closed_at is null
        where i.to_user = uid
          and i.created_at > now() - interval '6 hours'
          and not exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = uid)
    ), '[]'::jsonb);
end;
$$;

create or replace function public.room_invites_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    return (
        select count(*)::integer
        from public.room_invites i
        join public.rooms r on r.id = i.room_id and r.closed_at is null
        where i.to_user = uid
          and i.created_at > now() - interval '6 hours'
          and not exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = uid)
    );
end;
$$;

create or replace function public.room_invite_dismiss(p_room uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    uid uuid := public.require_active_user();
begin
    delete from public.room_invites i where i.room_id = p_room and i.to_user = uid;
end;
$$;

-- ── 10. Бан и удаление аккаунта ────────────────────────────────────────
-- Бан или мягкое удаление: комната пользователя закрывается, он выходит из
-- чужих. Полное удаление auth.users убирает его строки каскадом.
create or replace function public.rooms_on_user_blocked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    rid uuid;
begin
    if new.deleted_at is not null or (new.banned_until is not null and new.banned_until > now()) then
        for rid in select r.id from public.rooms r where r.owner_id = new.id and r.closed_at is null loop
            perform public.room_close_internal(rid, 'owner_blocked');
        end loop;
        delete from public.room_members m where m.user_id = new.id;
        delete from public.room_invites i where i.to_user = new.id or i.from_user = new.id;
    end if;
    return new;
end;
$$;

drop trigger if exists rooms_on_user_blocked on auth.users;
create trigger rooms_on_user_blocked
    after update of banned_until, deleted_at on auth.users
    for each row
    when (new.banned_until is distinct from old.banned_until or new.deleted_at is distinct from old.deleted_at)
    execute function public.rooms_on_user_blocked();

-- ── 11. Админка ────────────────────────────────────────────────────────
create or replace function public.admin_user_room(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    r public.rooms;
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    select * into r from public.rooms x where x.owner_id = p_user and x.closed_at is null;
    if not found then
        return null;
    end if;
    return jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'created_at', r.created_at,
        'last_activity', r.last_activity,
        'members', (select count(*)::integer from public.room_members m where m.room_id = r.id)
    );
end;
$$;

create or replace function public.admin_room_close(p_room uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.is_admin() then
        raise exception 'Нет доступа' using errcode = '42501';
    end if;
    if not public.room_close_internal(p_room, 'admin') then
        raise exception 'Комната не найдена или уже закрыта' using errcode = 'P0002';
    end if;
end;
$$;

-- ── 12. Права на функции ───────────────────────────────────────────────
revoke all on function public.epoch_ms(timestamptz) from public, anon, authenticated;
revoke all on function public.room_close_internal(uuid, text) from public, anon, authenticated;
revoke all on function public.rooms_sweep() from public, anon, authenticated;
revoke all on function public.require_own_room(uuid) from public, anon, authenticated;
revoke all on function public.room_json(public.rooms, uuid) from public, anon, authenticated;
revoke all on function public.rooms_on_user_blocked() from public, anon, authenticated;
-- Политики Realtime вызываются от имени authenticated.
revoke all on function public.room_topic_access(text, boolean) from public, anon;
grant execute on function public.room_topic_access(text, boolean) to authenticated;

do $$
declare
    sig text;
begin
    foreach sig in array array[
        'public.server_now()',
        'public.room_create(text)',
        'public.room_join(uuid)',
        'public.room_leave()',
        'public.room_close(uuid)',
        'public.room_get(uuid)',
        'public.room_my()',
        'public.room_info(uuid)',
        'public.room_set_state(uuid, jsonb)',
        'public.room_heartbeat(uuid)',
        'public.room_kick(uuid, uuid)',
        'public.room_invite(uuid, uuid)',
        'public.room_invites_list()',
        'public.room_invites_count()',
        'public.room_invite_dismiss(uuid)',
        'public.admin_user_room(uuid)',
        'public.admin_room_close(uuid)'
    ] loop
        execute format('revoke all on function %s from public, anon', sig);
        execute format('grant execute on function %s to authenticated', sig);
    end loop;
end
$$;
