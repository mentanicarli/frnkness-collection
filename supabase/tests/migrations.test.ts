// @vitest-environment node
/**
 * Миграции на настоящем Postgres (PGlite, WASM): применяются поверх
 * состояния прода из аудита и проверяются от имени ролей anon,
 * authenticated и админа. Боевая база не используется.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { ADMIN, ANON, NORMALIZE_BAD, REPO, USER, applyMigrations, as, createDb } from './pgHarness'

const isStage1 = (m: { name: string }) => m.name.startsWith('20261001')

describe('аудит', () => {
    it('выполняется на состоянии прода и находит счётчик', async () => {
        const db = await createDb()
        const audit = fs.readFileSync(path.join(REPO, 'supabase/audit/play_counts_audit.sql'), 'utf8')
        const rows = (await db.query<{ section: string; item: string }>(audit)).rows
        expect(rows.some((r) => r.section === '01 function' && r.item === 'increment_play_count(text)')).toBe(true)
        expect(rows.some((r) => r.section === '04 rls')).toBe(true)
    }, 30_000)
})

describe('самопроверка normalize_track_key', () => {
    it('опасная нормализация (зависит от search_path) — миграция откатывается целиком', async () => {
        const db = await createDb(NORMALIZE_BAD)
        await applyMigrations(db, isStage1)
        await expect(applyMigrations(db, (m) => !isStage1(m))).rejects.toThrow(/зависит от search_path/)
        const fn = (await db.query<{ proconfig: string[] }>("select proconfig from pg_proc where proname = 'increment_play_count'")).rows[0]
        expect(fn.proconfig).toEqual(['search_path=public'])
        expect((await db.query<{ t: string | null }>("select to_regclass('public.admin_settings') as t")).rows[0].t).toBeNull()
    }, 30_000)
})

describe('миграции админки', () => {
    let db: PGlite

    beforeAll(async () => {
        db = await createDb()
        await applyMigrations(db, isStage1)
        // Прослушивания до миграций этапа 2.
        await as(db, 'anon', ANON, "select public.increment_play_count('faaa-0')")
        await as(db, 'anon', ANON, "select public.increment_play_count('most-venture-poopsicks--1')")
        await applyMigrations(db, (m) => !isStage1(m))
        // Повторный прогон всех миграций не падает.
        await applyMigrations(db)
    }, 60_000)

    const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n)

    describe('этап 1', () => {
        it('is_admin() — только app_metadata.role = admin', async () => {
            const isAdmin = async (claims: object) => (await as(db, 'authenticated', claims, 'select public.is_admin() as v')).rows[0].v
            expect(await isAdmin(ADMIN)).toBe(true)
            expect(await isAdmin(USER)).toBe(false)
            expect(await isAdmin({ role: 'authenticated', user_metadata: { role: 'admin' } })).toBe(false)
            expect((await as(db, 'anon', ANON, 'select public.is_admin() as v')).rows[0].v).toBe(false)
        })

        it('play_events закрыта для всех ролей, даже для админа напрямую', async () => {
            for (const [role, claims] of [['anon', ANON], ['authenticated', USER], ['authenticated', ADMIN]] as const) {
                await expect(as(db, role, claims, 'select * from public.play_events')).rejects.toThrow(/permission denied/)
                await expect(as(db, role, claims, "insert into public.play_events (track_key) values ('x-0')")).rejects.toThrow(/permission denied/)
            }
        })

        it('бакет admin-uploads: приватный, 30 МБ, только медиатипы, только админ', async () => {
            const bucket = (await db.query<any>("select * from storage.buckets where id = 'admin-uploads'")).rows[0]
            expect(bucket.public).toBe(false)
            expect(Number(bucket.file_size_limit)).toBe(31457280)
            expect(bucket.allowed_mime_types).toEqual(['audio/mpeg', 'image/jpeg', 'image/png', 'application/pdf'])
            await as(db, 'authenticated', ADMIN, "insert into storage.objects (bucket_id, name) values ('admin-uploads', 'a.mp3')")
            await expect(as(db, 'authenticated', USER, "insert into storage.objects (bucket_id, name) values ('admin-uploads', 'b.mp3')")).rejects.toThrow(/row-level security/)
            await expect(as(db, 'anon', ANON, "insert into storage.objects (bucket_id, name) values ('admin-uploads', 'c.mp3')")).rejects.toThrow(/row-level security/)
            expect((await as(db, 'authenticated', USER, "select * from storage.objects where bucket_id = 'admin-uploads'")).rows).toHaveLength(0)
            expect((await as(db, 'authenticated', ADMIN, "select * from storage.objects where bucket_id = 'admin-uploads'")).rows).toHaveLength(1)
            await as(db, 'authenticated', USER, "delete from storage.objects where bucket_id = 'admin-uploads'")
            expect(await count("select count(*) n from storage.objects where bucket_id = 'admin-uploads'")).toBe(1)
        })
    })

    describe('счётчик после этапа 2', () => {
        it('прежнее поведение плюс событие с нормализованным ключом', async () => {
            await db.exec('delete from public.play_events')
            const before = await count("select plays n from public.play_counts where track_key = 'faaa-0'")
            await as(db, 'anon', ANON, "select public.increment_play_count('faaa-0')")
            await as(db, 'authenticated', USER, "select public.increment_play_count('disinvolto--1')")
            expect(await count("select plays n from public.play_counts where track_key = 'faaa-0'")).toBe(before + 1)
            expect(await count("select plays n from public.play_counts where track_key = 'disinvolto-0'")).toBe(1)
            const events = (await db.query<{ track_key: string }>('select track_key from public.play_events order by id')).rows.map((r) => r.track_key)
            expect(events).toEqual(['faaa-0', 'disinvolto-0'])
        })

        it('неверный ключ — прежняя ошибка 22023, событие не пишется', async () => {
            const n = await count('select count(*) n from public.play_events')
            await expect(as(db, 'anon', ANON, "select public.increment_play_count('мусор')")).rejects.toThrow(/Invalid track_key format/)
            expect(await count('select count(*) n from public.play_events')).toBe(n)
        })

        it('security definer и пустой search_path', async () => {
            const fn = (await db.query<{ proconfig: string[]; prosecdef: boolean }>("select proconfig, prosecdef from pg_proc where proname = 'increment_play_count'")).rows[0]
            expect(fn.prosecdef).toBe(true)
            expect(fn.proconfig).toEqual(['search_path=""'])
        })
    })

    describe('play_counts закрыта на запись', () => {
        it('чтение для сайта работает (чарт и счётчик релиза)', async () => {
            expect((await as(db, 'anon', ANON, 'select track_key, plays from public.play_counts order by plays desc limit 50')).rows.length).toBeGreaterThan(0)
            expect((await as(db, 'anon', ANON, "select track_key, plays from public.play_counts where track_key like 'faaa-%'")).rows).toHaveLength(1)
        })

        it.each([
            ['delete from public.play_counts'],
            ['update public.play_counts set plays = 999999'],
            ["insert into public.play_counts (track_key, plays) values ('x-0', 100)"],
            ['truncate public.play_counts']
        ])('anon и authenticated: %s — запрещено', async (sql) => {
            await expect(as(db, 'anon', ANON, sql)).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, sql)).rejects.toThrow(/permission denied/)
        })
    })

    describe('RPC дашборда', () => {
        const RPCS = [
            'select public.admin_stats_overview()',
            "select * from public.admin_stats_daily('2026-10-01', '2026-10-02')",
            "select * from public.admin_stats_daily_by_key('2026-10-01', '2026-10-02')",
            "select * from public.admin_stats_by_key('2026-10-01', '2026-10-02')",
            'select * from public.admin_stats_all_time()'
        ]

        it.each(RPCS)('anon не может вызвать: %s', async (sql) => {
            await expect(as(db, 'anon', ANON, sql)).rejects.toThrow(/permission denied/)
        })

        it.each(RPCS)('не-админ получает «Нет доступа»: %s', async (sql) => {
            await expect(as(db, 'authenticated', USER, sql)).rejects.toThrow(/Нет доступа/)
        })

        it('admin_settings закрыта', async () => {
            await expect(as(db, 'authenticated', ADMIN, 'select * from public.admin_settings')).rejects.toThrow(/permission denied/)
        })

        it('сутки по Москве и нули в пустых днях', async () => {
            await db.exec(`
                delete from public.play_events;
                insert into public.play_events (track_key, created_at) values
                    ('faaa-0', '2026-09-30 20:59:59+00'),
                    ('faaa-0', '2026-09-30 21:00:00+00'),
                    ('boxik-0', '2026-10-01 12:00:00+00'),
                    ('faaa-0', '2026-10-02 20:59:00+00'),
                    ('faaa-0', '2026-10-02 21:00:00+00');
            `)
            const daily = (await as(db, 'authenticated', ADMIN, "select * from public.admin_stats_daily('2026-09-30', '2026-10-03')")).rows
            expect(daily.map((r) => [new Date(r.day).toISOString().slice(0, 10), Number(r.plays)])).toEqual([
                ['2026-09-30', 1],
                ['2026-10-01', 2],
                ['2026-10-02', 1],
                ['2026-10-03', 1]
            ])
            const byKey = (await as(db, 'authenticated', ADMIN, "select * from public.admin_stats_by_key('2026-10-01', '2026-10-02')")).rows
            expect(byKey.map((r) => [r.track_key, Number(r.plays)])).toEqual([['faaa-0', 2], ['boxik-0', 1]])
            const dbk = (await as(db, 'authenticated', ADMIN, "select * from public.admin_stats_daily_by_key('2026-10-01', '2026-10-01')")).rows
            expect(dbk.map((r) => [r.track_key, Number(r.plays)])).toEqual([['boxik-0', 1], ['faaa-0', 1]])
        })

        it('итоги за всё время — из play_counts', async () => {
            const all = (await as(db, 'authenticated', ADMIN, 'select * from public.admin_stats_all_time()')).rows
            const total = await count('select sum(plays) n from public.play_counts')
            expect(all.reduce((s, r) => s + Number(r.plays), 0)).toBe(total)
            expect(Number(all[0].plays)).toBeGreaterThanOrEqual(Number(all[all.length - 1].plays))
        })

        it('проверка периода', async () => {
            await expect(as(db, 'authenticated', ADMIN, "select * from public.admin_stats_daily('2026-10-02', '2026-10-01')")).rejects.toThrow(/Неверный период/)
            await expect(as(db, 'authenticated', ADMIN, "select * from public.admin_stats_by_key('2020-01-01', '2026-10-01')")).rejects.toThrow(/двух лет/)
        })

        it('обзор: сегодня / 7 / 30 дней и дата запуска журнала', async () => {
            await db.exec(`
                delete from public.play_events;
                insert into public.play_events (track_key, created_at) values
                    ('faaa-0', now()), ('faaa-0', now() - interval '3 days'),
                    ('faaa-0', now() - interval '10 days'), ('faaa-0', now() - interval '40 days');
            `)
            const o = (await as(db, 'authenticated', ADMIN, 'select public.admin_stats_overview() as o')).rows[0].o
            expect([o.today, o.last7, o.last30]).toEqual([1, 2, 3])
            expect(Number(o.total)).toBe(await count('select sum(plays) n from public.play_counts'))
            expect(o.tracking_since).toBeTruthy()
            expect(o.today_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        })
    })
})
