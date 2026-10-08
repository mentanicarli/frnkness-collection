// @vitest-environment node
/**
 * Права и лимиты этапа «Список пользователей, журнал ошибок, обращения»
 * на настоящем Postgres (PGlite).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { ADMIN, ANON, OWNER, USER, USER2, applyMigrations, as, createDb } from './pgHarness'

const STRANGER = { role: 'authenticated', sub: '00000000-0000-4000-8000-000000000003', app_metadata: { role: 'user' } }
const TECH = (n: number) => `u-${String(n).padStart(32, '0')}@id.frnkness.ru`

describe('список пользователей, журнал ошибок, обращения', () => {
    let db: PGlite
    const rpc = async (claims: object, sql: string, params?: unknown[]) => (await as(db, 'authenticated', claims, `select ${sql} as r`, params)).rows[0].r
    const anon = async (sql: string, params?: unknown[]) => (await as(db, 'anon', ANON, `select ${sql} as r`, params)).rows[0].r
    const n = async (sql: string) => Number((await db.query<any>(sql)).rows[0].n)
    const logErr = (claims: object | null, msg: string, extra: Partial<Record<'stack' | 'page' | 'browser' | 'build' | 'client', string>> = {}) => {
        const args = [msg, extra.stack ?? '', extra.page ?? '', extra.browser ?? 'Chrome 126', extra.build ?? 'abc1234', extra.client ?? null]
        const sql = 'public.log_client_error($1,$2,$3,$4,$5,$6)'
        return claims ? rpc(claims, sql, args) : anon(sql, args)
    }
    const clean = () =>
        db.exec(`
            delete from public.client_errors; delete from public.feedback_reports;
            delete from public.friendships; delete from public.rate_limits;
            update auth.users set banned_until = null, deleted_at = null;
        `)

    beforeAll(async () => {
        db = await createDb()
        await applyMigrations(db)
        await applyMigrations(db) // повторный прогон не падает
        await db.exec(`
            insert into auth.users (id, email, raw_app_meta_data) values ('${STRANGER.sub}', '${TECH(999)}', '{"role":"user"}');
            insert into public.profiles (id, nick, nick_key) values
                ('${OWNER.sub}', 'frnkness', 'frnkness'),
                ('${ADMIN.sub}', 'Админ', 'админ'),
                ('${USER.sub}', 'Яна', 'яна'),
                ('${USER2.sub}', 'Второй', 'второи'),
                ('${STRANGER.sub}', 'Чужой', 'чужои');
        `)
    }, 120_000)

    afterEach(clean)

    describe('list_discoverable_users', () => {
        const list = (claims: object, q = '', after: string | null = null, limit = 30) =>
            rpc(claims, 'public.list_discoverable_users($1,$2,$3)', [q, after, limit]) as Promise<{ users: any[]; has_more: boolean; next: string | null }>

        it('видны активные пользователи без меня; отдаём id, ник, аватар и отношение', async () => {
            const res = await list(USER)
            expect(res.users.map((u) => u.nick).sort()).toEqual(['Админ', 'Второй', 'Чужой', 'frnkness'].sort())
            expect(res.has_more).toBe(false)
            expect(Object.keys(res.users[0]).sort()).toEqual(['avatar', 'id', 'nick', 'relation'])
            expect(res.users.every((u) => u.id !== USER.sub)).toBe(true)
        })

        it('забаненные и удалённые не попадают в список', async () => {
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER2.sub}'; update auth.users set deleted_at = now() where id = '${STRANGER.sub}'`)
            const nicks = (await list(USER)).users.map((u) => u.nick)
            expect(nicks).not.toContain('Второй')
            expect(nicks).not.toContain('Чужой')
            expect(nicks).toContain('Админ')
        })

        it('отношение: none / outgoing / incoming / friend', async () => {
            await rpc(USER, 'public.friend_request($1)', [USER2.sub])
            await rpc(STRANGER, 'public.friend_request($1)', [USER.sub])
            await rpc(ADMIN, 'public.friend_request($1)', [USER.sub])
            await rpc(USER, 'public.friend_respond($1, true)', [ADMIN.sub])
            const rel = Object.fromEntries((await list(USER)).users.map((u) => [u.nick, u.relation]))
            expect(rel).toEqual({ Второй: 'outgoing', Чужой: 'incoming', Админ: 'friend', frnkness: 'none' })
        })

        it('поиск по подстроке без учёта регистра; шаблонные символы не работают как шаблон', async () => {
            expect((await list(USER, 'ВТОР')).users.map((u) => u.nick)).toEqual(['Второй'])
            expect((await list(USER, '%')).users).toEqual([])
            expect((await list(USER, '_')).users).toEqual([])
            await expect(list(USER, 'x'.repeat(21))).rejects.toThrow(/длинный/)
        })

        it('подгрузка частями по курсору: без повторов и пропусков', async () => {
            const p1 = await list(USER, '', null, 2)
            expect(p1.users).toHaveLength(2)
            expect(p1.has_more).toBe(true)
            const p2 = await list(USER, '', p1.next, 2)
            expect(p2.users).toHaveLength(2)
            expect(p2.has_more).toBe(false)
            const all = [...p1.users, ...p2.users].map((u) => u.nick)
            expect(new Set(all).size).toBe(4)
        })

        it('аноним и забаненный вызвать не могут', async () => {
            await expect(as(db, 'anon', ANON, `select public.list_discoverable_users('', null, 30)`)).rejects.toThrow(/permission denied/)
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${STRANGER.sub}'`)
            await expect(list(STRANGER)).rejects.toThrow(/Нужно войти/)
        })
    })

    describe('журнал ошибок', () => {
        it('аноним и вошедший пишут; вошедшему проставляется user_id', async () => {
            await logErr(null, 'boom', { client: 'abcdefgh12' })
            await logErr(USER, 'boom 2')
            const rows = (await db.query<any>('select user_id, message, browser, build from public.client_errors order by id')).rows
            expect(rows).toHaveLength(2)
            expect(rows[0].user_id).toBeNull()
            expect(rows[1].user_id).toBe(USER.sub)
            expect(rows[0].build).toBe('abc1234')
        })

        it('прямого доступа к таблицам нет ни у кого', async () => {
            await logErr(USER, 'x')
            for (const t of ['client_errors', 'feedback_reports']) {
                await expect(as(db, 'anon', ANON, `select * from public.${t}`)).rejects.toThrow(/permission denied/)
                await expect(as(db, 'authenticated', ADMIN, `select * from public.${t}`)).rejects.toThrow(/permission denied/)
                await expect(as(db, 'authenticated', OWNER, `delete from public.${t}`)).rejects.toThrow(/permission denied/)
                await expect(as(db, 'authenticated', USER, `insert into public.${t} (message) values ('x')`)).rejects.toThrow(/permission denied/)
            }
        })

        it('лимит: 20 в час на пользователя; лишние молча отбрасываются без ошибки', async () => {
            for (let i = 0; i < 25; i++) await logErr(USER, `err ${i} ${'x'.repeat(i)}`)
            expect(await n(`select count(*) as n from public.client_errors where user_id = '${USER.sub}'`)).toBe(20)
            // Другой пользователь не затронут.
            await logErr(USER2, 'other')
            expect(await n(`select count(*) as n from public.client_errors where user_id = '${USER2.sub}'`)).toBe(1)
        })

        it('лимит на браузер для анонима: 20 в час на ключ; без ключа — общая корзина', async () => {
            for (let i = 0; i < 22; i++) await logErr(null, `a${i}`, { client: 'browserkey1' })
            expect(await n(`select count(*) as n from public.client_errors`)).toBe(20)
            await logErr(null, 'second browser', { client: 'browserkey2' })
            expect(await n(`select count(*) as n from public.client_errors`)).toBe(21)
            // Кривой ключ не даёт обойти лимит: все такие делят одну корзину.
            for (let i = 0; i < 25; i++) await logErr(null, `n${i}`, { client: `bad key ${i}` })
            expect(await n(`select count(*) as n from public.client_errors where message like 'n%'`)).toBe(20)
        })

        it('общий потолок на весь сайт: сверх — молча отбрасываем', async () => {
            await db.exec(`
                insert into public.rate_limits (action, key_hash)
                select 'client-error-all', 'site' from generate_series(1, 499);
            `)
            await logErr(null, 'first', { client: 'floodkey001' })
            await logErr(null, 'second', { client: 'floodkey002' })
            await logErr(USER, 'third')
            expect(await n(`select count(*) as n from public.client_errors`)).toBe(1)
            // Через час окно освобождается.
            await db.exec(`update public.rate_limits set created_at = now() - interval '2 hours' where action = 'client-error-all'`)
            await logErr(USER, 'after hour')
            expect(await n(`select count(*) as n from public.client_errors`)).toBe(2)
        })

        it('токены, пароли, почта, uuid и параметры адреса вычищаются; длина ограничена', async () => {
            const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'
            await logErr(USER, `Failed: Bearer ${'a'.repeat(30)} password=hunter2 token: "abc123def" mail me@example.com ${jwt} user ${USER.sub}`, {
                stack: ['Error: x', ...Array.from({ length: 20 }, (_, i) => `    at f${i} (https://frnkness.ru/assets/app.js?access_token=SECRET${i}:1:2)`)].join('\n'),
                page: `https://frnkness.ru/#/welcome?next=/room/${USER.sub}&token=zzz`,
                browser: 'Chrome '.repeat(50)
            })
            const r = (await db.query<any>('select * from public.client_errors')).rows[0]
            const all = [r.message, r.stack, r.page, r.browser].join('\n')
            for (const secret of ['hunter2', 'abc123def', 'me@example.com', jwt, USER.sub, 'SECRET', 'zzz', 'a'.repeat(30)]) {
                expect(all, secret).not.toContain(secret)
            }
            expect(r.stack.split('\n').length).toBeLessThanOrEqual(8)
            expect(r.browser.length).toBe(120)
        })

        it('пустое сообщение и не-строки не падают и не пишутся', async () => {
            await logErr(null, '   ')
            await logErr(null, '\u0001\u0002')
            await anon('public.log_client_error(null, null, null, null, null, null)')
            expect(await n(`select count(*) as n from public.client_errors`)).toBe(0)
        })

        it('одинаковые ошибки получают один отпечаток; разные — разные', async () => {
            await logErr(USER, 'Load failed 123', { stack: 'at a (x.js:1:2)' })
            await logErr(USER2, 'Load failed 456', { stack: 'at a (x.js:9:9)' })
            await logErr(USER, 'Other', { stack: 'at b (x.js:1:2)' })
            const fps = (await db.query<any>('select count(distinct fingerprint) as n from public.client_errors')).rows[0].n
            expect(Number(fps)).toBe(2)
        })

        it('админка: группы, счётчик, браузеры; «решена» и возврат при повторе; обычному пользователю нельзя', async () => {
            await logErr(USER, 'Boom', { stack: 'at a (x.js:1:1)', browser: 'Chrome 126' })
            await logErr(USER2, 'Boom', { stack: 'at a (x.js:1:1)', browser: 'Safari 17' })
            await logErr(USER2, 'Boom', { stack: 'at a (x.js:1:1)', browser: 'Chrome 126' })
            await logErr(USER, 'Another')
            const groups = await rpc(ADMIN, 'public.admin_errors_list(false)')
            expect(groups).toHaveLength(2)
            const boom = groups.find((g: any) => g.message === 'Boom')
            expect(boom.count).toBe(3)
            expect(boom.users).toBe(2)
            expect(boom.browsers[0]).toEqual({ browser: 'Chrome 126', count: 2 })
            expect(boom.resolved).toBe(false)

            expect(await rpc(OWNER, 'public.admin_errors_resolve($1, true)', [boom.fingerprint])).toBe(3)
            expect(await rpc(ADMIN, 'public.admin_errors_list(false)')).toHaveLength(1)
            expect(await rpc(ADMIN, 'public.admin_errors_list(true)')).toHaveLength(1)
            // Ошибка вернулась — группа снова нерешённая.
            await logErr(USER, 'Boom', { stack: 'at a (x.js:1:1)' })
            expect(await rpc(ADMIN, 'public.admin_errors_list(false)')).toHaveLength(2)

            await expect(rpc(USER, 'public.admin_errors_list(false)')).rejects.toThrow(/Нет доступа/)
            await expect(rpc(USER, 'public.admin_errors_resolve($1, true)', [boom.fingerprint])).rejects.toThrow(/Нет доступа/)
            await expect(as(db, 'anon', ANON, `select public.admin_errors_list(false)`)).rejects.toThrow(/permission denied/)
            await expect(rpc(ADMIN, 'public.admin_errors_resolve($1, true)', ['nope'])).rejects.toThrow(/отпечаток/)
        })

        it('записи старше 30 дней удаляются при обращении к разделу', async () => {
            await logErr(USER, 'Old')
            await logErr(USER, 'Fresh')
            await db.exec(`update public.client_errors set created_at = now() - interval '31 days' where message = 'Old'`)
            const groups = await rpc(ADMIN, 'public.admin_errors_list(false)')
            expect(groups.map((g: any) => g.message)).toEqual(['Fresh'])
            expect(await n(`select count(*) as n from public.client_errors`)).toBe(1)
        })
    })

    describe('обращения', () => {
        const send = (claims: object, text: string) => rpc(claims, 'public.submit_feedback($1,$2,$3,$4)', [text, '#/track/a/b?x=1', 'Chrome 126', 'abc1234'])

        it('вошедший отправляет; страница, браузер и версия прикладываются', async () => {
            expect(await send(USER, 'Не играет трек')).toEqual({ ok: true })
            const row = (await db.query<any>('select * from public.feedback_reports')).rows[0]
            expect(row).toMatchObject({ user_id: USER.sub, nick: 'Яна', message: 'Не играет трек', browser: 'Chrome 126', build: 'abc1234', status: 'new' })
            expect(row.page).toBe('#/track/a/b?…')
        })

        it('пустой, слишком длинный текст — ошибка; ровно 1000 — можно', async () => {
            await expect(send(USER, '   ')).rejects.toThrow(/Напиши/)
            await expect(send(USER, 'я'.repeat(1001))).rejects.toThrow(/1000/)
            await send(USER, 'я'.repeat(1000))
            expect(await n('select count(*) as n from public.feedback_reports')).toBe(1)
            // Неудачные попытки лимит не расходуют.
            expect(await n(`select count(*) as n from public.rate_limits where action = 'feedback'`)).toBe(1)
        })

        it('не больше 5 в сутки на пользователя; другой пользователь не затронут; через сутки можно', async () => {
            for (let i = 0; i < 5; i++) await send(USER, `обращение ${i}`)
            await expect(send(USER, 'шестое')).rejects.toThrow(/много обращений/)
            await send(USER2, 'моё')
            expect(await n('select count(*) as n from public.feedback_reports')).toBe(6)
            await db.exec(`update public.rate_limits set created_at = now() - interval '25 hours'`)
            await send(USER, 'новый день')
            expect(await n('select count(*) as n from public.feedback_reports')).toBe(7)
        })

        it('аноним и забаненный отправить не могут', async () => {
            await expect(as(db, 'anon', ANON, `select public.submit_feedback('x','','','')`)).rejects.toThrow(/permission denied/)
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER.sub}'`)
            await expect(send(USER, 'x')).rejects.toThrow(/Нужно войти/)
        })

        it('админка: список, статусы, счётчик новых; обычному пользователю нельзя', async () => {
            await send(USER, 'первое')
            await send(USER2, 'второе')
            expect(await rpc(ADMIN, 'public.admin_feedback_new_count()')).toBe(2)
            const list = await rpc(ADMIN, 'public.admin_feedback_list(null)')
            expect(list.map((f: any) => f.nick).sort()).toEqual(['Второй', 'Яна'])
            expect(Object.keys(list[0]).sort()).toEqual(['browser', 'build', 'closed_at', 'created_at', 'id', 'message', 'nick', 'page', 'status', 'user_id'])

            await rpc(OWNER, 'public.admin_feedback_set($1,$2)', [list[0].id, 'done'])
            expect(await rpc(ADMIN, 'public.admin_feedback_new_count()')).toBe(1)
            expect(await rpc(ADMIN, 'public.admin_feedback_list($1)', ['done'])).toHaveLength(1)
            expect((await rpc(ADMIN, 'public.admin_feedback_list($1)', ['new'])).map((f: any) => f.status)).toEqual(['new'])
            await rpc(ADMIN, 'public.admin_feedback_set($1,$2)', [list[0].id, 'new'])
            expect(await rpc(ADMIN, 'public.admin_feedback_new_count()')).toBe(2)

            await expect(rpc(USER, 'public.admin_feedback_list(null)')).rejects.toThrow(/Нет доступа/)
            await expect(rpc(USER, 'public.admin_feedback_set($1,$2)', [list[0].id, 'done'])).rejects.toThrow(/Нет доступа/)
            await expect(rpc(USER, 'public.admin_feedback_new_count()')).rejects.toThrow(/Нет доступа/)
            await expect(rpc(ADMIN, 'public.admin_feedback_set($1,$2)', [list[0].id, 'bad'])).rejects.toThrow(/статус/)
            await expect(rpc(ADMIN, 'public.admin_feedback_set($1,$2)', [999999, 'done'])).rejects.toThrow(/не найдено/)
            await expect(as(db, 'anon', ANON, `select public.admin_feedback_list(null)`)).rejects.toThrow(/permission denied/)
        })

        it('после удаления пользователя обращение остаётся с ником на момент отправки', async () => {
            await send(STRANGER, 'прощай')
            await db.exec(`delete from public.profiles where id = '${STRANGER.sub}'; delete from auth.users where id = '${STRANGER.sub}'`)
            const list = await rpc(ADMIN, 'public.admin_feedback_list(null)')
            expect(list[0]).toMatchObject({ nick: 'Чужой', user_id: null })
            // Вернём пользователя для остальных тестов.
            await db.exec(`
                insert into auth.users (id, email, raw_app_meta_data) values ('${STRANGER.sub}', '${TECH(999)}', '{"role":"user"}');
                insert into public.profiles (id, nick, nick_key) values ('${STRANGER.sub}', 'Чужой', 'чужои');
            `)
        })
    })

    describe('права на функции', () => {
        it('anon может вызывать только log_client_error; внутренние помощники закрыты всем', async () => {
            const rows = (
                await db.query<any>(`
                    select p.proname, has_function_privilege('anon', p.oid, 'execute') as a, has_function_privilege('authenticated', p.oid, 'execute') as u
                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname in ('list_discoverable_users','scrub_client_text','client_errors_site_cap','log_client_error','admin_errors_list','admin_errors_resolve','submit_feedback','admin_feedback_list','admin_feedback_set','admin_feedback_new_count')
                `)
            ).rows
            const by = Object.fromEntries(rows.map((r) => [r.proname, r]))
            expect(rows).toHaveLength(10)
            expect(by.log_client_error).toMatchObject({ a: true, u: true })
            for (const name of ['list_discoverable_users', 'admin_errors_list', 'admin_errors_resolve', 'submit_feedback', 'admin_feedback_list', 'admin_feedback_set', 'admin_feedback_new_count']) {
                expect(by[name], name).toMatchObject({ a: false, u: true })
            }
            for (const name of ['scrub_client_text', 'client_errors_site_cap']) expect(by[name], name).toMatchObject({ a: false, u: false })
        })

        it('все security definer функции миграции работают с пустым search_path', async () => {
            const rows = (
                await db.query<any>(`
                    select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.prosecdef
                      and p.proname in ('list_discoverable_users','log_client_error','admin_errors_list','admin_errors_resolve','submit_feedback','admin_feedback_list','admin_feedback_set','admin_feedback_new_count')
                `)
            ).rows
            expect(rows).toHaveLength(8)
            for (const r of rows) expect(r.proconfig, r.proname).toContain('search_path=""')
        })
    })
})
