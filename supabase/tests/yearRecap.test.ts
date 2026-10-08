// @vitest-environment node
/**
 * «Итоги года» на настоящем Postgres (PGlite): подсчёт (границы года по
 * Москве, дата регистрации, топ, время суток, комнаты, избранное), публикация
 * (закрыто / всем / выбранным / исключения) и права (чужие итоги недоступны,
 * админ видит любого, anon и обычные пользователи не вызывают админские
 * функции, таблицы закрыты полностью).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { ADMIN, ANON, OWNER, USER, USER2, applyMigrations, as, createDb } from './pgHarness'

const NEWBIE = { role: 'authenticated', sub: '00000000-0000-4000-8000-000000000004', app_metadata: { role: 'user' } }
const ROOM_A = '11111111-1111-4111-8111-111111111111'
const ROOM_B = '22222222-2222-4222-8222-222222222222'
const ROOM_C = '33333333-3333-4333-8333-333333333333'
const YEAR = 2025

describe('итоги года: подсчёт, публикация, права', () => {
    let db: PGlite
    const rpc = async (claims: object, sql: string, params?: unknown[]) => (await as(db, 'authenticated', claims, `select ${sql} as r`, params)).rows[0].r
    const recap = (claims: object, year = YEAR, user: string | null = null) => rpc(claims, 'public.year_recap($1, $2)', [year, user])
    const setPublish = (action: string, users: string[] = [], year = YEAR) => rpc(ADMIN, 'public.admin_recap_set($1, $2, $3::uuid[])', [year, action, users])
    const state = (claims: object) => rpc(claims, 'public.my_recap_state()')
    const currentYear = async () => (await db.query<{ y: number }>("select extract(year from (now() at time zone 'Europe/Moscow'))::int as y")).rows[0].y

    const play = (user: string, at: string, key: string) =>
        db.query('insert into public.play_events (track_key, created_at, user_id) values ($1, $2, $3)', [key, at, user])
    let sid = 0
    const session = (user: string, at: string, key: string, seconds: number) =>
        db.query(
            'insert into public.listen_sessions (session_id, track_key, listened_seconds, max_position, duration, created_at, user_id) values (gen_random_uuid(), $1, $2, $2, 300, $3, $4)',
            [key, seconds, at, user]
        ).then(() => sid++)
    const visit = (user: string, room: string, from: string, to: string | null) =>
        db.query('insert into public.room_visits (user_id, room_id, role, joined_at, left_at) values ($1, $2, $3, $4, $5)', [user, room, 'guest', from, to])

    const resetPublication = () => db.exec('delete from public.recap_snapshots; delete from public.recap_grants; delete from public.recap_settings;')

    beforeAll(async () => {
        db = await createDb()
        await applyMigrations(db)
        await applyMigrations(db) // повторный прогон не падает
        await db.exec(`
            insert into public.profiles (id, nick, nick_key, created_at) values
                ('${OWNER.sub}', 'frnkness', 'frnkness', '2025-01-01 00:00:00+03'),
                ('${ADMIN.sub}', 'Друг', 'друг', '2025-01-01 00:00:00+03'),
                ('${USER.sub}', 'Яна', 'яна', '2025-03-10 12:00:00+03'),
                ('${USER2.sub}', 'Второй', 'второи', '2025-01-02 00:00:00+03');
        `)
        // Яна: 12 прослушиваний в 2025 (по Москве) + граничные, которые не считаются.
        const rows: [string, string][] = [
            ['2025-05-05 08:00:00+03', 'a-0'], ['2025-05-05 08:30:00+03', 'a-0'], ['2025-05-05 13:00:00+03', 'a-1'],
            ['2025-05-05 19:00:00+03', 'a-0'], ['2025-06-01 23:30:00+03', 'b-0'], ['2025-06-01 02:00:00+03', 'b-0'],
            ['2025-06-02 20:00:00+03', 'a-1'], ['2025-07-01 12:00:00+03', 'a-0'], ['2025-07-01 12:10:00+03', 'b-0'],
            ['2025-12-31 23:59:59+03', 'c-2'], ['2025-12-31 21:00:00+03', 'c-2'], ['2025-07-02 23:10:00+03', 'a-1'],
            // не считаются: до регистрации, прошлый год (за секунду до), следующий год (ровно полночь)
            ['2025-02-01 10:00:00+03', 'z-9'], ['2024-12-31 23:59:59+03', 'z-9'], ['2026-01-01 00:00:00+03', 'z-9']
        ]
        for (const [at, key] of rows) await play(USER.sub, at, key)
        await play(USER2.sub, '2025-05-05 10:00:00+03', 'q-0')
        await play(USER2.sub, '2025-05-05 10:01:00+03', 'q-0')
        await play(USER2.sub, '2025-05-05 10:02:00+03', 'q-1')
        await db.query("insert into public.play_events (track_key, created_at) values ('a-0', '2025-05-05 10:00:00+03')") // без аккаунта

        await session(USER.sub, '2025-05-05 08:00:00+03', 'a-0', 600)
        await session(USER.sub, '2025-05-05 19:00:00+03', 'a-0', 1200)
        await session(USER.sub, '2025-05-05 00:20:00+03', 'a-0', 600) // по UTC это 4 мая, по Москве — 5 мая
        await session(USER.sub, '2025-06-01 23:30:00+03', 'b-0', 300)
        await session(USER.sub, '2025-06-02 20:00:00+03', 'a-1', 60)
        await session(USER.sub, '2025-12-31 23:59:59+03', 'c-2', 100)
        await session(USER.sub, '2026-01-01 00:00:00+03', 'a-0', 99999)

        await db.exec(`
            insert into public.favorites (user_id, track_id, created_at) values
                ('${USER.sub}', 'album-one/t1', '2025-06-01 12:00:00+03'),
                ('${USER.sub}', 'album-one/t2', '2025-12-31 23:00:00+03'),
                ('${USER.sub}', 'album-one/t3', '2024-12-31 23:00:00+03'),
                ('${USER.sub}', 'album-one/t4', '2025-02-01 12:00:00+03');
        `)
        await visit(USER.sub, ROOM_A, '2025-08-01 10:00:00+03', '2025-08-01 11:00:00+03')
        await visit(USER2.sub, ROOM_A, '2025-08-01 10:30:00+03', '2025-08-01 11:30:00+03')
        await visit(ADMIN.sub, ROOM_A, '2025-08-01 12:00:00+03', '2025-08-01 13:00:00+03')
        await visit(USER.sub, ROOM_B, '2025-09-01 10:00:00+03', '2025-09-01 10:20:00+03')
        await visit(USER2.sub, ROOM_B, '2025-09-01 10:00:00+03', '2025-09-01 10:20:00+03')
        await visit(USER.sub, ROOM_C, '2026-01-02 10:00:00+03', '2026-01-02 11:00:00+03')
    }, 120_000)

    afterEach(resetPublication)

    describe('подсчёт', () => {
        it('все цифры Яны за 2025 (админ смотрит закрытые итоги)', async () => {
            const r = await recap(ADMIN, YEAR, USER.sub)
            expect(r.user).toMatchObject({ id: USER.sub, nick: 'Яна' })
            expect(r.final).toBe(true)
            expect(r.sparse).toBe(false)
            expect(r.plays).toBe(12)
            expect(r.minutes).toBe(48) // (600+1200+600+300+60+100) / 60 = 47,67
            expect(r.top_tracks.map((t: any) => t.track_key)).toEqual(['a-0', 'b-0', 'a-1', 'c-2'])
            expect(r.top_tracks[0]).toMatchObject({ plays: 4, minutes: 40 })
            // Равенство по прослушиваниям (3 и 3) решают минуты: b-0 слушали дольше.
            expect(r.top_tracks[1]).toMatchObject({ track_key: 'b-0', plays: 3, minutes: 5 })
            expect(r.top_release).toMatchObject({ release_id: 'a', plays: 7 })
            expect(r.first_track.track_key).toBe('a-0')
            expect(new Date(r.first_track.at).toISOString()).toBe('2025-05-05T05:00:00.000Z') // 08:00 МСК
            expect(r.best_day).toEqual({ date: '2025-05-05', minutes: 40 })
            expect(r.day_parts).toEqual({ morning: 2, day: 3, evening: 3, night: 4 })
            expect(r.favorites_added).toBe(2)
        })

        it('период: с даты регистрации (она позже 1 января) по 31 декабря, время московское', async () => {
            const r = await recap(ADMIN, YEAR, USER.sub)
            expect(new Date(r.period.from).toISOString()).toBe('2025-03-10T09:00:00.000Z')
            expect(new Date(r.period.to).toISOString()).toBe('2025-12-31T20:59:59.000Z') // 23:59:59 МСК
            const other = await recap(ADMIN, YEAR, USER2.sub)
            expect(new Date(other.period.from).toISOString()).toBe('2025-01-01T21:00:00.000Z') // регистрация 2 января 00:00 МСК
        })

        it('комнаты: сколько и с кем чаще — по времени вместе', async () => {
            const r = await recap(ADMIN, YEAR, USER.sub)
            expect(r.rooms.count).toBe(2) // ROOM_C — 2026 год
            expect(r.rooms.with).toHaveLength(1) // админ был в комнате в другое время
            expect(r.rooms.with[0]).toMatchObject({ user_id: USER2.sub, nick: 'Второй', rooms: 2, minutes: 50 })
        })

        it('мало данных: меньше 10 прослушиваний — флаг sparse, ничего не падает', async () => {
            const r = await recap(ADMIN, YEAR, USER2.sub)
            expect(r.sparse).toBe(true)
            expect(r.plays).toBe(3)
            const empty = await recap(ADMIN, YEAR, ADMIN.sub)
            expect(empty).toMatchObject({ sparse: true, plays: 0, minutes: 0, top_tracks: [], top_release: null, first_track: null, best_day: null, favorites_added: 0 })
            expect(empty.rooms.count).toBe(1)
        })

        it('закончившийся год фиксируется и не меняется', async () => {
            const before = await recap(ADMIN, YEAR, USER.sub)
            expect((await db.query('select 1 from public.recap_snapshots where year = $1 and user_id = $2', [YEAR, USER.sub])).rows).toHaveLength(1)
            await db.query("insert into public.favorites (user_id, track_id, created_at) values ($1, 'album-one/t5', '2025-07-01 12:00:00+03')", [USER.sub])
            await play(USER.sub, '2025-07-03 12:00:00+03', 'a-0')
            expect(await recap(ADMIN, YEAR, USER.sub)).toEqual(before)
            // Цифры зафиксированы, ник — всегда нынешний.
            await db.query("update public.profiles set nick = 'Яна2' where id = $1", [USER.sub])
            const renamed = await recap(ADMIN, YEAR, USER.sub)
            expect(renamed.user.nick).toBe('Яна2')
            expect({ ...renamed, user: before.user }).toEqual(before)
            await db.query("update public.profiles set nick = 'Яна' where id = $1", [USER.sub])
            await db.query("delete from public.favorites where track_id = 'album-one/t5'")
            await db.query("delete from public.play_events where created_at = '2025-07-03 12:00:00+03'")
        })

        it('текущий год обновляется при каждом просмотре и не фиксируется', async () => {
            const y = await currentYear()
            await setPublish('show_all', [], y)
            const first = await recap(USER, y)
            expect(first.final).toBe(false)
            const base = first.plays
            await play(USER.sub, new Date().toISOString(), 'a-0')
            const second = await recap(USER, y)
            expect(second.plays).toBe(base + 1)
            expect((await db.query('select 1 from public.recap_snapshots where year = $1', [y])).rows).toHaveLength(0)
            await db.query('delete from public.play_events where created_at > $1', [`${y}-01-01`])
        })
    })

    describe('публикация и доступ', () => {
        it('пока закрыто: пользователь не видит ничего', async () => {
            expect(await state(USER)).toBeNull()
            await expect(recap(USER)).rejects.toThrow(/Недоступно/)
            await expect(recap(OWNER)).resolves.toBeTruthy() // владелец — как админ
        })

        it('открыто всем: каждый видит только свои; чужие недоступны; новые пользователи тоже видят', async () => {
            await setPublish('show_all')
            expect(await state(USER)).toEqual({ year: YEAR, years: [YEAR] })
            expect((await recap(USER)).user.id).toBe(USER.sub)
            expect((await recap(USER2)).user.id).toBe(USER2.sub)
            await expect(recap(USER, YEAR, USER2.sub)).rejects.toThrow(/Недоступно/)
            await expect(recap(USER2, YEAR, USER.sub)).rejects.toThrow(/Недоступно/)

            // Зарегистрировался позже.
            await db.exec(`
                insert into auth.users (id, email, raw_app_meta_data) values ('${NEWBIE.sub}', 'u-00000000000000000000000000000004@id.frnkness.ru', '{"role":"user"}');
                insert into public.profiles (id, nick, nick_key) values ('${NEWBIE.sub}', 'Новичок', 'новичок');
            `)
            expect(await state(NEWBIE)).toEqual({ year: YEAR, years: [YEAR] })
            expect((await recap(NEWBIE)).plays).toBe(0)
            await db.exec(`delete from public.profiles where id = '${NEWBIE.sub}'; delete from auth.users where id = '${NEWBIE.sub}';`)
        })

        it('открыто выбранным: видят только они; «скрыть выбранным» и «скрыть всем»', async () => {
            await setPublish('show_selected', [USER.sub])
            expect(await state(USER)).toMatchObject({ year: YEAR })
            expect(await state(USER2)).toBeNull()
            await expect(recap(USER2)).rejects.toThrow(/Недоступно/)
            await expect(recap(USER, YEAR, USER2.sub)).rejects.toThrow(/Недоступно/)

            await setPublish('show_selected', [USER2.sub])
            expect(await state(USER2)).toMatchObject({ year: YEAR })

            const st = await setPublish('hide_selected', [USER.sub])
            expect(st.mode).toBe('selected')
            expect(st.visible_count).toBe(1)
            expect(await state(USER)).toBeNull()
            expect(await state(USER2)).not.toBeNull()

            const off = await setPublish('hide_selected', [USER2.sub])
            expect(off.mode).toBe('off')
            await setPublish('show_selected', [USER.sub, USER2.sub])
            await setPublish('hide_all')
            expect(await state(USER)).toBeNull()
            expect(await state(USER2)).toBeNull()
        })

        it('при «всем» можно скрыть выбранных; «показать всем» снимает исключения', async () => {
            await setPublish('show_all')
            const st = await setPublish('hide_selected', [USER2.sub])
            expect(st.mode).toBe('all')
            expect(st.grants).toEqual([expect.objectContaining({ user_id: USER2.sub, granted: false })])
            expect(await state(USER2)).toBeNull()
            expect(await state(USER)).not.toBeNull()
            await expect(recap(USER2)).rejects.toThrow(/Недоступно/)
            await setPublish('show_all')
            expect(await state(USER2)).not.toBeNull()
            await setPublish('hide_selected', [USER2.sub])
            await setPublish('show_selected', [USER2.sub])
            expect(await state(USER2)).not.toBeNull()
        })

        it('статус показывает, кому открыто; список только существующих профилей', async () => {
            await setPublish('show_selected', [USER.sub, '99999999-9999-4999-8999-999999999999'])
            const st = await rpc(ADMIN, 'public.admin_recap_status($1)', [YEAR])
            expect(st).toMatchObject({ mode: 'selected', visible_count: 1 })
            expect(st.grants).toEqual([{ user_id: USER.sub, nick: 'Яна', avatar: 'initials:0', granted: true }])
        })

        it('несколько лет: сайт получает самый свежий открытый', async () => {
            const y = await currentYear()
            await setPublish('show_all', [], YEAR)
            await setPublish('show_all', [], y)
            expect(await state(USER)).toEqual({ year: y, years: y === YEAR ? [YEAR] : [y, YEAR] })
        })

        it('неверный год и действие отклоняются; выбранным — только со списком', async () => {
            const y = await currentYear()
            await expect(setPublish('show_all', [], y + 1)).rejects.toThrow(/Неверный год/)
            await expect(setPublish('show_all', [], 2000)).rejects.toThrow(/Неверный год/)
            await expect(setPublish('boom')).rejects.toThrow(/Неизвестное действие/)
            await expect(setPublish('show_selected', [])).rejects.toThrow(/Выберите/)
            await expect(rpc(ADMIN, 'public.year_recap($1)', [y + 1])).rejects.toThrow(/Недоступно/)
        })

        it('забаненный пользователь итогов не видит', async () => {
            await setPublish('show_all')
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER.sub}'`)
            expect(await state(USER)).toBeNull()
            await expect(recap(USER)).rejects.toThrow(/Недоступно/)
            await db.exec(`update auth.users set banned_until = null where id = '${USER.sub}'`)
        })
    })

    describe('права', () => {
        it('анонимы не вызывают ни одной функции', async () => {
            const calls = [
                'public.year_recap(2025)',
                'public.my_recap_state()',
                'public.admin_recap_overview(2025)',
                'public.admin_recap_status(2025)',
                "public.admin_recap_set(2025, 'show_all', '{}')",
                `public.recap_compute('${USER.sub}', 2025)`,
                `public.recap_can_view('${USER.sub}', 2025)`
            ]
            for (const c of calls) await expect(as(db, 'anon', ANON, `select ${c}`), c).rejects.toThrow(/permission denied/)
        })

        it('обычный пользователь не вызывает админские функции и внутренние помощники', async () => {
            await expect(rpc(USER, 'public.admin_recap_overview($1)', [YEAR])).rejects.toThrow(/Нет доступа/)
            await expect(rpc(USER, 'public.admin_recap_status($1)', [YEAR])).rejects.toThrow(/Нет доступа/)
            await expect(rpc(USER, "public.admin_recap_set($1, 'show_all', '{}')", [YEAR])).rejects.toThrow(/Нет доступа/)
            await expect(rpc(USER, `public.recap_compute('${USER2.sub}', 2025)`)).rejects.toThrow(/permission denied/)
            await expect(rpc(USER, `public.recap_can_view('${USER.sub}', 2025)`)).rejects.toThrow(/permission denied/)
            await expect(rpc(USER, 'public.recap_check_year(2025)')).rejects.toThrow(/permission denied/)
            // Попытка открыть итоги себе не сработала.
            expect(await state(USER)).toBeNull()
        })

        it('таблицы закрыты полностью: ни чтения, ни записи', async () => {
            for (const role of ['anon', 'authenticated'] as const) {
                const claims = role === 'anon' ? ANON : USER
                for (const t of ['recap_settings', 'recap_grants', 'recap_snapshots']) {
                    await expect(as(db, role, claims, `select * from public.${t}`), `${role} select ${t}`).rejects.toThrow(/permission denied/)
                    await expect(as(db, role, claims, `delete from public.${t}`), `${role} delete ${t}`).rejects.toThrow(/permission denied/)
                }
                await expect(as(db, role, claims, `insert into public.recap_settings (year, mode) values (2025, 'all')`)).rejects.toThrow(/permission denied/)
            }
            const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
                "select relname, relrowsecurity from pg_class where relname in ('recap_settings','recap_grants','recap_snapshots') order by 1"
            )
            expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true)
            const pol = await db.query("select 1 from pg_policies where tablename like 'recap_%'")
            expect(pol.rows).toHaveLength(0)
        })

        it('все функции — security definer с пустым search_path', async () => {
            const { rows } = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
                "select proname, prosecdef, proconfig from pg_proc where proname like '%recap%' and pronamespace = 'public'::regnamespace"
            )
            expect(rows.length).toBeGreaterThanOrEqual(8)
            for (const f of rows) {
                expect(f.proconfig?.join(','), f.proname).toMatch(/search_path=""/)
                if (f.proname !== 'recap_check_year') expect(f.prosecdef, f.proname).toBe(true)
            }
        })

        it('общие цифры: только прослушивания с аккаунтом (у Яны и до регистрации)', async () => {
            const o = await rpc(ADMIN, 'public.admin_recap_overview($1)', [YEAR])
            expect(o).toMatchObject({ year: YEAR, users_listening: 2, plays: 16, favorites_added: 3, rooms: 2 })
            expect(o.top_tracks[0]).toMatchObject({ track_key: 'a-0', plays: 4 })
        })
    })
})
