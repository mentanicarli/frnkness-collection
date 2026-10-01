-- Откат миграций этапа 2 к состоянию из аудита 2026-10-01.
-- Выполнять ТОЛЬКО если решено откатиться. Данные play_counts не трогаются.

begin;

-- 1. increment_play_count — ровно как было (из аудита).
create or replace function public.increment_play_count(track_key_input text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    normalized_key text;
begin
    normalized_key := public.normalize_track_key(track_key_input);

    if normalized_key is null then
        raise exception 'Invalid track_key format: %', track_key_input
            using errcode = '22023';
    end if;

    insert into public.play_counts (track_key, plays)
    values (normalized_key, 1)
    on conflict (track_key)
    do update set plays = public.play_counts.plays + 1;
end;
$function$;

-- 2. play_counts — снять RLS и вернуть права (это прежнее НЕБЕЗОПАСНОЕ состояние:
--    любой с публичным ключом снова сможет менять статистику).
drop policy if exists "play_counts: public read" on public.play_counts;
alter table public.play_counts disable row level security;
grant all on table public.play_counts to anon, authenticated;

-- 3. Функции дашборда и настройки.
drop function if exists public.admin_stats_overview();
drop function if exists public.admin_stats_daily(date, date);
drop function if exists public.admin_stats_daily_by_key(date, date);
drop function if exists public.admin_stats_by_key(date, date);
drop function if exists public.admin_stats_all_time();
drop function if exists public.admin_check_period(date, date);
drop table if exists public.admin_settings;

-- 4. Чтобы `supabase db push` снова видел эти миграции как неприменённые.
delete from supabase_migrations.schema_migrations where version in ('20261002120000', '20261002120100');

commit;
