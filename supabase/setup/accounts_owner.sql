-- Ники и роли текущим аккаунтам админки (docs/accounts-setup.md, шаг 5).
-- Выполняется в Supabase → SQL Editor ПОСЛЕ миграций.
--
-- Подставь четыре значения в списке ниже (между строками ПАРАМЕТРЫ):
-- старый email и новый ник для себя (роль owner) и для друга (роль admin).
-- Ник: 3–20 символов — русские и латинские буквы, цифры, «_», «.», «-».
--
-- Что делает: адрес аккаунта меняется на технический (из ника), роль
-- записывается в app_metadata, создаётся профиль. Пароли не меняются.
-- Всё — одним блоком: либо применяется целиком, либо (при ошибке) ничего.
-- Повторный запуск безопасен: старый email уже заменён, аккаунт находится
-- по нику.

do $$
declare
    -- ПАРАМЕТРЫ: начало
    params constant jsonb := '[
        {"old_email": "ТВОЙ_EMAIL@example.com",  "nick": "ТвойНик",  "role": "owner"},
        {"old_email": "EMAIL_ДРУГА@example.com", "nick": "НикДруга", "role": "admin"}
    ]';
    -- ПАРАМЕТРЫ: конец
    r record;
    uid uuid;
    tech text;
begin
    -- Роль owner выдаётся только так (защитный триггер на auth.users);
    -- действует до конца этого запуска.
    perform set_config('app.owner_override', 'on', true);

    -- ── Проверки: до любых изменений ──
    for r in select * from jsonb_to_recordset(params) as p (old_email text, nick text, role text) loop
        if r.role is null or r.role not in ('owner', 'admin') then
            raise exception 'Роль % — только owner или admin', r.role;
        end if;
        if coalesce(r.nick, '') !~ '^[A-Za-zА-Яа-яЁё0-9_.-]{3,20}$' then
            raise exception 'Ник «%» не подходит: 3–20 символов, русские и латинские буквы, цифры, «_», «.», «-»', r.nick;
        end if;
        if not exists (
            select 1 from auth.users u
            where lower(u.email) = lower(r.old_email) or u.email = public.account_tech_email(r.nick)
        ) then
            raise exception 'Не найден аккаунт с email %', r.old_email;
        end if;
        if exists (
            select 1 from public.profiles p
            join auth.users u on u.id = p.id
            where p.nick_key = public.account_nick_key(r.nick)
              and lower(u.email) <> lower(r.old_email)
              and u.email <> public.account_tech_email(r.nick)
        ) then
            raise exception 'Ник «%» уже занят другим аккаунтом', r.nick;
        end if;
    end loop;
    if (select count(distinct public.account_nick_key(p ->> 'nick')) from jsonb_array_elements(params) p) < jsonb_array_length(params) then
        raise exception 'Ники совпадают (без учёта регистра и похожих букв) — выбери разные';
    end if;

    -- ── Изменения ──
    for r in select * from jsonb_to_recordset(params) as p (old_email text, nick text, role text) loop
        tech := public.account_tech_email(r.nick);
        select u.id into uid
        from auth.users u
        where lower(u.email) = lower(r.old_email) or u.email = tech
        order by (u.email = tech) desc
        limit 1;

        update auth.users u
        set email = tech,
            raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', r.role),
            banned_until = null
        where u.id = uid;

        -- Адрес и у способа входа «email» — чтобы всё было согласовано.
        update auth.identities i
        set identity_data = coalesce(i.identity_data, '{}'::jsonb) || jsonb_build_object('email', tech)
        where i.user_id = uid and i.provider = 'email';

        insert into public.profiles (id, nick, nick_key)
        values (uid, btrim(r.nick), public.account_nick_key(r.nick))
        on conflict (id) do update set nick = excluded.nick, nick_key = excluded.nick_key;

        insert into public.account_private (id) values (uid)
        on conflict (id) do nothing;
    end loop;
end
$$;

-- Проверка: должны быть две строки — твой ник с ролью owner и ник друга с ролью admin.
select p.nick as "ник", u.raw_app_meta_data ->> 'role' as "роль", u.email as "технический адрес"
from auth.users u
join public.profiles p on p.id = u.id
where u.raw_app_meta_data ->> 'role' in ('owner', 'admin')
order by 2 desc, 1;
