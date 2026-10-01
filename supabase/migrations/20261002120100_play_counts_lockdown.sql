-- Закрываем прямую запись в play_counts.
--
-- Аудит показал: RLS выключен, у anon и authenticated есть INSERT/UPDATE/
-- DELETE/TRUNCATE. Публичный ключ лежит в коде сайта, так что любой мог
-- обнулить или накрутить статистику напрямую.
--
-- После миграции:
--   - читать play_counts могут все (чарт и счётчики на сайте работают как раньше);
--   - менять — только increment_play_count (security definer, владелец таблицы);
--   - сайт ничего, кроме чтения и этого RPC, с таблицей не делает.
alter table public.play_counts enable row level security;

drop policy if exists "play_counts: public read" on public.play_counts;
create policy "play_counts: public read" on public.play_counts
    for select to anon, authenticated
    using (true);

revoke insert, update, delete, truncate, references, trigger on table public.play_counts from public, anon, authenticated;
grant select on table public.play_counts to anon, authenticated;
