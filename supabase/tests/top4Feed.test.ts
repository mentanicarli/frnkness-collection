// @vitest-environment node
/**
 * Права и приватность топ-4, ленты и реакций на настоящем Postgres
 * (PGlite): топ-4 пишет только хозяин и только через RPC, видят все вошедшие;
 * лента показывает события ТОЛЬКО принятых друзей за 7 дней, не отдаёт
 * название и id комнаты не приглашённым, прячет прослушивания по
 * переключателю и не теряет события на границах страниц; политики Realtime
 * для реакций пускают только участников текущей эпохи.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { ADMIN, ANON, OWNER, USER, USER2, applyMigrations, as, createDb } from './pgHarness'

const STRANGER = { role: 'authenticated', sub: '00000000-0000-4000-8000-000000000003', app_metadata: { role: 'user' } }
const TECH = (n: number) => `u-${String(n).padStart(32, '0')}@id.frnkness.ru`
const T1 = 'album-one/first-track'
const T2 = 'album-one/second-track'
const T3 = 'single/third'
const T4 = 'single/fourth'
const T5 = 'single/fifth'

describe('топ-4, лента, реакции: права и приватность', () => {
    let db: PGlite
    const one = async (sql: string, params?: unknown[]) => (await db.query<any>(sql, params)).rows[0]
    const rpc = async (claims: object, sql: string, params?: unknown[]) => (await as(db, 'authenticated', claims, `select ${sql} as r`, params)).rows[0].r
    const befriend = async (a: { sub: string }, b: { sub: string }) => {
        await rpc(a, 'public.friend_request($1)', [b.sub])
        await rpc(b, 'public.friend_respond($1, true)', [a.sub])
    }
    const unfriend = (a: { sub: string }, b: { sub: string }) => rpc(a, 'public.friend_remove($1)', [b.sub])
    const feed = async (claims: object, limit = 40, before: { at: string; key: string } | null = null) =>
        rpc(claims, 'public.friends_feed($1, $2, $3)', [before?.at ?? null, before?.key ?? null, limit]) as Promise<{ events: any[]; has_more: boolean }>
    const kinds = (events: any[]) => events.map((e) => e.kind)
    const clean = async () => {
        await db.exec(`
            delete from public.play_events; delete from public.favorites; delete from public.playlist_tracks; delete from public.playlists;
            delete from public.profile_top4; delete from public.profile_top4_saves; delete from public.feed_prefs;
            delete from public.room_members; delete from public.room_invites; delete from public.room_kicks; delete from public.rooms;
            delete from public.room_visits;
            delete from public.friendships; delete from public.rate_limits;
            update auth.users set banned_until = null, deleted_at = null;
        `)
    }

    beforeAll(async () => {
        db = await createDb()
        await applyMigrations(db)
        await applyMigrations(db) // повторный прогон не падает
        await db.exec(`
            insert into auth.users (id, email, raw_app_meta_data) values ('${STRANGER.sub}', '${TECH(999)}', '{"role":"user"}');
            insert into public.profiles (id, nick, nick_key) values
                ('${OWNER.sub}', 'frnkness', 'frnkness'),
                ('${ADMIN.sub}', 'Друг', 'друг'),
                ('${USER.sub}', 'Яна', 'яна'),
                ('${USER2.sub}', 'Второй', 'второи'),
                ('${STRANGER.sub}', 'Чужой', 'чужои');
        `)
    }, 120_000)

    afterEach(clean)

    describe('топ-4: хранение и права', () => {
        it('хозяин задаёт до четырёх треков; порядок — как в массиве; замена целиком', async () => {
            const saved = await rpc(USER, 'public.top4_set($1)', [[T3, T1, T2]])
            expect(saved).toEqual([
                { position: 1, track_id: T3 },
                { position: 2, track_id: T1 },
                { position: 3, track_id: T2 }
            ])
            expect(await rpc(USER, 'public.top4_set($1)', [[T2, T3, T4, T5]])).toHaveLength(4)
            expect((await rpc(USER, 'public.user_top4($1)', [USER.sub])).map((r: any) => r.track_id)).toEqual([T2, T3, T4, T5])
            // Перестановка — тот же набор, другой порядок.
            await rpc(USER, 'public.top4_set($1)', [[T5, T4, T3, T2]])
            expect((await rpc(USER, 'public.user_top4($1)', [USER.sub])).map((r: any) => r.track_id)).toEqual([T5, T4, T3, T2])
            // Можно меньше четырёх и можно ничего.
            await rpc(USER, 'public.top4_set($1)', [[T1]])
            expect(await rpc(USER, 'public.user_top4($1)', [USER.sub])).toHaveLength(1)
            expect(await rpc(USER, 'public.top4_set($1)', [[]])).toEqual([])
            expect(await rpc(USER, 'public.user_top4($1)', [USER.sub])).toEqual([])
        })

        it('больше четырёх, повторы, кривой id и null — ошибка, старый топ остаётся', async () => {
            await rpc(USER, 'public.top4_set($1)', [[T1, T2]])
            await expect(rpc(USER, 'public.top4_set($1)', [[T1, T2, T3, T4, T5]])).rejects.toThrow(/не больше четырёх/)
            await expect(rpc(USER, 'public.top4_set($1)', [[T1, T1]])).rejects.toThrow(/дважды/)
            await expect(rpc(USER, 'public.top4_set($1)', [['Not A Track']])).rejects.toThrow(/распознать/)
            await expect(rpc(USER, 'public.top4_set($1)', [['a/b; drop table x']])).rejects.toThrow(/распознать/)
            await expect(rpc(USER, 'public.top4_set($1)', [['x'.repeat(161) + '/y']])).rejects.toThrow(/распознать/)
            await expect(rpc(USER, 'public.top4_set($1)', [[T1, null]])).rejects.toThrow(/распознать/)
            expect((await rpc(USER, 'public.user_top4($1)', [USER.sub])).map((r: any) => r.track_id)).toEqual([T1, T2])
            // null вместо массива — то же, что пустой список.
            expect(await rpc(USER, 'public.top4_set($1)', [null])).toEqual([])
        })

        it('видят все вошедшие, не только друзья; аноним и забаненный — нет', async () => {
            await rpc(USER, 'public.top4_set($1)', [[T1, T2]])
            for (const viewer of [STRANGER, USER2, ADMIN, OWNER]) {
                expect((await rpc(viewer, 'public.user_top4($1)', [USER.sub])).map((r: any) => r.track_id), JSON.stringify(viewer.sub)).toEqual([T1, T2])
            }
            await expect(as(db, 'anon', ANON, 'select public.user_top4($1)', [USER.sub])).rejects.toThrow(/permission denied/)
            await expect(as(db, 'anon', ANON, 'select public.top4_set($1)', [[T1]])).rejects.toThrow(/permission denied/)
            // Забаненный не видит чужое.
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${STRANGER.sub}'`)
            await expect(rpc(STRANGER, 'public.user_top4($1)', [USER.sub])).rejects.toThrow(/Нужно войти/)
            await expect(rpc(STRANGER, 'public.top4_set($1)', [[T1]])).rejects.toThrow(/Нужно войти/)
            // А топ забаненного другим не показываем.
            await db.exec(`update auth.users set banned_until = null where id = '${STRANGER.sub}'; update auth.users set banned_until = now() + interval '1 day' where id = '${USER.sub}'`)
            expect(await rpc(USER2, 'public.user_top4($1)', [USER.sub])).toEqual([])
        })

        it('писать можно только свой топ; чужой не меняется', async () => {
            await rpc(USER2, 'public.top4_set($1)', [[T3]])
            await rpc(USER, 'public.top4_set($1)', [[T1]])
            expect((await rpc(USER2, 'public.user_top4($1)', [USER2.sub])).map((r: any) => r.track_id)).toEqual([T3])
            // Через функцию чужой user_id передать негде.
            const sig = await one(`select pg_get_function_identity_arguments('public.top4_set(text[])'::regprocedure) as a`)
            expect(sig.a).toBe('p_track_ids text[]')
        })

        it('прямого доступа к таблицам нет: ни чтения, ни записи, ни у anon', async () => {
            await rpc(USER, 'public.top4_set($1)', [[T1]])
            for (const t of ['profile_top4', 'profile_top4_saves', 'feed_prefs']) {
                await expect(as(db, 'authenticated', USER, `select * from public.${t}`)).rejects.toThrow(/permission denied/)
                await expect(as(db, 'authenticated', STRANGER, `select * from public.${t}`)).rejects.toThrow(/permission denied/)
                await expect(as(db, 'anon', ANON, `select * from public.${t}`)).rejects.toThrow(/permission denied/)
                await expect(as(db, 'authenticated', USER, `delete from public.${t}`)).rejects.toThrow(/permission denied/)
            }
            await expect(as(db, 'authenticated', USER, `insert into public.profile_top4 (user_id, position, track_id) values ('${USER.sub}', 2, '${T2}')`)).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, `update public.profile_top4 set track_id = '${T2}'`)).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, `insert into public.feed_prefs (user_id, hide_listens) values ('${USER.sub}', true)`)).rejects.toThrow(/permission denied/)
        })

        it('таблица сама держит инварианты: места 1–4, один трек — одно место', async () => {
            await expect(db.exec(`insert into public.profile_top4 values ('${USER.sub}', 5, '${T1}')`)).rejects.toThrow(/check/)
            await expect(db.exec(`insert into public.profile_top4 values ('${USER.sub}', 0, '${T1}')`)).rejects.toThrow(/check/)
            await db.exec(`insert into public.profile_top4 values ('${USER.sub}', 1, '${T1}')`)
            await expect(db.exec(`insert into public.profile_top4 values ('${USER.sub}', 2, '${T1}')`)).rejects.toThrow(/unique/)
            await expect(db.exec(`insert into public.profile_top4 values ('${USER.sub}', 1, '${T2}')`)).rejects.toThrow(/duplicate|unique/)
            await expect(db.exec(`insert into public.profile_top4 values ('${USER.sub}', 2, 'bad id')`)).rejects.toThrow(/check/)
        })

        it('не больше 60 сохранений в час', async () => {
            const lists = [[T1], [T2]]
            for (let i = 0; i < 60; i++) await rpc(USER, 'public.top4_set($1)', [lists[i % 2]])
            await expect(rpc(USER, 'public.top4_set($1)', [lists[0]])).rejects.toThrow(/Слишком часто/)
            // Повтор того же самого — не сохранение, лимит не тратит.
            expect(await rpc(USER, 'public.top4_set($1)', [lists[59 % 2]])).toHaveLength(1)
        })

        it('удаление аккаунта убирает топ', async () => {
            await rpc(STRANGER, 'public.top4_set($1)', [[T1]])
            await db.exec(`delete from auth.users where id = '${STRANGER.sub}'`)
            expect(Number((await one('select count(*)::int n from public.profile_top4')).n)).toBe(0)
            expect(Number((await one('select count(*)::int n from public.profile_top4_saves')).n)).toBe(0)
            await db.exec(`
                insert into auth.users (id, email, raw_app_meta_data) values ('${STRANGER.sub}', '${TECH(999)}', '{"role":"user"}');
                insert into public.profiles (id, nick, nick_key) values ('${STRANGER.sub}', 'Чужой', 'чужои');
            `)
        })

        it('админ видит топ-4 в карточке пользователя; обычный пользователь — нет', async () => {
            await rpc(USER, 'public.top4_set($1)', [[T2, T1]])
            const card = await rpc(ADMIN, 'public.admin_user_social($1)', [USER.sub])
            expect(card.top4.map((r: any) => r.track_id)).toEqual([T2, T1])
            expect(card).toHaveProperty('favorites')
            expect(card).toHaveProperty('playlists')
            expect(card).toHaveProperty('friends')
            await expect(rpc(USER2, 'public.admin_user_social($1)', [USER.sub])).rejects.toThrow(/Нет доступа/)
        })
    })

    describe('настройки ленты', () => {
        it('по умолчанию прослушивания показываются; переключатель хранится у хозяина', async () => {
            expect(await rpc(USER, 'public.feed_prefs_get()')).toEqual({ hide_listens: false })
            expect(await rpc(USER, 'public.feed_prefs_set($1)', [true])).toEqual({ hide_listens: true })
            expect(await rpc(USER, 'public.feed_prefs_get()')).toEqual({ hide_listens: true })
            expect(await rpc(USER2, 'public.feed_prefs_get()')).toEqual({ hide_listens: false })
            expect(await rpc(USER, 'public.feed_prefs_set($1)', [false])).toEqual({ hide_listens: false })
            await expect(rpc(USER, 'public.feed_prefs_set($1)', [null])).rejects.toThrow(/сохранить/)
            await expect(as(db, 'anon', ANON, 'select public.feed_prefs_get()')).rejects.toThrow(/permission denied/)
            await expect(as(db, 'anon', ANON, 'select public.feed_prefs_set(true)')).rejects.toThrow(/permission denied/)
        })
    })

    describe('лента друзей', () => {
        const listen = (user: { sub: string }, key: string, ago = "interval '1 minute'") =>
            db.exec(`insert into public.play_events (track_key, user_id, created_at) values ('${key}', '${user.sub}', now() - ${ago})`)

        it('только принятые друзья: чужие, неотвеченные заявки и сам я — нет', async () => {
            await befriend(USER, USER2)
            await rpc(USER, 'public.friend_request($1)', [ADMIN.sub]) // ещё не принята
            await listen(USER2, 'album-one-0')
            await listen(ADMIN, 'album-one-1')
            await listen(STRANGER, 'album-one-0')
            await listen(USER, 'album-one-0')
            const f = await feed(USER)
            expect(f.events.map((e) => e.user.nick)).toEqual(['Второй'])
            expect(f.has_more).toBe(false)
            // У не-друга лента пустая: чужих данных по функции не получить.
            expect((await feed(STRANGER)).events).toEqual([])
            expect((await feed(OWNER)).events).toEqual([])
            // Друг видит мои прослушивания, но не прослушивания моих друзей.
            expect((await feed(USER2)).events.map((e) => e.user.nick)).toEqual(['Яна'])
            // Заявку приняли — друг появился в ленте.
            await rpc(ADMIN, 'public.friend_respond($1, true)', [USER.sub])
            expect((await feed(USER)).events.map((e) => e.user.nick).sort()).toEqual(['Второй', 'Друг'])
            // Удалили из друзей — события пропали сразу.
            await unfriend(USER, ADMIN)
            expect((await feed(USER)).events.map((e) => e.user.nick)).toEqual(['Второй'])
        })

        it('все виды событий, от новых к старым; окно — 7 дней', async () => {
            await befriend(USER, USER2)
            await db.exec(`
                insert into public.play_events (track_key, user_id, created_at) values
                    ('album-one-0', '${USER2.sub}', now() - interval '10 minutes'),
                    ('album-one-1', '${USER2.sub}', now() - interval '8 days');
            `)
            await rpc(USER2, 'public.favorite_set($1, true)', [T1])
            await db.exec(`update public.favorites set created_at = now() - interval '5 minutes'`)
            await rpc(USER2, 'public.favorite_set($1, true)', [T2])
            await db.exec(`update public.favorites set created_at = now() - interval '9 days' where track_id = '${T2}'`)
            const pub = await rpc(USER2, 'public.playlist_create($1, $2, $3)', ['Открытый', '', true])
            await rpc(USER2, 'public.playlist_create($1, $2, $3)', ['Скрытый', '', false])
            await db.exec(`update public.playlists set created_at = now() - interval '3 minutes' where id = '${pub.id}'`)
            await rpc(USER2, 'public.top4_set($1)', [[T3, T1]])
            await db.exec(`update public.profile_top4_saves set saved_at = now() - interval '1 minute'`)

            const f = await feed(USER)
            expect(kinds(f.events)).toEqual(['top4', 'playlist', 'favorite', 'listen'])
            const [top4, playlist, favorite, listenEvent] = f.events
            expect(top4.track_ids).toEqual([T3, T1])
            expect(playlist.playlist).toEqual({ id: pub.id, title: 'Открытый' })
            expect(favorite.track_id).toBe(T1)
            expect(listenEvent.track_key).toBe('album-one-0')
            expect(f.events.every((e) => e.user.id === USER2.sub && typeof e.user.nick === 'string')).toBe(true)
            const times = f.events.map((e) => Date.parse(e.at))
            expect([...times].sort((a, b) => b - a)).toEqual(times)
            // Приватный плейлист в ленту не попадает совсем.
            expect(JSON.stringify(f)).not.toContain('Скрытый')
        })

        it('обновление топ-4 — одно событие на одно сохранение', async () => {
            await befriend(USER, USER2)
            await rpc(USER2, 'public.top4_set($1)', [[T1, T2, T3, T4]])
            expect(kinds((await feed(USER)).events)).toEqual(['top4'])
            // Тот же список ничего не добавляет и время не двигает.
            const before = (await feed(USER)).events[0].at
            await rpc(USER2, 'public.top4_set($1)', [[T1, T2, T3, T4]])
            expect((await feed(USER)).events[0].at).toBe(before)
            // Перестановка — новое сохранение, но всё равно ровно одно событие.
            await rpc(USER2, 'public.top4_set($1)', [[T4, T3, T2, T1]])
            const after = (await feed(USER)).events
            expect(kinds(after)).toEqual(['top4'])
            expect(after[0].track_ids).toEqual([T4, T3, T2, T1])
            // Очистили топ — события нет.
            await rpc(USER2, 'public.top4_set($1)', [[]])
            expect((await feed(USER)).events).toEqual([])
        })

        it('«Не показывать мои прослушивания» скрывает только прослушивания', async () => {
            await befriend(USER, USER2)
            await befriend(USER, ADMIN)
            await listen(USER2, 'album-one-0')
            await listen(ADMIN, 'album-one-1')
            await rpc(USER2, 'public.favorite_set($1, true)', [T1])
            await rpc(USER2, 'public.top4_set($1)', [[T1]])
            await rpc(USER2, 'public.feed_prefs_set($1)', [true])
            const f = await feed(USER)
            expect(f.events.filter((e) => e.user.id === USER2.sub).map((e) => e.kind).sort()).toEqual(['favorite', 'top4'])
            expect(f.events.filter((e) => e.user.id === ADMIN.sub).map((e) => e.kind)).toEqual(['listen'])
            // Выключил — прослушивания вернулись (в том числе прошлые).
            await rpc(USER2, 'public.feed_prefs_set($1)', [false])
            expect((await feed(USER)).events.filter((e) => e.kind === 'listen')).toHaveLength(2)
        })

        it('забаненный и удалённый друг пропадают из ленты', async () => {
            await befriend(USER, USER2)
            await listen(USER2, 'album-one-0')
            await rpc(USER2, 'public.favorite_set($1, true)', [T1])
            expect((await feed(USER)).events.length).toBe(2)
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER2.sub}'`)
            expect((await feed(USER)).events).toEqual([])
            await db.exec(`update auth.users set banned_until = null where id = '${USER2.sub}'`)
            expect((await feed(USER)).events.length).toBe(2)
        })

        it('забаненный не читает ленту; аноним — тоже', async () => {
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER.sub}'`)
            await expect(feed(USER)).rejects.toThrow(/Нужно войти/)
            await expect(as(db, 'anon', ANON, 'select public.friends_feed(null, null, 10)')).rejects.toThrow(/permission denied/)
        })

        it('страницы по курсору не теряют и не дублируют события, даже с одинаковым временем', async () => {
            await befriend(USER, USER2)
            await befriend(USER, ADMIN)
            // 12 прослушиваний с ОДНИМ временем + избранное/плейлисты вперемешку.
            for (let i = 0; i < 7; i++) await listen(USER2, `album-one-${i}`, "interval '2 minutes'")
            for (let i = 0; i < 5; i++) await listen(ADMIN, `album-one-${i}`, "interval '2 minutes'")
            await db.exec(`update public.play_events set created_at = date_trunc('second', now()) - interval '2 minutes'`)
            await rpc(USER2, 'public.favorite_set($1, true)', [T1])
            await rpc(ADMIN, 'public.favorite_set($1, true)', [T2])
            await db.exec(`update public.favorites set created_at = date_trunc('second', now()) - interval '2 minutes'`)
            await rpc(USER2, 'public.playlist_create($1, $2, $3)', ['Одна', '', true])
            await rpc(ADMIN, 'public.playlist_create($1, $2, $3)', ['Две', '', true])
            const total = 7 + 5 + 2 + 2

            const all = (await feed(USER, 50)).events
            expect(all).toHaveLength(total)
            for (const size of [1, 2, 3, 5, 50]) {
                const seen: string[] = []
                let cursor: { at: string; key: string } | null = null
                for (let guard = 0; guard < 40; guard++) {
                    const page: { events: any[]; has_more: boolean } = await feed(USER, size, cursor)
                    expect(page.events.length).toBeLessThanOrEqual(size)
                    seen.push(...page.events.map((e) => e.key))
                    if (!page.has_more) break
                    const last = page.events[page.events.length - 1]
                    cursor = { at: last.at, key: last.key }
                }
                expect(seen, `размер страницы ${size}`).toEqual(all.map((e) => e.key))
            }
        })

        it('p_limit ограничен 1…50; курсор только целиком', async () => {
            await befriend(USER, USER2)
            for (let i = 0; i < 60; i++) await listen(USER2, 'album-one-0', `interval '${i + 1} seconds'`)
            expect((await feed(USER, 1000)).events).toHaveLength(50)
            expect((await feed(USER, 1000)).has_more).toBe(true)
            expect((await feed(USER, 0)).events).toHaveLength(1)
            expect(((await rpc(USER, 'public.friends_feed(null, null, null)')) as any).events).toHaveLength(40)
            await expect(rpc(USER, 'public.friends_feed($1, null, 10)', ['2026-01-01T00:00:00Z'])).rejects.toThrow(/загрузить ленту/)
            await expect(rpc(USER, 'public.friends_feed(null, $1, 10)', ['listen:1'])).rejects.toThrow(/загрузить ленту/)
            await expect(rpc(USER, 'public.friends_feed(null, $1, 10)', ['x'.repeat(200)])).rejects.toThrow(/загрузить ленту/)
        })

        describe('комнаты в ленте', () => {
            const mkRoom = async (owner: { sub: string }, title = 'Секретная вечеринка') => (await rpc(owner, 'public.room_create($1)', [title])).id as string

            it('все друзья видят «в комнате», но название и id — только приглашённые и участники', async () => {
                await befriend(USER, USER2)
                await befriend(ADMIN, USER2)
                await befriend(USER, ADMIN)
                const id = await mkRoom(USER2)

                // Яна не приглашена.
                const seen = (await feed(USER)).events.find((e) => e.kind === 'room')
                expect(seen).toBeTruthy()
                expect(seen.user.nick).toBe('Второй')
                expect(seen.can_join).toBe(false)
                expect(seen.room).toBeUndefined()
                const raw = JSON.stringify(await feed(USER))
                expect(raw).not.toContain('Секретная вечеринка')
                expect(raw).not.toContain(id)

                // Пригласили Яну: теперь есть название и id, у Друга — по-прежнему нет.
                await rpc(USER2, 'public.room_invite($1, $2)', [id, USER.sub])
                const invited = (await feed(USER)).events.find((e) => e.kind === 'room')
                expect(invited.can_join).toBe(true)
                expect(invited.room).toEqual({ id, title: 'Секретная вечеринка' })
                const other = (await feed(ADMIN)).events.find((e) => e.kind === 'room')
                expect(other.can_join).toBe(false)
                expect(JSON.stringify(other)).not.toContain(id)

                // Кто сам в комнате, видит её у другого участника.
                await rpc(USER, 'public.room_join($1)', [id])
                const asMember = (await feed(ADMIN)).events.filter((e) => e.kind === 'room').map((e) => e.user.nick).sort()
                expect(asMember).toEqual(['Второй', 'Яна'])
                expect((await feed(ADMIN)).events.every((e) => e.kind !== 'room' || e.can_join === false)).toBe(true)
                // Участник комнаты (Яна) видит Второго с названием: она там сама.
                const mine = (await feed(ADMIN)).events.length
                expect(mine).toBeGreaterThan(0)
                const yanaView = (await rpc(USER, 'public.friends_feed(null, null, 40)')) as any
                expect(yanaView.events.find((e: any) => e.kind === 'room' && e.user.nick === 'Второй').room.id).toBe(id)
            })

            it('не друг комнату не видит; закрытая и протухшая комнаты уходят из ленты', async () => {
                await befriend(USER, USER2)
                const id = await mkRoom(USER2)
                expect((await feed(STRANGER)).events).toEqual([])
                expect(kinds((await feed(USER)).events)).toEqual(['room'])
                // Приглашение есть, но комната закрыта: ни события, ни названия.
                await rpc(USER2, 'public.room_invite($1, $2)', [id, USER.sub])
                await db.exec(`update public.room_members set last_seen = now() - interval '11 minutes'; update public.rooms set owner_seen_at = now() - interval '11 minutes'`)
                expect((await feed(USER)).events).toEqual([])
                await db.exec(`update public.room_members set last_seen = now(); update public.rooms set owner_seen_at = now()`)
                expect(kinds((await feed(USER)).events)).toEqual(['room'])
                await rpc(USER2, 'public.room_close($1)', [id])
                expect((await feed(USER)).events).toEqual([])
            })

            it('просроченное приглашение (старше 6 часов) названия не открывает', async () => {
                await befriend(USER, USER2)
                const id = await mkRoom(USER2)
                await rpc(USER2, 'public.room_invite($1, $2)', [id, USER.sub])
                await db.exec(`update public.room_invites set created_at = now() - interval '7 hours'`)
                const e = (await feed(USER)).events.find((x) => x.kind === 'room')
                expect(e.can_join).toBe(false)
                expect(JSON.stringify(e)).not.toContain(id)
            })
        })
    })

    describe('реакции в комнатах: политики Realtime', () => {
        const topic = (id: string, epoch = 0) => `roomfx:${id}:${epoch}`
        const command = (id: string, epoch = 0) => `room:${id}:${epoch}`
        const setTopic = (t: string) => db.query('select set_config($1, $2, false)', ['realtime.topic', t])
        const canListen = async (claims: object, t: string, role = 'authenticated') => {
            await setTopic(t)
            try {
                return Number((await as(db, role, claims, 'select count(*)::int n from realtime.messages')).rows[0].n) > 0
            } catch (e) {
                if (/permission denied/.test((e as Error).message)) return false
                throw e
            }
        }
        const canSend = async (claims: object, t: string, extension = 'broadcast') => {
            await setTopic(t)
            try {
                await as(db, 'authenticated', claims, 'insert into realtime.messages (topic, extension, payload) values ($1, $2, $3)', [t, extension, '{}'])
                return true
            } catch (e) {
                if (/row-level security/.test((e as Error).message)) return false
                throw e
            }
        }
        const mkRoom = async (owner: { sub: string }) => (await rpc(owner, 'public.room_create($1)', ['Реакции'])).id as string
        beforeAll(async () => {
            await db.exec(`insert into realtime.messages (topic, extension, payload) values ('x', 'broadcast', '{}')`)
        })

        it('любой участник шлёт и слушает реакции, не только хозяин', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            for (const who of [USER, USER2]) {
                expect(await canSend(who, topic(id)), who.sub).toBe(true)
                expect(await canListen(who, topic(id)), who.sub).toBe(true)
            }
        })

        it('посторонний, админ без комнаты, аноним и не вошедший — нет', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            for (const who of [STRANGER, ADMIN, OWNER]) {
                expect(await canSend(who, topic(id)), who.sub).toBe(false)
                expect(await canListen(who, topic(id)), who.sub).toBe(false)
            }
            expect(await canListen(ANON, topic(id), 'anon')).toBe(false)
        })

        it('команды плеера по-прежнему только у хозяина: участник не пишет в топик room:', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            expect(await canSend(USER, command(id))).toBe(true)
            expect(await canSend(USER2, command(id))).toBe(false)
            // Реакции не открывают ни presence, ни другие виды сообщений.
            expect(await canSend(USER2, topic(id), 'presence')).toBe(false)
            expect(await canSend(USER2, topic(id), 'postgres_changes')).toBe(false)
            // А топик команд не слушается политикой реакций и наоборот: у каждого свой набор правил.
            expect(await canSend(USER2, command(id), 'broadcast')).toBe(false)
        })

        it('выгнанный теряет реакции сразу; старой эпохи для реакций нет ни у кого', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await rpc(STRANGER, 'public.room_join($1)', [id])
            await rpc(USER, 'public.room_kick($1, $2)', [id, STRANGER.sub])
            expect(await canSend(STRANGER, topic(id, 0))).toBe(false)
            expect(await canSend(STRANGER, topic(id, 1))).toBe(false)
            expect(await canListen(STRANGER, topic(id, 1))).toBe(false)
            expect(await canSend(USER2, topic(id, 1))).toBe(true)
            expect(await canListen(USER2, topic(id, 1))).toBe(true)
            // Старая эпоха закрыта даже для хозяина (в отличие от команд).
            expect(await canSend(USER, topic(id, 0))).toBe(false)
            expect(await canListen(USER2, topic(id, 0))).toBe(false)
        })

        it('закрытая комната, бан, чужой uuid и кривые топики — отказ', async () => {
            const id = await mkRoom(USER)
            const other = await mkRoom(USER2)
            expect(await canListen(USER, topic(other))).toBe(false)
            expect(await canSend(USER, topic(other))).toBe(false)
            for (const bad of ['', `roomfx:${id}`, `roomfx:${id}:x`, `roomfx:${id}:0:1`, `Roomfx:${id}:0`, `roomfx:${id.toUpperCase()}:0`, `roomfx:${id}:99999999999`, 'roomfx:not-a-uuid:0', `realtime:roomfx:${id}:0`, `room-fx:${id}:0`]) {
                expect(await canListen(USER, bad), bad).toBe(false)
                expect(await canSend(USER, bad), bad).toBe(false)
            }
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER2.sub}'`)
            expect(await canSend(USER2, topic(other))).toBe(false)
            expect(await canListen(USER2, topic(other))).toBe(false)
            // Бан закрывает комнату хозяина: после снятия бана доступа к ней нет.
            await db.exec(`update auth.users set banned_until = null where id = '${USER2.sub}'`)
            expect(await canSend(USER2, topic(other))).toBe(false)
            await rpc(USER, 'public.room_close($1)', [id])
            expect(await canSend(USER, topic(id))).toBe(false)
            expect(await canListen(USER, topic(id))).toBe(false)
        })
    })

    describe('журнал комнат (room_visits)', () => {
        const mk = async (owner: { sub: string }, title = 'Журнал') => (await rpc(owner, 'public.room_create($1)', [title])).id as string
        const visits = async (where = 'true') =>
            (await db.query<any>(`select user_id, room_id, role, joined_at, left_at from public.room_visits where ${where} order by id`)).rows
        const open = async (userId: string) => visits(`user_id = '${userId}' and left_at is null`)

        it('вход пишет строку: хозяин и гость; выход закрывает её', async () => {
            const id = await mk(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            expect((await visits()).map((v) => [v.user_id, v.role, v.left_at])).toEqual([
                [USER.sub, 'owner', null],
                [USER2.sub, 'guest', null]
            ])
            expect(new Date((await visits())[1].joined_at).getTime()).toBeGreaterThan(0)
            await rpc(USER2, 'public.room_leave()')
            const rows = await visits()
            expect(rows[1].left_at).not.toBeNull()
            expect(rows[0].left_at).toBeNull()
            expect(rows.every((v) => v.room_id === id)).toBe(true)
            // Запись участника из room_members исчезла, а история осталась.
            expect(Number((await one('select count(*)::int n from public.room_members where user_id = $1', [USER2.sub])).n)).toBe(0)
            expect(await visits(`user_id = '${USER2.sub}'`)).toHaveLength(1)
        })

        it('исключение, закрытие комнаты, бан и простой тоже закрывают пребывание', async () => {
            // Кик.
            let id = await mk(USER)
            await rpc(STRANGER, 'public.room_join($1)', [id])
            await rpc(USER, 'public.room_kick($1, $2)', [id, STRANGER.sub])
            expect(await open(STRANGER.sub)).toEqual([])
            expect((await visits(`user_id = '${STRANGER.sub}'`))[0].left_at).not.toBeNull()
            // Закрытие комнаты хозяином закрывает всех.
            await rpc(USER2, 'public.room_join($1)', [id])
            await rpc(USER, 'public.room_close($1)', [id])
            expect(await visits(`room_id = '${id}' and left_at is null`)).toEqual([])
            // Бан гостя.
            id = await mk(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER2.sub}'`)
            expect(await open(USER2.sub)).toEqual([])
            // Бан хозяина закрывает комнату и пребывания всех её участников.
            await db.exec(`update auth.users set banned_until = null where id = '${USER2.sub}'; update auth.users set banned_until = now() + interval '1 day' where id = '${USER.sub}'`)
            expect(await visits(`room_id = '${id}' and left_at is null`)).toEqual([])
            await db.exec(`update auth.users set banned_until = null`)
            // Простой: гость пропал на 10+ минут, уборка при обращении к комнатам.
            id = await mk(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await db.exec(`update public.room_members set last_seen = now() - interval '11 minutes' where user_id = '${USER2.sub}'`)
            await rpc(USER, 'public.room_get($1)', [id])
            expect(await open(USER2.sub)).toEqual([])
            expect(await open(USER.sub)).toHaveLength(1)
            // Комната простояла пустой 30 минут и закрылась сама.
            await db.exec(`update public.rooms set last_activity = now() - interval '31 minutes' where id = '${id}'`)
            await rpc(USER2, 'public.room_my()')
            expect(await visits(`room_id = '${id}' and left_at is null`)).toEqual([])
        })

        it('переход в другую комнату закрывает прошлую строку и открывает новую; повторный вход — новая строка', async () => {
            const a = await mk(USER)
            const b = await mk(USER2)
            await rpc(STRANGER, 'public.room_join($1)', [a])
            await rpc(STRANGER, 'public.room_join($1)', [b])
            const rows = await visits(`user_id = '${STRANGER.sub}'`)
            expect(rows.map((v) => [v.room_id, v.role, v.left_at === null])).toEqual([
                [a, 'guest', false],
                [b, 'guest', true]
            ])
            await rpc(STRANGER, 'public.room_leave()')
            await rpc(STRANGER, 'public.room_join($1)', [b])
            expect((await visits(`user_id = '${STRANGER.sub}'`)).map((v) => v.left_at === null)).toEqual([false, false, true])
        })

        it('при удалении аккаунта журнал обезличивается: user_id = null, строка и время остаются', async () => {
            // Одноразовые аккаунты: фикстурных не трогаем.
            const guest = { role: 'authenticated', sub: '00000000-0000-4000-8000-000000000e01', app_metadata: { role: 'user' } }
            const host = { role: 'authenticated', sub: '00000000-0000-4000-8000-000000000e02', app_metadata: { role: 'user' } }
            await db.exec(`
                insert into auth.users (id, email, raw_app_meta_data) values
                    ('${guest.sub}', '${TECH(901)}', '{"role":"user"}'),
                    ('${host.sub}', '${TECH(902)}', '{"role":"user"}');
                insert into public.profiles (id, nick, nick_key) values ('${guest.sub}', 'Гость901', 'гость901'), ('${host.sub}', 'Хозяин902', 'хозяин902');
            `)
            const id = await mk(USER)
            await rpc(guest, 'public.room_join($1)', [id])
            await db.exec(`delete from auth.users where id = '${guest.sub}'`)
            const rows = await visits(`room_id = '${id}'`)
            expect(rows).toHaveLength(2)
            const gone = rows.find((v) => v.user_id === null)!
            expect(gone.role).toBe('guest')
            expect(gone.left_at).not.toBeNull()
            expect(rows.find((v) => v.user_id === USER.sub)!.left_at).toBeNull()
            // Тот же случай для хозяина: комната исчезает вместе с ним, история остаётся без имени.
            const b = await mk(host)
            await db.exec(`delete from auth.users where id = '${host.sub}'`)
            const owner = (await visits(`room_id = '${b}'`))[0]
            expect(owner.user_id).toBeNull()
            expect(owner.role).toBe('owner')
            expect(owner.left_at).not.toBeNull()
            expect(Number((await one('select count(*)::int n from public.rooms where id = $1', [b])).n)).toBe(0)
            expect(JSON.stringify(await visits())).not.toContain(guest.sub)
            expect(JSON.stringify(await visits())).not.toContain(host.sub)
        })

        it('журнал закрыт: ни чтения, ни записи — ни у пользователей, ни у anon, ни через RPC', async () => {
            const id = await mk(USER)
            expect(await visits(`room_id = '${id}'`)).toHaveLength(1)
            for (const [role, claims] of [['authenticated', USER], ['authenticated', ADMIN], ['authenticated', OWNER], ['anon', ANON]] as const) {
                await expect(as(db, role, claims, 'select * from public.room_visits'), `${role} select`).rejects.toThrow(/permission denied/)
                await expect(as(db, role, claims, `insert into public.room_visits (room_id, role) values ('${id}', 'guest')`)).rejects.toThrow(/permission denied/)
                await expect(as(db, role, claims, `update public.room_visits set left_at = now()`)).rejects.toThrow(/permission denied/)
                await expect(as(db, role, claims, `delete from public.room_visits`)).rejects.toThrow(/permission denied/)
            }
            // Функции-триггеры из API не вызвать.
            await expect(as(db, 'authenticated', USER, 'select public.room_visits_on_join()')).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, 'select public.room_visits_on_leave()')).rejects.toThrow(/permission denied/)
            // Нет ни политик, ни публикации в rpc: журнал не светится в ответах комнат и админки.
            expect(JSON.stringify(await rpc(USER, 'public.room_get($1)', [id]))).not.toContain('room_visits')
            expect(JSON.stringify(await rpc(ADMIN, 'public.admin_user_room($1)', [USER.sub]))).not.toContain('left_at')
            // Целостность: выход раньше входа невозможен.
            await expect(db.exec(`insert into public.room_visits (room_id, role, joined_at, left_at) values ('${id}', 'guest', now(), now() - interval '1 hour')`)).rejects.toThrow(/check/)
            await expect(db.exec(`insert into public.room_visits (room_id, role) values ('${id}', 'admin')`)).rejects.toThrow(/check/)
        })
    })
})
