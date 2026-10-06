// Мини-окружение «как в Supabase» на PGlite: роли, auth.jwt(), storage,
// таблица play_counts и функции счётчика — в состоянии из аудита прода.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'

export const REPO = path.resolve(__dirname, '../..')

// Правдоподобная нормализация: legacy «id--N» (1-based) → «id-(N-1)».
export const NORMALIZE_OK = `
create function public.normalize_track_key(k text) returns text language plpgsql as $n$
declare m text[];
begin
    if k is null then return null; end if;
    k := btrim(k);
    m := regexp_match(k, '^(.+)--(\\d+)$');
    if m is not null then
        if m[2]::int >= 1 then return m[1] || '-' || (m[2]::int - 1); end if;
        return null;
    end if;
    if k ~ '^[a-z0-9]+(-[a-z0-9]+)*-[0-9]+$' then return k; end if;
    return null;
end $n$;`

// Вариант, зависящий от search_path (неквалифицированная таблица).
export const NORMALIZE_BAD = `
create table public.key_aliases (alias text primary key, key text);
create function public.normalize_track_key(k text) returns text language plpgsql as $n$
begin
    return coalesce((select key from key_aliases where alias = k), k);
end $n$;`

export async function createDb(normalizeSql: string = NORMALIZE_OK): Promise<PGlite> {
    const db = new PGlite()
    await db.exec(`
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin bypassrls;
        create role supabase_auth_admin nologin;
        grant usage on schema public to anon, authenticated, service_role;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
        alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

        create schema auth;
        grant usage on schema auth to anon, authenticated;
        create function auth.jwt() returns jsonb language sql stable as $$
            select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
        $$;
        grant execute on function auth.jwt() to anon, authenticated;
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(auth.jwt() ->> 'sub', '')::uuid
        $$;
        grant execute on function auth.uid() to anon, authenticated;

        -- Упрощённые таблицы Supabase Auth: только колонки, которые читают
        -- миграции и функции.
        create table auth.users (
            id uuid primary key,
            email text unique,
            email_change text default '',
            raw_app_meta_data jsonb not null default '{}',
            raw_user_meta_data jsonb not null default '{}',
            created_at timestamptz not null default now(),
            last_sign_in_at timestamptz,
            banned_until timestamptz,
            deleted_at timestamptz,
            is_anonymous boolean not null default false
        );
        create table auth.sessions (
            id uuid primary key default gen_random_uuid(),
            user_id uuid not null references auth.users (id) on delete cascade,
            created_at timestamptz not null default now()
        );
        create table auth.identities (
            id uuid primary key default gen_random_uuid(),
            user_id uuid not null references auth.users (id) on delete cascade,
            provider text not null,
            identity_data jsonb not null default '{}'
        );
        -- pgcrypto в Supabase лежит в схеме extensions; здесь — заглушки.
        create schema extensions;
        create function extensions.gen_salt(t text) returns text language sql as $$ select '$2a$06$stubstubstubstubstubst' $$;
        create function extensions.crypt(p text, salt text) returns text language sql as $$ select 'crypt:' || md5(p) $$;
        alter table auth.users add column encrypted_password text;
        create table auth.refresh_tokens (
            id bigserial primary key,
            user_id varchar(255),
            session_id uuid references auth.sessions (id) on delete cascade,
            revoked boolean default false
        );
        insert into auth.users (id, email, raw_app_meta_data) values
            ('${OWNER.sub}', 'owner@example.com', '{"provider":"email","role":"owner"}'),
            ('${ADMIN.sub}', 'admin@example.com', '{"provider":"email","role":"admin"}'),
            ('${USER.sub}', 'user@example.com', '{"provider":"email"}'),
            ('${USER2.sub}', 'user2@example.com', '{"provider":"email","role":"user"}');

        create schema storage;
        grant usage on schema storage to anon, authenticated;
        create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
        create table storage.objects (id serial primary key, bucket_id text, name text, owner uuid, created_at timestamptz default now());
        create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
        declare parts text[];
        begin
            parts := string_to_array(name, '/');
            return parts[1:array_length(parts, 1) - 1];
        end $$;
        grant execute on function storage.foldername(text) to anon, authenticated;
        alter table storage.objects enable row level security;
        grant all on storage.objects to anon, authenticated;
        grant all on sequence storage.objects_id_seq to anon, authenticated;

        -- Состояние прода по аудиту 2026-10-01: RLS выключен, полные права у anon.
        create table public.play_counts (
            id bigint generated by default as identity primary key,
            track_key text not null,
            plays bigint default 0
        );
        create unique index play_counts_title_key on public.play_counts (track_key);
        ${normalizeSql}
        create function public.increment_play_count(track_key_input text) returns void
        language plpgsql security definer set search_path to 'public' as $f$
        declare normalized_key text;
        begin
            normalized_key := public.normalize_track_key(track_key_input);
            if normalized_key is null then
                raise exception 'Invalid track_key format: %', track_key_input using errcode = '22023';
            end if;
            insert into public.play_counts (track_key, plays) values (normalized_key, 1)
            on conflict (track_key) do update set plays = public.play_counts.plays + 1;
        end $f$;
    `)
    return db
}

export function migrationFiles() {
    const dir = path.join(REPO, 'supabase/migrations')
    return fs.readdirSync(dir).sort().map((f) => ({ name: f, sql: fs.readFileSync(path.join(dir, f), 'utf8') }))
}

// Каждая миграция — в своей транзакции, как у supabase db push.
export async function applyMigrations(db: PGlite, filter: (m: { name: string }) => boolean = () => true) {
    for (const m of migrationFiles().filter(filter)) {
        await db.exec('begin;')
        try {
            await db.exec(m.sql)
            await db.exec('commit;')
        } catch (e) {
            await db.exec('rollback;')
            throw new Error(`${m.name}: ${(e as Error).message}`)
        }
    }
}

// Выполнить SQL от имени роли с заданными claims.
export async function as(db: PGlite, role: string, claims: object, sql: string, params?: unknown[]): Promise<{ rows: any[] }> {
    await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims).replace(/'/g, "''")}', false); set role ${role};`)
    try {
        return await db.query(sql, params)
    } finally {
        await db.exec('reset role;')
    }
}

// Пользователи есть в auth.users (см. createDb): роль функции берут оттуда.
export const OWNER = { role: 'authenticated', sub: '00000000-0000-4000-8000-00000000000f', app_metadata: { role: 'owner' } }
export const ADMIN = { role: 'authenticated', sub: '00000000-0000-4000-8000-00000000000a', app_metadata: { role: 'admin' } }
export const USER = { role: 'authenticated', sub: '00000000-0000-4000-8000-000000000001', app_metadata: { provider: 'email' } }
export const USER2 = { role: 'authenticated', sub: '00000000-0000-4000-8000-000000000002', app_metadata: { role: 'user' } }
export const ANON = { role: 'anon' }

