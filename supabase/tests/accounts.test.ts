// @vitest-environment node
/**
 * Права этапа «Аккаунты» на настоящем Postgres (PGlite): пользователь не
 * видит и не меняет чужое, обычный пользователь не достаёт до админских и
 * владельческих RPC, владельца нельзя удалить или понизить.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { ADMIN, ANON, OWNER, REPO, USER, USER2, applyMigrations, as, createDb } from './pgHarness'
import { nickKey, techEmail } from '../functions/_shared/accounts.ts'

const TECH = (c: string) => `u-${c.repeat(32)}@id.frnkness.ru`

describe('аккаунты: права', () => {
    let db: PGlite
    const one = async (sql: string, params?: unknown[]) => (await db.query<any>(sql, params)).rows[0]

    beforeAll(async () => {
        db = await createDb()
        // Таблица из аудита прода: RLS выключен, у anon полные права.
        await db.exec('create table public.play_counts_backup (track_key text, plays bigint); grant all on public.play_counts_backup to anon, authenticated;')
        await applyMigrations(db)
        await applyMigrations(db) // повторный прогон не падает
        await db.exec(`
            insert into public.profiles (id, nick, nick_key) values
                ('${OWNER.sub}', 'frnkness', 'frnkness'),
                ('${ADMIN.sub}', 'Друг', 'друг'),
                ('${USER.sub}', 'Яна', 'яна'),
                ('${USER2.sub}', 'Второй', 'второи');
            insert into public.account_private (id, must_change_password) values
                ('${USER.sub}', true), ('${USER2.sub}', false);
        `)
    }, 60_000)

    describe('исправления аудита', () => {
        it('play_counts_backup: RLS включён, anon и authenticated без прав', async () => {
            expect((await one("select relrowsecurity r from pg_class where oid = 'public.play_counts_backup'::regclass")).r).toBe(true)
            await expect(as(db, 'anon', ANON, 'select * from public.play_counts_backup')).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, 'delete from public.play_counts_backup')).rejects.toThrow(/permission denied/)
        })

        it('новая таблица в public по умолчанию закрыта для anon и authenticated', async () => {
            await db.exec('create table public.future_table (id int)')
            await expect(as(db, 'anon', ANON, 'select * from public.future_table')).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, 'select * from public.future_table')).rejects.toThrow(/permission denied/)
            await db.exec('drop table public.future_table')
        })

        it('keepalive доступен без входа', async () => {
            expect((await as(db, 'anon', ANON, 'select public.keepalive() as v')).rows[0].v).toBe(1)
        })
    })

    describe('профили', () => {
        it('вошедшие видят ник, аватар, «о себе», дату; аноним — ничего', async () => {
            const rows = (await as(db, 'authenticated', USER, 'select id, nick, avatar, bio, created_at from public.profiles')).rows
            expect(rows).toHaveLength(4)
            await expect(as(db, 'anon', ANON, 'select nick from public.profiles')).rejects.toThrow(/permission denied/)
        })

        it('ключ ника не читается напрямую', async () => {
            await expect(as(db, 'authenticated', USER, 'select nick_key from public.profiles')).rejects.toThrow(/permission denied/)
        })

        it('свои «о себе» и аватар меняются, чужие — нет', async () => {
            await as(db, 'authenticated', USER, "update public.profiles set bio = 'привет', avatar = 'emoji:3' where id = $1", [USER.sub])
            expect(await one('select bio, avatar from public.profiles where id = $1', [USER.sub])).toEqual({ bio: 'привет', avatar: 'emoji:3' })
            await as(db, 'authenticated', USER, "update public.profiles set bio = 'взлом' where id = $1", [USER2.sub])
            expect((await one('select bio from public.profiles where id = $1', [USER2.sub])).bio).toBe('')
        })

        it('ник, ключ ника, вставка и удаление — только функциями', async () => {
            await expect(as(db, 'authenticated', USER, "update public.profiles set nick = 'admin' where id = $1", [USER.sub])).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, "update public.profiles set nick_key = 'x' where id = $1", [USER.sub])).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, "insert into public.profiles (id, nick, nick_key) values ($1, 'abc', 'abc')", [USER.sub])).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, 'delete from public.profiles where id = $1', [USER.sub])).rejects.toThrow(/permission denied/)
        })

        it('проверки: «о себе» до 200 символов, аватар только из допустимых вариантов', async () => {
            await expect(as(db, 'authenticated', USER, "update public.profiles set bio = repeat('я', 201) where id = $1", [USER.sub])).rejects.toThrow(/check/)
            for (const bad of ['javascript:alert(1)', 'upload:x', 'cover:../x', 'emoji:999']) {
                await expect(as(db, 'authenticated', USER, 'update public.profiles set avatar = $2 where id = $1', [USER.sub, bad])).rejects.toThrow(/check/)
            }
        })

        it('флаги аккаунта видит только владелец аккаунта', async () => {
            const own = (await as(db, 'authenticated', USER, 'select id, must_change_password from public.account_private')).rows
            expect(own).toEqual([{ id: USER.sub, must_change_password: true }])
            await expect(as(db, 'authenticated', USER, 'update public.account_private set must_change_password = false')).rejects.toThrow(/permission denied/)
        })

        it('забаненный не видит профили', async () => {
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER2.sub}'`)
            expect((await as(db, 'authenticated', USER2, 'select id from public.profiles')).rows).toHaveLength(0)
            await db.exec(`update auth.users set banned_until = null where id = '${USER2.sub}'`)
        })
    })

    describe('статистика — только вошедшие', () => {
        it('аноним не может засчитать прослушивание', async () => {
            await expect(as(db, 'anon', ANON, "select public.increment_play_count('faaa-0')")).rejects.toThrow(/permission denied/)
        })

        it('прослушивание пишется с user_id', async () => {
            await as(db, 'authenticated', USER2, "select public.increment_play_count('faaa-0')")
            expect((await one('select user_id from public.play_events order by id desc limit 1')).user_id).toBe(USER2.sub)
        })

        it('токен удалённого или забаненного пользователя не засчитывает', async () => {
            const ghost = { role: 'authenticated', sub: '00000000-0000-4000-8000-0000000000ff' }
            await expect(as(db, 'authenticated', ghost, "select public.increment_play_count('faaa-0')")).rejects.toThrow(/Нужно войти/)
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER2.sub}'`)
            await expect(as(db, 'authenticated', USER2, "select public.increment_play_count('faaa-0')")).rejects.toThrow(/Нужно войти/)
            await db.exec(`update auth.users set banned_until = null where id = '${USER2.sub}'`)
        })

        it('чужую сессию прослушивания перезаписать нельзя', async () => {
            const sid = '44444444-4444-4444-8444-444444444444'
            const rec = (claims: object, listened: number) =>
                as(db, 'authenticated', claims, 'select public.record_listen_session($1, $2, $3, $4, $5, $6)', [sid, 'faaa-0', listened, listened, 100, false])
            await rec(USER, 10)
            await rec(USER2, 90)
            const row = await one('select user_id, listened_seconds from public.listen_sessions where session_id = $1', [sid])
            expect(row.user_id).toBe(USER.sub)
            expect(Number(row.listened_seconds)).toBe(10)
        })

        it('журналы напрямую не читаются никем, кроме RPC', async () => {
            await expect(as(db, 'authenticated', USER, 'select * from public.play_events')).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', ADMIN, 'select * from public.listen_sessions')).rejects.toThrow(/permission denied/)
        })
    })

    describe('админские и владельческие RPC', () => {
        const ADMIN_RPCS = [
            "select * from public.admin_users_list('')",
            `select public.admin_user_card('${USER.sub}')`,
            'select public.admin_users_overview()',
            "select * from public.admin_users_daily('2026-10-01', '2026-10-07')",
            'select public.admin_stats_overview()',
            'select public.admin_listen_meta()'
        ]
        const OWNER_RPCS = ['select * from public.owner_recovery_list()', 'select public.owner_recovery_new_count()', "select public.owner_recovery_close(1, 'done')"]
        const SERVICE_RPCS = [
            "select public.rate_limit_hit('register', 'x', 5, interval '1 day')",
            `select public.service_sign_out_user('${USER.sub}')`,
            "select public.auth_hook_send_email_noop('{}'::jsonb)",
            'select public.current_app_role()'
        ]

        it.each(ADMIN_RPCS)('пользователь получает «Нет доступа», аноним — нет прав: %s', async (sql) => {
            await expect(as(db, 'authenticated', USER, sql)).rejects.toThrow(/Нет доступа/)
            await expect(as(db, 'anon', ANON, sql)).rejects.toThrow(/permission denied/)
        })

        it.each(ADMIN_RPCS)('admin и owner проходят: %s', async (sql) => {
            await as(db, 'authenticated', ADMIN, sql)
            await as(db, 'authenticated', OWNER, sql)
        })

        it.each(OWNER_RPCS)('пользователь и admin получают «Нет доступа»: %s', async (sql) => {
            await expect(as(db, 'authenticated', USER, sql)).rejects.toThrow(/Нет доступа/)
            await expect(as(db, 'authenticated', ADMIN, sql)).rejects.toThrow(/Нет доступа/)
            await expect(as(db, 'anon', ANON, sql)).rejects.toThrow(/permission denied/)
        })

        it.each(SERVICE_RPCS)('только service role: %s', async (sql) => {
            for (const claims of [USER, ADMIN, OWNER]) await expect(as(db, 'authenticated', claims, sql)).rejects.toThrow(/permission denied/)
            await expect(as(db, 'anon', ANON, sql)).rejects.toThrow(/permission denied/)
        })

        it('админ, лишённый роли, теряет доступ сразу (роль из базы, не из токена)', async () => {
            await db.exec(`update auth.users set raw_app_meta_data = '{"role":"user"}' where id = '${ADMIN.sub}'`)
            await expect(as(db, 'authenticated', ADMIN, 'select public.admin_users_overview()')).rejects.toThrow(/Нет доступа/)
            await db.exec(`update auth.users set raw_app_meta_data = '{"role":"admin"}' where id = '${ADMIN.sub}'`)
        })

        it('поиск пользователей по нику без учёта регистра; % и _ — обычные символы', async () => {
            const nicks = async (q: string) => (await as(db, 'authenticated', ADMIN, 'select nick from public.admin_users_list($1)', [q])).rows.map((r) => r.nick)
            expect(await nicks('ЯН')).toEqual(['Яна'])
            expect(await nicks('%')).toEqual([])
            expect(await nicks('_')).toEqual([])
            expect((await nicks('')).length).toBe(4)
        })

        it('карточка: роль, флаг смены пароля, топ треков пользователя', async () => {
            const card = (await as(db, 'authenticated', ADMIN, 'select public.admin_user_card($1) c', [USER2.sub])).rows[0].c
            expect(card.nick).toBe('Второй')
            expect(card.role).toBe('user')
            expect(card.plays).toBeGreaterThan(0)
            expect(card.top[0].track_key).toBe('faaa-0')
        })

        it('админ не может менять роли и вообще auth.users напрямую', async () => {
            await expect(as(db, 'authenticated', ADMIN, `update auth.users set raw_app_meta_data = '{"role":"admin"}' where id = '${USER.sub}'`)).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', OWNER, `delete from auth.users where id = '${USER.sub}'`)).rejects.toThrow(/permission denied/)
        })
    })

    describe('заявки на восстановление', () => {
        beforeAll(async () => {
            await db.exec(`insert into public.recovery_requests (nick, nick_key, user_id, contact, comment)
                values ('Ян', 'ян', '${USER.sub}', '@yan_tg', 'забыл')`)
        })

        it('таблица закрыта для всех, включая админа и владельца', async () => {
            for (const claims of [USER, ADMIN, OWNER]) {
                await expect(as(db, 'authenticated', claims, 'select * from public.recovery_requests')).rejects.toThrow(/permission denied/)
            }
            await expect(as(db, 'anon', ANON, "insert into public.recovery_requests (nick, nick_key, contact) values ('a', 'a', 'b')")).rejects.toThrow(/permission denied/)
        })

        it('владелец видит заявку и счётчик, закрытие стирает контакт', async () => {
            const list = (await as(db, 'authenticated', OWNER, 'select * from public.owner_recovery_list()')).rows
            expect(list[0]).toMatchObject({ nick: 'Ян', current_nick: 'Яна', contact: '@yan_tg', status: 'new' })
            expect((await as(db, 'authenticated', OWNER, 'select public.owner_recovery_new_count() n')).rows[0].n).toBe(1)
            await as(db, 'authenticated', OWNER, 'select public.owner_recovery_close($1, $2)', [list[0].id, 'done'])
            expect(await one('select status, contact, closed_at is not null as closed from public.recovery_requests where id = $1', [list[0].id])).toEqual({
                status: 'done',
                contact: null,
                closed: true
            })
            await expect(as(db, 'authenticated', OWNER, 'select public.owner_recovery_close($1, $2)', [list[0].id, 'rejected'])).rejects.toThrow(/уже закрыта/)
        })

        it('закрытая заявка с контактом невозможна даже напрямую', async () => {
            await expect(db.exec("insert into public.recovery_requests (nick, nick_key, contact, status, closed_at) values ('a', 'a', 'tg', 'done', now())")).rejects.toThrow(/check/)
        })
    })

    describe('аватары и бакеты', () => {
        const put = (claims: object, bucket: string, name: string) =>
            as(db, 'authenticated', claims, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name])

        it('бакет avatars: публичный, до 512 КБ, только картинки', async () => {
            const b = await one("select * from storage.buckets where id = 'avatars'")
            expect(b.public).toBe(true)
            expect(Number(b.file_size_limit)).toBe(524288)
            expect(b.allowed_mime_types).toEqual(['image/webp', 'image/jpeg', 'image/png'])
        })

        it('свой аватар — можно', async () => {
            await put(USER, 'avatars', `${USER.sub}/avatar`)
        })

        it('чужая папка, другое имя, аноним — нельзя', async () => {
            await expect(put(USER, 'avatars', `${USER2.sub}/avatar`)).rejects.toThrow(/row-level security/)
            await expect(put(USER, 'avatars', `${USER.sub}/other.png`)).rejects.toThrow(/row-level security/)
            await expect(put(USER, 'avatars', `${USER.sub}/x/avatar`)).rejects.toThrow(/row-level security/)
            await expect(as(db, 'anon', ANON, "insert into storage.objects (bucket_id, name) values ('avatars', 'x/avatar')")).rejects.toThrow(/row-level security/)
        })

        it('чужой аватар не удалить и не перезаписать', async () => {
            await put(USER2, 'avatars', `${USER2.sub}/avatar`)
            await as(db, 'authenticated', USER, "delete from storage.objects where bucket_id = 'avatars' and name = $1", [`${USER2.sub}/avatar`])
            await as(db, 'authenticated', USER, "update storage.objects set name = $2 where bucket_id = 'avatars' and name = $1", [`${USER2.sub}/avatar`, `${USER.sub}/avatar`])
            expect((await one("select count(*)::int n from storage.objects where bucket_id = 'avatars' and name = $1", [`${USER2.sub}/avatar`])).n).toBe(1)
        })

        it('бакет админки: пользователь не пишет и не читает, owner — может', async () => {
            await expect(put(USER, 'admin-uploads', 'x.mp3')).rejects.toThrow(/row-level security/)
            await put(OWNER, 'admin-uploads', 'owner.mp3')
            expect((await as(db, 'authenticated', USER, "select * from storage.objects where bucket_id = 'admin-uploads'")).rows).toHaveLength(0)
        })
    })

    describe('защита владельца и адресов (даже для service role)', () => {
        it('владельца нельзя удалить, понизить, забанить или мягко удалить', async () => {
            await expect(db.exec(`delete from auth.users where id = '${OWNER.sub}'`)).rejects.toThrow(/нельзя удалить/)
            await expect(db.exec(`update auth.users set raw_app_meta_data = '{"role":"admin"}' where id = '${OWNER.sub}'`)).rejects.toThrow(/нельзя понизить/)
            await expect(db.exec(`update auth.users set raw_app_meta_data = '{}' where id = '${OWNER.sub}'`)).rejects.toThrow(/нельзя понизить/)
            await expect(db.exec(`update auth.users set banned_until = now() + interval '100 years' where id = '${OWNER.sub}'`)).rejects.toThrow(/нельзя забанить/)
            await expect(db.exec(`update auth.users set deleted_at = now() where id = '${OWNER.sub}'`)).rejects.toThrow(/нельзя удалить/)
        })

        it('роль owner не выдаётся ни при создании, ни при изменении', async () => {
            await expect(db.exec(`update auth.users set raw_app_meta_data = '{"role":"owner"}' where id = '${ADMIN.sub}'`)).rejects.toThrow(/только вручную/)
            await expect(
                db.exec(`insert into auth.users (id, email, raw_app_meta_data) values (gen_random_uuid(), '${TECH('a')}', '{"role":"owner"}')`)
            ).rejects.toThrow(/только вручную/)
            await expect(db.exec(`update auth.users set raw_app_meta_data = '{"role":"god"}' where id = '${USER.sub}'`)).rejects.toThrow(/Неизвестная роль/)
        })

        it('аварийный обход в SQL Editor работает', async () => {
            await db.exec(`begin; set local app.owner_override = 'on';
                update auth.users set raw_app_meta_data = '{"role":"owner"}' where id = '${ADMIN.sub}';
                update auth.users set raw_app_meta_data = '{"role":"admin"}' where id = '${ADMIN.sub}';
                commit;`)
            expect((await one(`select raw_app_meta_data ->> 'role' r from auth.users where id = '${ADMIN.sub}'`)).r).toBe('admin')
        })

        it('адрес — только технический', async () => {
            await expect(db.exec(`update auth.users set email = 'real@gmail.com' where id = '${USER.sub}'`)).rejects.toThrow(/техническим/)
            await expect(db.exec(`update auth.users set email_change = 'real@gmail.com' where id = '${USER.sub}'`)).rejects.toThrow(/техническим/)
            await expect(db.exec(`insert into auth.users (id, email) values (gen_random_uuid(), 'x@example.com')`)).rejects.toThrow(/техническим/)
            await db.exec(`update auth.users set email = '${TECH('b')}' where id = '${USER.sub}'`)
            // Обычные обновления (вход) с нетехническим старым адресом не ломаются.
            await db.exec(`update auth.users set last_sign_in_at = now() where id = '${USER2.sub}'`)
        })

        it('админа и пользователя удалить можно: профиль уходит, статистика обезличивается', async () => {
            const plays = Number((await one('select count(*) n from public.play_events')).n)
            await db.exec(`delete from auth.users where id = '${USER2.sub}'`)
            expect(await one('select count(*)::int n from public.profiles where id = $1', [USER2.sub])).toEqual({ n: 0 })
            expect(Number((await one('select count(*) n from public.play_events')).n)).toBe(plays)
            expect(Number((await one('select count(*) n from public.play_events where user_id is null')).n)).toBeGreaterThan(0)
        })
    })

    describe('SQL-помощники для SQL Editor', () => {
        it.each(['frnkness', 'Ян_Ёлкин', 'ДPУГ', 'B0T.x-y', 'Мой'.normalize('NFD'), '  Hello  '])('ключ ника и адрес совпадают с TypeScript: %s', async (nick) => {
            const row = await one('select public.account_nick_key($1) k, public.account_tech_email($1) e', [nick])
            expect(row.k).toBe(nickKey(nick))
            expect(row.e).toBe(await techEmail(nick))
        })

        it('недоступны сайту', async () => {
            await expect(as(db, 'authenticated', USER, "select public.account_tech_email('x')")).rejects.toThrow(/permission denied/)
        })
    })

    describe('лимиты', () => {
        it('rate_limit_hit недоступен вошедшим', async () => {
            await expect(as(db, 'authenticated', USER, "select public.rate_limit_hit('x', 'y', 1, interval '1 day')")).rejects.toThrow(/permission denied/)
        })
    })

    describe('лимиты: service role', () => {
        it('rate_limit_hit: разрешает до лимита, потом отказывает', async () => {
            const hit = async () => (await as(db, 'service_role', { role: 'service_role' }, "select public.rate_limit_hit('register', 'ip1', 2, interval '1 day') v")).rows[0].v
            expect([await hit(), await hit(), await hit()]).toEqual([true, true, false])
        })
    })
})

describe('SQL для аварий (supabase/setup/accounts_emergency.sql)', () => {
    let db: PGlite
    const read = (name: string) => fs.readFileSync(path.join(REPO, 'supabase/setup', name), 'utf8')
    const one = async (sql: string, params?: unknown[]) => (await db.query<any>(sql, params)).rows[0]

    beforeAll(async () => {
        db = await createDb()
        await applyMigrations(db)
        // Владелец с ником, как на настоящем сайте: технический адрес из ника и профиль.
        await db.query('update auth.users set email = $1 where id = $2', [await techEmail('frnkness'), OWNER.sub])
        await db.query('insert into public.profiles (id, nick, nick_key) values ($1, $2, $3)', [OWNER.sub, 'frnkness', nickKey('frnkness')])
    }, 60_000)

    it('аварийный выход: роль владельца и новый пароль возвращаются по нику', async () => {
        const blocks = read('accounts_emergency.sql').split(/^-- ── /m)
        const block = (n: number) => '-- ' + blocks.find((b) => b.startsWith(`${n}.`))!.replace(/ТвойНик/g, 'frnkness')
        await db.exec(`begin; set local app.owner_override = 'on';
            update auth.users set raw_app_meta_data = '{"role":"user"}', banned_until = now() + interval '1 year' where id = '${OWNER.sub}'; commit;`)
        await db.exec(`insert into auth.sessions (user_id) values ('${OWNER.sub}')`)
        expect((await db.query(block(0))).rows.length).toBeGreaterThan(0)
        await db.exec(block(1))
        await db.exec(block(2))
        expect(await one(`select raw_app_meta_data ->> 'role' r, banned_until, encrypted_password p from auth.users where id = '${OWNER.sub}'`)).toEqual({
            r: 'owner',
            banned_until: null,
            p: expect.stringMatching(/^crypt:/)
        })
        expect((await one(`select count(*)::int n from auth.sessions where user_id = '${OWNER.sub}'`)).n).toBe(0)
    })
})
