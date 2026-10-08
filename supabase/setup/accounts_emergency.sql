-- Аварийный выход (docs/operations.md, раздел «Аварийные действия»).
-- Supabase → SQL Editor. Выполняй ОДИН нужный блок: выдели его мышкой и
-- нажми Run (выполнится только выделенное).

-- ── 0. Кто есть кто: ники, роли, баны ──────────────────────────────────
select p.nick as "ник", u.raw_app_meta_data ->> 'role' as "роль", u.banned_until as "бан до",
       u.last_sign_in_at as "последний вход", u.email as "технический адрес", u.id
from auth.users u
left join public.profiles p on p.id = u.id
order by (u.raw_app_meta_data ->> 'role') nulls last, p.nick;

-- ── 1. Вернуть себе роль владельца (и снять бан) ───────────────────────
-- Подставь свой ник.
begin;
set local app.owner_override = 'on';
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "owner"}'::jsonb,
    banned_until = null,
    deleted_at = null
where email = public.account_tech_email('ТвойНик');
commit;

-- ── 2. Задать новый пароль (и завершить все сеансы) ────────────────────
-- Подставь ник и новый пароль (минимум 8 символов). Пароль сохраняется
-- только хешем; сам запрос в истории SQL Editor лучше потом удалить.
begin;
set local app.owner_override = 'on';
update auth.users
set encrypted_password = extensions.crypt('НовыйПароль123', extensions.gen_salt('bf')),
    banned_until = null
where email = public.account_tech_email('ТвойНик');
delete from auth.sessions where user_id = (select id from auth.users where email = public.account_tech_email('ТвойНик'));
commit;

-- ── 3. Не помню, с каким ником входить ─────────────────────────────────
-- Если в выдаче блока 0 у аккаунта есть ник — входи с ним. Если ника нет
-- (профиль не создан), зарегистрируй новый ник на сайте и выдай ему роль
-- владельца блоком 1.
