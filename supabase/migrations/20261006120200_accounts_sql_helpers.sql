-- Этап «Аккаунты»: ключ ника и технический адрес аккаунта в SQL — для
-- ручных операций в SQL Editor (выдать ник текущим админам, аварийный
-- выход, см. docs/accounts-setup.md). Те же правила, что nickKey() и
-- techEmail() в supabase/functions/_shared/accounts.ts; совпадение
-- проверяет supabase/tests/accounts.test.ts.
-- Сайту и пользователям не нужны: права только у postgres и service role.

create or replace function public.account_nick_key(p_nick text)
returns text
language sql
immutable
set search_path = ''
as $$
    -- Нижний регистр; латиница, похожая на кириллицу, и 0 → кириллица;
    -- ё → е; «.» и «-» → «_».
    select translate(lower(btrim(normalize(p_nick, NFC))), 'abcehkmoptxy0ё.-', 'авсенкмортхуое__')
$$;

create or replace function public.account_tech_email(p_nick text)
returns text
language sql
immutable
set search_path = ''
as $$
    select 'u-' || left(encode(sha256(convert_to('frnkness-nick-v1:' || public.account_nick_key(p_nick), 'UTF8')), 'hex'), 32) || '@id.frnkness.ru'
$$;

revoke all on function public.account_nick_key(text) from public, anon, authenticated;
revoke all on function public.account_tech_email(text) from public, anon, authenticated;
grant execute on function public.account_nick_key(text) to service_role;
grant execute on function public.account_tech_email(text) to service_role;
