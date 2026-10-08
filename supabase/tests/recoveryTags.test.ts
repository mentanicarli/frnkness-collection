// @vitest-environment node
/**
 * Права и инварианты этапа «Код восстановления и теги» на настоящем Postgres
 * (PGlite): код хранится только хешем и закрыт от сайта, сгорает одним
 * запросом, новый заменяет старый; теги пишет только владелец, цвет только
 * #RRGGBB, у человека не больше одного тега, удаление снимает тег со всех.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import { ADMIN, ANON, OWNER, REPO, USER, USER2, applyMigrations, as, createDb } from './pgHarness'

const HASH = (c: string) => c.repeat(64).slice(0, 64)
const TECH = (n: number) => `u-${String(n).padStart(32, '0')}@id.frnkness.ru`

describe('код восстановления и теги: права и инварианты', () => {
    let db: PGlite
    const rpc = async (claims: object, sql: string, params?: unknown[]) => (await as(db, 'authenticated', claims, `select ${sql} as r`, params)).rows[0].r
    const service = async (sql: string, params?: unknown[]) => (await as(db, 'service_role', { role: 'service_role' }, `select ${sql} as r`, params)).rows[0].r
    const n = async (sql: string) => Number((await db.query<any>(sql)).rows[0].n)
    const clean = () => db.exec('delete from public.recovery_codes; delete from public.user_tag_assignments; delete from public.user_tags; delete from public.rate_limits; update auth.users set banned_until = null, deleted_at = null;')

    beforeAll(async () => {
        db = await createDb()
        await applyMigrations(db)
        await applyMigrations(db) // повторный прогон не падает
        await db.exec(`
            insert into public.profiles (id, nick, nick_key) values
                ('${OWNER.sub}', 'frnkness', 'frnkness'),
                ('${ADMIN.sub}', 'Админ', 'админ'),
                ('${USER.sub}', 'Яна', 'яна'),
                ('${USER2.sub}', 'Второй', 'второи');
        `)
    }, 120_000)

    afterEach(clean)

    describe('код восстановления', () => {
        it('таблица закрыта: ни чтения, ни записи у anon и authenticated, даже у владельца', async () => {
            await service('public.recovery_code_set($1, $2)', [USER.sub, HASH('a')])
            for (const [role, claims] of [['anon', ANON], ['authenticated', USER], ['authenticated', OWNER]] as const) {
                await expect(as(db, role, claims, 'select * from public.recovery_codes')).rejects.toThrow(/permission denied/)
                await expect(as(db, role, claims, 'delete from public.recovery_codes')).rejects.toThrow(/permission denied/)
                await expect(as(db, role, claims, `insert into public.recovery_codes (user_id, code_hash) values ('${USER2.sub}', '${HASH('b')}')`)).rejects.toThrow(/permission denied/)
            }
        })

        it('функции кода доступны только service role', async () => {
            for (const sql of ['public.recovery_code_set($1, $2)', 'public.recovery_code_consume($1, $2)']) {
                await expect(as(db, 'authenticated', USER, `select ${sql}`, [USER.sub, HASH('a')])).rejects.toThrow(/permission denied/)
                await expect(as(db, 'anon', ANON, `select ${sql}`, [USER.sub, HASH('a')])).rejects.toThrow(/permission denied/)
            }
            await expect(as(db, 'authenticated', USER, 'select public.recovery_code_confirm($1)', [USER.sub])).rejects.toThrow(/permission denied/)
        })

        it('хранится только хеш: открытый код вида XXXX-XXXX-… таблица не примет', async () => {
            await expect(service('public.recovery_code_set($1, $2)', [USER.sub, 'ABCD-EFGH-JKLM-NPQR'])).rejects.toThrow(/check/)
            await expect(service('public.recovery_code_set($1, $2)', [USER.sub, 'A'.repeat(64)])).rejects.toThrow(/check/)
            await service('public.recovery_code_set($1, $2)', [USER.sub, HASH('a')])
            expect(await n(`select count(*) as n from public.recovery_codes where code_hash ~ '^[0-9a-f]{64}$'`)).toBe(1)
        })

        it('одноразовость: подошёл один раз — сгорел; неверный хеш ничего не сжигает', async () => {
            await service('public.recovery_code_set($1, $2)', [USER.sub, HASH('a')])
            expect(await service('public.recovery_code_consume($1, $2)', [USER.sub, HASH('b')])).toBe(false)
            expect(await n('select count(*) as n from public.recovery_codes')).toBe(1)
            expect(await service('public.recovery_code_consume($1, $2)', [USER.sub, HASH('a')])).toBe(true)
            expect(await service('public.recovery_code_consume($1, $2)', [USER.sub, HASH('a')])).toBe(false)
            expect(await n('select count(*) as n from public.recovery_codes')).toBe(0)
        })

        it('чужой код не подходит: хеш одного пользователя не сжигает код другого', async () => {
            await service('public.recovery_code_set($1, $2)', [USER.sub, HASH('a')])
            await service('public.recovery_code_set($1, $2)', [USER2.sub, HASH('b')])
            expect(await service('public.recovery_code_consume($1, $2)', [USER2.sub, HASH('a')])).toBe(false)
            expect(await n('select count(*) as n from public.recovery_codes')).toBe(2)
        })

        it('новый код отменяет старый: остаётся одна строка, старый хеш больше не подходит', async () => {
            await service('public.recovery_code_set($1, $2)', [USER.sub, HASH('a')])
            await service('public.recovery_code_confirm($1)', [USER.sub])
            await service('public.recovery_code_set($1, $2)', [USER.sub, HASH('b')])
            expect(await n('select count(*) as n from public.recovery_codes')).toBe(1)
            // Новый код ещё не подтверждён.
            expect(await rpc(USER, 'public.my_recovery_code_state()')).toMatchObject({ exists: true, confirmed: false })
            expect(await service('public.recovery_code_consume($1, $2)', [USER.sub, HASH('a')])).toBe(false)
            expect(await service('public.recovery_code_consume($1, $2)', [USER.sub, HASH('b')])).toBe(true)
        })

        it('состояние: нет кода → exists=false; есть → дата и подтверждение; хеша в ответе нет; аноним и забаненный — нет', async () => {
            expect(await rpc(USER, 'public.my_recovery_code_state()')).toEqual({ exists: false, created_at: null, confirmed: false })
            await service('public.recovery_code_set($1, $2)', [USER.sub, HASH('a')])
            await service('public.recovery_code_confirm($1)', [USER.sub])
            const state = await rpc(USER, 'public.my_recovery_code_state()')
            expect(state).toMatchObject({ exists: true, confirmed: true })
            expect(Object.keys(state).sort()).toEqual(['confirmed', 'created_at', 'exists'])
            // Чужое состояние не видно: у USER2 кода нет.
            expect(await rpc(USER2, 'public.my_recovery_code_state()')).toMatchObject({ exists: false })
            await expect(as(db, 'anon', ANON, 'select public.my_recovery_code_state()')).rejects.toThrow(/permission denied/)
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER.sub}'`)
            await expect(rpc(USER, 'public.my_recovery_code_state()')).rejects.toThrow(/Нужно войти/)
        })

        it('при удалении пользователя код удаляется', async () => {
            await service('public.recovery_code_set($1, $2)', [USER2.sub, HASH('b')])
            await db.exec(`delete from public.profiles where id = '${USER2.sub}'; delete from auth.users where id = '${USER2.sub}'`)
            expect(await n('select count(*) as n from public.recovery_codes')).toBe(0)
            await db.exec(`
                insert into auth.users (id, email, raw_app_meta_data) values ('${USER2.sub}', '${TECH(2)}', '{"role":"user"}');
                insert into public.profiles (id, nick, nick_key) values ('${USER2.sub}', 'Второй', 'второи');
            `)
        })
    })

    describe('теги', () => {
        const create = (name: string, color = '#ff8800') => rpc(OWNER, 'public.owner_tag_create($1, $2)', [name, color])

        it('создаёт, переименовывает и перекрашивает, удаляет — только владелец', async () => {
            const tag = await create('Друг сайта', '#FF8800')
            expect(tag).toEqual({ id: expect.any(Number), name: 'Друг сайта', color: '#ff8800' })
            expect(await rpc(OWNER, 'public.owner_tag_update($1, $2, $3)', [tag.id, 'Легенда', '#00AAFF'])).toMatchObject({ name: 'Легенда', color: '#00aaff' })
            await rpc(OWNER, 'public.owner_tag_delete($1)', [tag.id])
            expect(await n('select count(*) as n from public.user_tags')).toBe(0)
            await expect(rpc(OWNER, 'public.owner_tag_delete($1)', [tag.id])).rejects.toThrow(/не найден/)
        })

        it('админ, обычный пользователь и аноним писать теги не могут; права по роли не меняются', async () => {
            const tag = await create('VIP')
            for (const who of [ADMIN, USER, USER2]) {
                await expect(rpc(who, 'public.owner_tag_create($1, $2)', ['Мой', '#112233'])).rejects.toThrow(/Нет доступа/)
                await expect(rpc(who, 'public.owner_tag_update($1, $2, $3)', [tag.id, 'Хак', '#112233'])).rejects.toThrow(/Нет доступа/)
                await expect(rpc(who, 'public.owner_tag_delete($1)', [tag.id])).rejects.toThrow(/Нет доступа/)
                await expect(rpc(who, 'public.owner_user_set_tag($1, $2)', [who.sub, tag.id])).rejects.toThrow(/Нет доступа/)
            }
            await expect(as(db, 'anon', ANON, `select public.owner_tag_create('x', '#112233')`)).rejects.toThrow(/permission denied/)
            expect(await n('select count(*) as n from public.user_tags')).toBe(1)
            // Тег ничего не даёт в правах: роль по-прежнему из auth.users.
            await rpc(OWNER, 'public.owner_user_set_tag($1, $2)', [USER.sub, tag.id])
            expect((await as(db, 'authenticated', USER, 'select public.is_admin() as r')).rows[0].r).toBe(false)
            await expect(rpc(USER, 'public.admin_users_list($1)', [''])).rejects.toThrow(/Нет доступа|42501|нет доступа/i)
        })

        it('цвет — только #RRGGBB; название — 1–20 символов; повтор названия без учёта регистра запрещён', async () => {
            for (const bad of ['red', '#fff', '#ggg000', '#12345678', 'ff8800', '#ff8800; background:url(x)', '', null, '#ff88 0']) {
                await expect(create('Тег', bad as string), String(bad)).rejects.toThrow(/Цвет/)
            }
            await expect(create('')).rejects.toThrow(/от 1 до 20/)
            await expect(create('   ')).rejects.toThrow(/от 1 до 20/)
            await expect(create('я'.repeat(21))).rejects.toThrow(/от 1 до 20/)
            await create('я'.repeat(20))
            await create('Тест')
            await expect(create('тест')).rejects.toThrow(/уже есть/)
            // Переименование в занятое название — тоже нельзя.
            const other = await create('Другой')
            await expect(rpc(OWNER, 'public.owner_tag_update($1, $2, $3)', [other.id, 'ТЕСТ', '#112233'])).rejects.toThrow(/уже есть/)
            // Таблица сама держит инварианты, даже мимо функций.
            await expect(db.exec(`insert into public.user_tags (name, color) values ('x', '#FF0000')`)).rejects.toThrow(/check/)
            await expect(db.exec(`insert into public.user_tags (name, color) values (' x', '#ff0000')`)).rejects.toThrow(/check/)
        })

        it('не больше 50 тегов', async () => {
            await db.exec(`insert into public.user_tags (name, color) select 't' || i, '#000000' from generate_series(1, 50) i`)
            await expect(create('Лишний')).rejects.toThrow(/Слишком много/)
        })

        it('у человека один тег или ни одного: новый заменяет, null снимает', async () => {
            const a = await create('А')
            const b = await create('Б', '#00ff00')
            await rpc(OWNER, 'public.owner_user_set_tag($1, $2)', [USER.sub, a.id])
            await rpc(OWNER, 'public.owner_user_set_tag($1, $2)', [USER.sub, b.id])
            expect(await n(`select count(*) as n from public.user_tag_assignments where user_id = '${USER.sub}'`)).toBe(1)
            expect((await db.query<any>(`select tag_id from public.user_tag_assignments where user_id = '${USER.sub}'`)).rows[0].tag_id).toBe(b.id)
            await rpc(OWNER, 'public.owner_user_set_tag($1, $2)', [USER.sub, null])
            expect(await n('select count(*) as n from public.user_tag_assignments')).toBe(0)
            await expect(rpc(OWNER, 'public.owner_user_set_tag($1, $2)', [USER.sub, 999999])).rejects.toThrow(/Тег не найден/)
            await expect(rpc(OWNER, 'public.owner_user_set_tag($1, $2)', ['00000000-0000-4000-8000-0000000000ff', a.id])).rejects.toThrow(/Пользователь не найден/)
        })

        it('удаление тега снимает его со всех; изменение названия и цвета видно у всех сразу', async () => {
            const tag = await create('Звезда', '#ffcc00')
            await rpc(OWNER, 'public.owner_user_set_tag($1, $2)', [USER.sub, tag.id])
            await rpc(OWNER, 'public.owner_user_set_tag($1, $2)', [USER2.sub, tag.id])
            await rpc(OWNER, 'public.owner_tag_update($1, $2, $3)', [tag.id, 'Суперзвезда', '#123456'])
            for (const viewer of [USER, USER2, ADMIN]) {
                const all = await rpc(viewer, 'public.tags_all()')
                expect(all.tags).toEqual([{ id: tag.id, name: 'Суперзвезда', color: '#123456' }])
                expect(all.assignments.map((a: any) => a.user_id).sort()).toEqual([USER.sub, USER2.sub].sort())
            }
            await rpc(OWNER, 'public.owner_tag_delete($1)', [tag.id])
            expect(await n('select count(*) as n from public.user_tag_assignments')).toBe(0)
            expect(await rpc(USER, 'public.tags_all()')).toEqual({ tags: [], assignments: [] })
        })

        it('читают все вошедшие, но не аноним и не забаненный; забаненные не светятся в списке', async () => {
            const tag = await create('Тег')
            await rpc(OWNER, 'public.owner_user_set_tag($1, $2)', [USER2.sub, tag.id])
            expect((await rpc(USER, 'public.tags_all()')).assignments).toHaveLength(1)
            await expect(as(db, 'anon', ANON, 'select public.tags_all()')).rejects.toThrow(/permission denied/)
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER2.sub}'`)
            expect((await rpc(USER, 'public.tags_all()')).assignments).toEqual([])
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER.sub}'`)
            await expect(rpc(USER, 'public.tags_all()')).rejects.toThrow(/Нужно войти/)
        })

        it('прямого доступа к таблицам тегов нет ни у кого', async () => {
            const tag = await create('Тег')
            for (const t of ['user_tags', 'user_tag_assignments']) {
                for (const [role, claims] of [['anon', ANON], ['authenticated', USER], ['authenticated', OWNER]] as const) {
                    await expect(as(db, role, claims, `select * from public.${t}`)).rejects.toThrow(/permission denied/)
                    await expect(as(db, role, claims, `delete from public.${t}`)).rejects.toThrow(/permission denied/)
                }
            }
            await expect(as(db, 'authenticated', OWNER, `update public.user_tags set color = '#000000' where id = ${tag.id}`)).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', OWNER, `insert into public.user_tag_assignments (user_id, tag_id) values ('${USER.sub}', ${tag.id})`)).rejects.toThrow(/permission denied/)
        })
    })

    describe('права на функции и аудит', () => {
        it('anon не может вызвать ни одну; внутренние помощники и функции кода закрыты от сайта', async () => {
            const rows = (
                await db.query<any>(`
                    select p.proname, has_function_privilege('anon', p.oid, 'execute') as a, has_function_privilege('authenticated', p.oid, 'execute') as u,
                           has_function_privilege('service_role', p.oid, 'execute') as s
                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname in ('recovery_code_set','recovery_code_consume','recovery_code_confirm','my_recovery_code_state','tags_all','owner_tag_create','owner_tag_update','owner_tag_delete','owner_user_set_tag','tags_limit','tag_clean_name','tag_clean_color','tag_json','require_owner')
                `)
            ).rows
            const by = Object.fromEntries(rows.map((r) => [r.proname, r]))
            expect(rows).toHaveLength(14)
            for (const r of rows) expect(r.a, r.proname).toBe(false)
            for (const name of ['recovery_code_set', 'recovery_code_consume', 'recovery_code_confirm', 'tags_limit', 'tag_clean_name', 'tag_clean_color', 'tag_json', 'require_owner']) expect(by[name].u, name).toBe(false)
            for (const name of ['recovery_code_set', 'recovery_code_consume', 'recovery_code_confirm']) expect(by[name].s, name).toBe(true)
            for (const name of ['my_recovery_code_state', 'tags_all', 'owner_tag_create', 'owner_tag_update', 'owner_tag_delete', 'owner_user_set_tag']) expect(by[name].u, name).toBe(true)
        })

        it('все security definer функции миграции работают с пустым search_path', async () => {
            const rows = (
                await db.query<any>(`
                    select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.prosecdef
                      and p.proname in ('recovery_code_set','recovery_code_consume','recovery_code_confirm','my_recovery_code_state','tags_all','owner_tag_create','owner_tag_update','owner_tag_delete','owner_user_set_tag','require_owner')
                `)
            ).rows
            expect(rows).toHaveLength(10)
            for (const r of rows) expect(r.proconfig, r.proname).toContain('search_path=""')
        })

        it('аудит-скрипт выполняется и ничего лишнего не находит', async () => {
            const audit = fs.readFileSync(path.join(REPO, 'supabase/audit/recovery_tags_audit.sql'), 'utf8')
            const statements = audit.split(/;\s*\n/).map((t) => t.trim()).filter((t) => /^select/im.test(t.replace(/^(--.*\n)+/gm, '')))
            const rows: { section: string; item: string; value: string }[] = []
            for (const st of statements) rows.push(...(await db.query<any>(st)).rows)
            expect(rows.filter((r) => r.section.includes('ожидается пусто'))).toEqual([])
            expect(rows.filter((r) => r.section === '1 rls').map((r) => r.value)).toEqual(['true', 'true', 'true'])
            expect(rows.filter((r) => r.section === '5 search_path').every((r) => r.value.includes('search_path=""'))).toBe(true)
            expect(rows.filter((r) => r.section.startsWith('6 ') || r.section.startsWith('7 ')).every((r) => r.value === '0')).toBe(true)
            expect(rows.filter((r) => r.section === '4 functions' && r.value.includes('anon=true'))).toEqual([])
        })
    })
})
