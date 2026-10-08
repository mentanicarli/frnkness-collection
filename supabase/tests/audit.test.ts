// @vitest-environment node
/**
 * supabase/audit/check_all.sql («проверить всё») на настоящем Postgres (PGlite):
 * после всех миграций проблем нет, а любая намеренная поломка прав, ролей,
 * политик или бакетов превращается в строку ПРОБЛЕМА. Так скрипт не просто
 * «выполняется», а действительно ловит то, ради чего написан.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import { OWNER, REPO, applyMigrations, createDb } from './pgHarness'

const AUDIT = fs.readFileSync(path.join(REPO, 'supabase/audit/check_all.sql'), 'utf8')

interface Row {
    '№': number
    проверка: string
    статус: 'OK' | 'ПРОБЛЕМА'
    детали: string
}

describe('supabase/audit/check_all.sql', () => {
    let db: PGlite
    const run = async () => (await db.query<Row>(AUDIT)).rows
    const problems = async () => (await run()).filter((r) => r.статус !== 'OK')
    /** Ломает базу, проверяет, что скрипт заметил, и возвращает всё как было. */
    async function breaks(breakSql: string, restoreSql: string, expectedCheck: number, detail: RegExp) {
        await db.exec(breakSql)
        try {
            const found = await problems()
            expect(found.map((r) => r['№']), breakSql).toContain(expectedCheck)
            expect(found.find((r) => r['№'] === expectedCheck)!.детали).toMatch(detail)
        } finally {
            await db.exec(restoreSql)
        }
        expect(await problems()).toEqual([])
    }

    beforeAll(async () => {
        db = await createDb()
        await applyMigrations(db)
    }, 120_000)

    it('после всех миграций все проверки OK; номера по порядку, названия не повторяются', async () => {
        const rows = await run()
        expect(await problems()).toEqual([])
        expect(rows.map((r) => r['№'])).toEqual(Array.from({ length: rows.length }, (_, i) => i + 1))
        expect(new Set(rows.map((r) => r.проверка)).size).toBe(rows.length)
        expect(rows.length).toBeGreaterThanOrEqual(18)
        expect(rows.every((r) => r.детали === '')).toBe(true)
    })

    it('это один запрос с одной таблицей результата (SQL Editor показывает только последний)', () => {
        // Без комментариев и строковых литералов (в них бывает «; »).
        const code = AUDIT.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/'[^']*'/g, "''")
        expect(code.match(/;/g)).toHaveLength(1)
        expect(code.trim().endsWith(';')).toBe(true)
        expect(AUDIT).not.toMatch(/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b\s+(into|table|function|from|policy|on|\w+\.)/i)
    })

    it('1: таблица без RLS', async () => {
        await breaks('alter table public.user_tags disable row level security', 'alter table public.user_tags enable row level security', 1, /user_tags/)
    })

    it('3: прямое право anon на таблицу или колонку', async () => {
        await breaks('grant select on public.rate_limits to anon', 'revoke select on public.rate_limits from anon', 3, /rate_limits \(SELECT\)/)
        await breaks('grant select (nick) on public.profiles to anon', 'revoke select (nick) on public.profiles from anon', 3, /profiles/)
    })

    it('4: право для PUBLIC на таблицу', async () => {
        await breaks('grant select on public.feedback_reports to public', 'revoke select on public.feedback_reports from public', 4, /feedback_reports/)
    })

    it('5: authenticated получил запись или чтение закрытой таблицы', async () => {
        await breaks('grant select on public.client_errors to authenticated', 'revoke select on public.client_errors from authenticated', 5, /client_errors \(SELECT\)/)
        await breaks('grant insert on public.favorites to authenticated', 'revoke insert on public.favorites from authenticated', 5, /favorites \(INSERT\)/)
    })

    it('6: колонка профиля, которой не должно быть в доступе (ключ ника), и лишнее право на запись', async () => {
        await breaks('grant select (nick_key) on public.profiles to authenticated', 'revoke select (nick_key) on public.profiles from authenticated', 6, /profiles\.nick_key/)
        await breaks('grant update (nick) on public.profiles to authenticated', 'revoke update (nick) on public.profiles from authenticated', 6, /profiles\.nick \(UPDATE\)/)
    })

    it('7: права на счётчик таблицы', async () => {
        await breaks('grant usage on sequence public.client_errors_id_seq to authenticated', 'revoke usage on sequence public.client_errors_id_seq from authenticated', 7, /client_errors_id_seq → authenticated/)
    })

    it('2: политика на таблице, которую сайт напрямую не читает', async () => {
        await breaks(
            `create policy leak on public.recovery_codes for select to authenticated using (true)`,
            'drop policy leak on public.recovery_codes',
            2,
            /recovery_codes/
        )
    })

    it('8: функция, открытая анониму', async () => {
        await breaks('grant execute on function public.tags_all() to anon', 'revoke execute on function public.tags_all() from anon', 8, /tags_all/)
    })

    it('9–10: функция открыта всем (PUBLIC) и внутренний помощник открыт сайту', async () => {
        await breaks('grant execute on function public.tags_all() to public', 'revoke execute on function public.tags_all() from public; revoke execute on function public.tags_all() from anon', 9, /tags_all/)
        await breaks(
            'grant execute on function public.rate_limit_hit(text, text, integer, interval) to authenticated',
            'revoke execute on function public.rate_limit_hit(text, text, integer, interval) from authenticated',
            10,
            /rate_limit_hit/
        )
    })

    it('11–12: новая security definer функция без search_path и admin_* без проверки роли', async () => {
        const create = `
            create function public.admin_probe() returns integer language sql security definer as $$ select 1 $$;
            revoke all on function public.admin_probe() from public, anon;
            grant execute on function public.admin_probe() to authenticated;`
        const drop = 'drop function public.admin_probe()'
        await db.exec(create)
        try {
            const found = await problems()
            expect(found.map((r) => r['№'])).toEqual(expect.arrayContaining([11, 12]))
            expect(found.find((r) => r['№'] === 11)!.детали).toContain('admin_probe')
            expect(found.find((r) => r['№'] === 12)!.детали).toContain('admin_probe')
        } finally {
            await db.exec(drop)
        }
        // С проверкой роли и search_path — всё в порядке.
        await db.exec(`
            create function public.admin_probe() returns integer language plpgsql security definer set search_path = ''
            as $$ begin if not public.is_admin() then raise exception 'Нет доступа'; end if; return 1; end $$;
            revoke all on function public.admin_probe() from public, anon;
            grant execute on function public.admin_probe() to authenticated;`)
        try {
            expect(await problems()).toEqual([])
        } finally {
            await db.exec(drop)
        }
    })

    it('13: пропала или добавилась политика Realtime', async () => {
        await db.exec(`create policy extra on realtime.messages for select to authenticated using (true)`)
        try {
            expect((await problems()).find((r) => r['№'] === 13)!.детали).toContain('лишние: extra')
        } finally {
            await db.exec('drop policy extra on realtime.messages')
        }
        const [{ cmd, roles, qual, with_check }] = (await db.query<any>(`select cmd, roles, qual, with_check from pg_policies where policyname = 'rooms: members listen'`)).rows
        expect(cmd).toBe('SELECT')
        expect(roles).toBeTruthy()
        expect(qual ?? with_check).toBeTruthy()
    })

    it('14: бакет стал публичным или появился лишний', async () => {
        await breaks(`update storage.buckets set public = true where id = 'admin-uploads'`, `update storage.buckets set public = false where id = 'admin-uploads'`, 14, /admin-uploads/)
        await breaks(`insert into storage.buckets (id, name, public) values ('stray', 'stray', false)`, `delete from storage.buckets where id = 'stray'`, 14, /лишние: stray/)
    })

    it('15–16: нет защитного триггера; владельцев не один', async () => {
        await db.exec('alter table auth.users disable trigger guard_auth_users')
        try {
            expect((await problems()).map((r) => r['№'])).toContain(15)
        } finally {
            await db.exec('alter table auth.users enable trigger guard_auth_users')
        }
        // Роль владельца меняется только в обход защиты, как в SQL Editor.
        const asOwnerOverride = (sql: string) => `begin; set local app.owner_override = 'on'; ${sql}; commit;`
        await breaks(
            asOwnerOverride(`update auth.users set raw_app_meta_data = '{"role":"owner"}' where email = 'admin@example.com'`),
            asOwnerOverride(`update auth.users set raw_app_meta_data = '{"role":"admin"}' where email = 'admin@example.com'`),
            16,
            /владельцев: 2/
        )
        await breaks(
            asOwnerOverride(`update auth.users set raw_app_meta_data = '{}' where id = '${OWNER.sub}'`),
            asOwnerOverride(`update auth.users set raw_app_meta_data = '{"role":"owner"}' where id = '${OWNER.sub}'`),
            16,
            /владельцев: 0/
        )
    })

    it('17–18: в таблице кодов не хеш; неверный цвет тега (в обход ограничений таблицы)', async () => {
        await db.exec(`insert into public.recovery_codes (user_id, code_hash) values ('${OWNER.sub}', '${'a'.repeat(64)}')`)
        try {
            expect((await problems())).toEqual([])
        } finally {
            await db.exec('delete from public.recovery_codes')
        }
        await db.exec('alter table public.recovery_codes drop constraint recovery_codes_code_hash_check')
        await db.exec(`insert into public.recovery_codes (user_id, code_hash) values ('${OWNER.sub}', 'ABCD-EFGH-JKLM-NPQR')`)
        try {
            expect((await problems()).find((r) => r['№'] === 17)!.детали).toBe('не хешей: 1')
        } finally {
            await db.exec(`delete from public.recovery_codes; alter table public.recovery_codes add constraint recovery_codes_code_hash_check check (code_hash ~ '^[0-9a-f]{64}$')`)
        }
        await db.exec('alter table public.user_tags drop constraint user_tags_color_check')
        await db.exec(`insert into public.user_tags (name, color) values ('x', 'red')`)
        try {
            expect((await problems()).find((r) => r['№'] === 18)!.детали).toBe('неверных тегов: 1')
        } finally {
            await db.exec(`delete from public.user_tags; alter table public.user_tags add constraint user_tags_color_check check (color ~ '^#[0-9a-f]{6}$')`)
        }
        expect(await problems()).toEqual([])
    })
})
