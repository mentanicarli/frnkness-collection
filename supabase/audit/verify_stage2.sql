-- Проверка счётчика после миграций этапа 2. Данные НЕ меняются:
-- блок вызывает increment_play_count от имени anon (как сайт), читает
-- результат и намеренно завершается ошибкой — всё откатывается.
-- В ответе будет строка «ТЕСТ ...» с числами (это и есть результат).
do $$
declare
    owner_info text;
    before_plays bigint;
    after_plays bigint;
    events_before bigint;
    events_after bigint;
begin
    select string_agg(x, '; ') into owner_info from (
        select 'функция: ' || pg_get_userbyid(p.proowner) || ' bypassrls=' || r.rolbypassrls as x
        from pg_proc p join pg_roles r on r.oid = p.proowner
        where p.oid = 'public.increment_play_count(text)'::regprocedure
        union all
        select 'play_counts: ' || pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
        from pg_class c where c.oid = 'public.play_counts'::regclass
    ) t;

    select coalesce(plays, 0) into before_plays from public.play_counts where track_key = 'faaa-0';
    select count(*) into events_before from public.play_events;

    set local role anon;
    perform public.increment_play_count('faaa-0');
    reset role;

    select coalesce(plays, 0) into after_plays from public.play_counts where track_key = 'faaa-0';
    select count(*) into events_after from public.play_events;

    raise exception 'ТЕСТ (откатывается): plays % → %, событий % → %. %',
        before_plays, after_plays, events_before, events_after, owner_info;
end
$$;
