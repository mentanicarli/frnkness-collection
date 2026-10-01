-- Админка, этап 1: роль админа, журнал прослушиваний, staging-бакет.
-- Таблицу play_counts и функцию increment_play_count эта миграция НЕ трогает:
-- запись событий в play_events добавится отдельной миграцией после аудита.

-- ── is_admin() ─────────────────────────────────────────────────────────
-- Роль берётся из app_metadata в JWT. app_metadata меняет только сервер
-- (SQL или service role), пользователь сам её выставить не может.
-- После выдачи роли нужно перелогиниться, чтобы она попала в токен.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
    select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ── play_events ────────────────────────────────────────────────────────
-- Журнал отдельных прослушиваний для графиков по дням. Пишет в него только
-- increment_play_count (security definer), читают — только admin-RPC.
create table if not exists public.play_events (
    id bigint generated always as identity primary key,
    track_key text not null check (char_length(track_key) between 1 and 200),
    created_at timestamptz not null default now()
);

create index if not exists play_events_created_at_idx on public.play_events (created_at);

alter table public.play_events enable row level security;
-- Политик нет намеренно: прямого доступа у anon/authenticated нет вовсе.
revoke all on table public.play_events from public, anon, authenticated;
revoke all on sequence public.play_events_id_seq from public, anon, authenticated;

-- ── Staging-бакет для загрузки медиа ───────────────────────────────────
-- Браузер кладёт сюда mp3/обложку/PDF, функция admin-content перекладывает
-- файл в GitHub и сразу удаляет. Файлы старше суток функция чистит сама.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'admin-uploads',
    'admin-uploads',
    false,
    31457280, -- 30 МБ
    array['audio/mpeg', 'image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admin-uploads: admin insert" on storage.objects;
create policy "admin-uploads: admin insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'admin-uploads' and public.is_admin());

drop policy if exists "admin-uploads: admin select" on storage.objects;
create policy "admin-uploads: admin select" on storage.objects
    for select to authenticated
    using (bucket_id = 'admin-uploads' and public.is_admin());

drop policy if exists "admin-uploads: admin delete" on storage.objects;
create policy "admin-uploads: admin delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'admin-uploads' and public.is_admin());
