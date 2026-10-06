-- Ники и роли текущим аккаунтам админки (docs/accounts-setup.md, шаг 4).
-- Выполняется один раз в Supabase → SQL Editor ПОСЛЕ миграций.
--
-- Подставь четыре значения в блоке VALUES ниже: старый email и новый ник
-- для себя (роль owner) и для друга (роль admin). Ник: 3–20 символов —
-- русские и латинские буквы, цифры, «_», «.», «-».
--
-- Что делает: адрес аккаунта меняется на технический (из ника), роль
-- записывается в app_metadata, создаётся профиль. Пароли не меняются.
-- Повторный запуск безопасен.

begin;
-- Роль owner выдаётся только так (защитный триггер на auth.users).
set local app.owner_override = 'on';

create temporary table setup_params on commit drop as
select * from (values
    ('ТВОЙ_EMAIL@example.com', 'ТвойНик', 'owner'),
    ('EMAIL_ДРУГА@example.com', 'НикДруга', 'admin')
) as p (old_email, nick, role);

do $$
declare
    r record;
begin
    for r in select * from setup_params loop
        if r.role not in ('owner', 'admin') then
            raise exception 'Роль % — только owner или admin', r.role;
        end if;
        if r.nick !~ '^[A-Za-zА-Яа-яЁё0-9_.-]{3,20}$' then
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
    if (select count(distinct public.account_nick_key(nick)) from setup_params) < (select count(*) from setup_params) then
        raise exception 'Ники совпадают (без учёта регистра и похожих букв) — выбери разные';
    end if;
end
$$;

update auth.users u
set email = public.account_tech_email(p.nick),
    raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p.role),
    banned_until = null
from setup_params p
where lower(u.email) = lower(p.old_email);

-- Адрес и у способа входа «email» — чтобы всё было согласовано.
update auth.identities i
set identity_data = coalesce(i.identity_data, '{}'::jsonb) || jsonb_build_object('email', u.email)
from auth.users u
join setup_params p on u.email = public.account_tech_email(p.nick)
where i.user_id = u.id and i.provider = 'email';

insert into public.profiles (id, nick, nick_key)
select u.id, btrim(p.nick), public.account_nick_key(p.nick)
from auth.users u
join setup_params p on u.email = public.account_tech_email(p.nick)
on conflict (id) do update set nick = excluded.nick, nick_key = excluded.nick_key;

insert into public.account_private (id)
select u.id
from auth.users u
join setup_params p on u.email = public.account_tech_email(p.nick)
on conflict (id) do nothing;

commit;

-- Проверка: должны быть две строки — твой ник с ролью owner и ник друга с ролью admin.
select p.nick as "ник", u.raw_app_meta_data ->> 'role' as "роль", u.email as "технический адрес"
from auth.users u
join public.profiles p on p.id = u.id
where u.raw_app_meta_data ->> 'role' in ('owner', 'admin')
order by 2 desc, 1;
