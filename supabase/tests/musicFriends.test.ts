// @vitest-environment node
/**
 * Права этапа «Музыка и друзья» на настоящем Postgres (PGlite): не-друг не
 * видит чужое избранное, приватные плейлисты, топ и «сейчас слушает»; друг
 * видит; публичный плейлист видят все вошедшие; никто не меняет чужое;
 * лимиты плейлистов, треков и заявок; нельзя подружиться с собой.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { ADMIN, ANON, OWNER, USER, USER2, applyMigrations, as, createDb } from './pgHarness'

// Третий пользователь — «чужой» для USER и USER2.
const STRANGER = { role: 'authenticated', sub: '00000000-0000-4000-8000-000000000003', app_metadata: { role: 'user' } }
// Новые аккаунты — только с техническим адресом (guard_auth_users).
const TECH = (n: number) => `u-${String(n).padStart(32, '0')}@id.frnkness.ru`
const T1 ='album-one/first-track'
const T2 = 'album-one/second-track'
const T3 = 'single/third'

describe('музыка и друзья: права', () => {
    let db: PGlite
    const one = async (sql: string, params?: unknown[]) => (await db.query<any>(sql, params)).rows[0]
    /** Вызов RPC от имени пользователя: значение функции. */
    const rpc = async (claims: object, sql: string, params?: unknown[]) => (await as(db, 'authenticated', claims, `select ${sql} as r`, params)).rows[0].r
    const befriend = async (a: { sub: string }, b: { sub: string }) => {
        await rpc(a, 'public.friend_request($1)', [b.sub])
        await rpc(b, 'public.friend_respond($1, true)', [a.sub])
    }

    beforeAll(async () => {
        db = await createDb()
        await applyMigrations(db)
        await applyMigrations(db) // повторный прогон не падает
        await db.exec(`
            insert into auth.users (id, email, raw_app_meta_data) values ('${STRANGER.sub}', '${TECH(999)}','{"role":"user"}');
            insert into public.profiles (id, nick, nick_key) values
                ('${OWNER.sub}', 'frnkness', 'frnkness'),
                ('${ADMIN.sub}', 'Друг', 'друг'),
                ('${USER.sub}', 'Яна', 'яна'),
                ('${USER2.sub}', 'Второй', 'второи'),
                ('${STRANGER.sub}', 'Чужой', 'чужои');
        `)
        // USER и USER2 — друзья; STRANGER — ни с кем.
        await befriend(USER, USER2)
    }, 60_000)

    describe('друзья', () => {
        it('нельзя отправить заявку себе — ни через RPC, ни в обход', async () => {
            await expect(rpc(USER, 'public.friend_request($1)', [USER.sub])).rejects.toThrow(/себя/)
            await expect(db.exec(`insert into public.friendships (requester, addressee) values ('${USER.sub}', '${USER.sub}')`)).rejects.toThrow(/check/)
        })

        it('повторная заявка и заявка другу — ошибка; встречная — сразу дружба', async () => {
            expect(await rpc(STRANGER, 'public.friend_request($1)', [ADMIN.sub])).toEqual({ status: 'pending' })
            await expect(rpc(STRANGER, 'public.friend_request($1)', [ADMIN.sub])).rejects.toThrow(/уже отправлена/)
            await expect(rpc(USER, 'public.friend_request($1)', [USER2.sub])).rejects.toThrow(/уже друзья/)
            expect(await rpc(ADMIN, 'public.friend_request($1)', [STRANGER.sub])).toEqual({ status: 'accepted' })
            expect(await rpc(ADMIN, 'public.friend_remove($1)', [STRANGER.sub])).toBe('')
            // Дубль пары в обратную сторону невозможен и напрямую.
            await db.exec(`insert into public.friendships (requester, addressee) values ('${OWNER.sub}', '${ADMIN.sub}')`)
            await expect(db.exec(`insert into public.friendships (requester, addressee) values ('${ADMIN.sub}', '${OWNER.sub}')`)).rejects.toThrow(/unique|duplicate/)
            await db.exec(`delete from public.friendships where requester = '${OWNER.sub}' and addressee = '${ADMIN.sub}'`)
        })

        it('принять, отклонить, отменить — только свою сторону заявки', async () => {
            await rpc(STRANGER, 'public.friend_request($1)', [OWNER.sub])
            // Отправитель не может сам принять свою заявку.
            await expect(rpc(STRANGER, 'public.friend_respond($1, true)', [OWNER.sub])).rejects.toThrow(/не найдена/)
            // Посторонний не может отменить чужую заявку.
            await expect(rpc(USER, 'public.friend_cancel($1)', [OWNER.sub])).rejects.toThrow(/не найдена/)
            expect(await rpc(OWNER, 'public.friend_requests_count()')).toBe(1)
            expect(await rpc(OWNER, 'public.friend_respond($1, false)', [STRANGER.sub])).toEqual({ status: 'none' })
            expect(await rpc(OWNER, 'public.friend_requests_count()')).toBe(0)
            await rpc(STRANGER, 'public.friend_request($1)', [OWNER.sub])
            await rpc(STRANGER, 'public.friend_cancel($1)', [OWNER.sub])
            expect(await rpc(OWNER, 'public.friend_requests_count()')).toBe(0)
        })

        it('список: друзья, входящие, исходящие; таблицу видят только участники', async () => {
            await rpc(STRANGER, 'public.friend_request($1)', [USER.sub])
            const list = await rpc(USER, 'public.friends_list()')
            expect(list.friends.map((f: any) => f.nick)).toEqual(['Второй'])
            expect(list.incoming.map((f: any) => f.nick)).toEqual(['Чужой'])
            expect(list.outgoing).toEqual([])
            expect((await as(db, 'authenticated', ADMIN, 'select * from public.friendships')).rows).toHaveLength(0)
            await rpc(USER, 'public.friend_respond($1, false)', [STRANGER.sub])
        })

        it('писать в friendships напрямую нельзя', async () => {
            await expect(
                as(db, 'authenticated', STRANGER, "insert into public.friendships (requester, addressee, status, accepted_at) values ($1, $2, 'accepted', now())", [STRANGER.sub, USER.sub])
            ).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', STRANGER, "update public.friendships set status = 'accepted'")).rejects.toThrow(/permission denied/)
        })

        it('лимит — 20 заявок в сутки', async () => {
            const ids: string[] = []
            for (let i = 0; i < 21; i++) ids.push(`00000000-0000-4000-9000-${String(i).padStart(12, '0')}`)
            await db.exec(ids.map((id, i) => `insert into auth.users (id, email) values ('${id}', '${TECH(i)}'); insert into public.profiles (id, nick, nick_key) values ('${id}', 'bulk${i}', 'bulk${i}');`).join('\n'))
            // Уже отправленные STRANGER-ом сегодня заявки тоже считаются.
            const used = Number((await one("select count(*) n from public.rate_limits where action = 'friend-request' and key_hash = $1", [STRANGER.sub])).n)
            for (let i = 0; i < 20 - used; i++) await rpc(STRANGER, 'public.friend_request($1)', [ids[i]])
            await expect(rpc(STRANGER, 'public.friend_request($1)', [ids[20]])).rejects.toThrow(/20 заявок/)
            await db.exec(`delete from public.friendships where requester = '${STRANGER.sub}'`)
        })

        it('аноним и забаненный — без доступа', async () => {
            await expect(as(db, 'anon', ANON, 'select public.friends_list()')).rejects.toThrow(/permission denied/)
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER2.sub}'`)
            await expect(rpc(USER2, 'public.friends_list()')).rejects.toThrow(/Нужно войти/)
            await db.exec(`update auth.users set banned_until = null where id = '${USER2.sub}'`)
        })
    })

    describe('профиль по нику и поиск', () => {
        it('открытое — всем вошедшим: ник, «о себе», дата, число друзей, отношение', async () => {
            const p = await rpc(STRANGER, 'public.profile_by_nick($1)', ['ЯНА'])
            expect(p).toMatchObject({ id: USER.sub, nick: 'Яна', friends_count: 1, relation: 'none', now_playing: null })
            expect((await rpc(USER2, 'public.profile_by_nick($1)', ['яна'])).relation).toBe('friend')
            expect((await rpc(USER, 'public.profile_by_nick($1)', ['Яна'])).relation).toBe('self')
            expect(await rpc(USER, 'public.profile_by_nick($1)', ['нет-такого'])).toBeNull()
        })

        it('поиск: без учёта регистра и е/ё, без себя, % и _ — обычные символы', async () => {
            const nicks = async (q: string) => ((await rpc(USER, 'public.user_search($1)', [q])) as any[]).map((r) => r.nick)
            expect(await nicks('ВТОР')).toEqual(['Второй'])
            expect(await nicks('яна')).toEqual([])
            expect(await nicks('%')).toEqual([])
            expect((await rpc(USER, 'public.user_search($1)', ['втор']))[0].relation).toBe('friend')
        })
    })

    describe('избранное', () => {
        beforeAll(async () => {
            await rpc(USER, 'public.favorite_set($1, true)', [T1])
            await rpc(USER, 'public.favorite_set($1, true)', [T2])
            await rpc(USER, 'public.favorite_set($1, true)', [T2]) // повтор — без ошибки и без дубля
        })

        it('своё и друга — видно; чужое — нет (RPC и напрямую)', async () => {
            expect((await rpc(USER, 'public.user_favorites($1)', [USER.sub])).map((f: any) => f.track_id).sort()).toEqual([T1, T2])
            expect((await rpc(USER2, 'public.user_favorites($1)', [USER.sub]))).toHaveLength(2)
            await expect(rpc(STRANGER, 'public.user_favorites($1)', [USER.sub])).rejects.toThrow(/Нет доступа/)
            expect((await as(db, 'authenticated', STRANGER, 'select * from public.favorites')).rows).toHaveLength(0)
            expect((await as(db, 'authenticated', USER2, 'select * from public.favorites')).rows).toHaveLength(2)
        })

        it('админ через пользовательские RPC не видит чужое — только через admin_user_social', async () => {
            await expect(rpc(ADMIN, 'public.user_favorites($1)', [USER.sub])).rejects.toThrow(/Нет доступа/)
            expect((await rpc(ADMIN, 'public.admin_user_social($1)', [USER.sub])).favorites).toHaveLength(2)
            await expect(rpc(USER2, 'public.admin_user_social($1)', [USER.sub])).rejects.toThrow(/Нет доступа/)
        })

        it('менять можно только своё; неверный id трека не принимается', async () => {
            await rpc(STRANGER, 'public.favorite_set($1, false)', [T1]) // удаляет только своё
            expect((await rpc(USER, 'public.user_favorites($1)', [USER.sub]))).toHaveLength(2)
            await expect(as(db, 'authenticated', STRANGER, 'insert into public.favorites (user_id, track_id) values ($1, $2)', [USER.sub, T3])).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', STRANGER, 'delete from public.favorites')).rejects.toThrow(/permission denied/)
            for (const bad of ['', 'no-slash', '../x/y', 'A/b', 'a/b/c', 'a/<b>']) {
                await expect(rpc(USER, 'public.favorite_set($1, true)', [bad])).rejects.toThrow(/check/)
            }
        })

        it('аноним — нет прав', async () => {
            await expect(as(db, 'anon', ANON, `select public.favorite_set('${T1}', true)`)).rejects.toThrow(/permission denied/)
        })
    })

    describe('плейлисты', () => {
        let priv: string
        let pub: string

        beforeAll(async () => {
            priv = (await rpc(USER, 'public.playlist_create($1, $2, false)', ['  Для себя\u0007 ', 'строка 1\nстрока 2'])).id
            pub = (await rpc(USER, 'public.playlist_create($1)', ['Для всех'])).id
            await rpc(USER, 'public.playlist_update($1, null, null, true)', [pub])
            for (const t of [T1, T2, T3]) await rpc(USER, 'public.playlist_add_track($1, $2)', [priv, t])
            await rpc(USER, 'public.playlist_add_track($1, $2)', [pub, T3])
        })

        it('текст чистится: управляющие символы и пробелы по краям', async () => {
            const p = await rpc(USER, 'public.playlist_get($1)', [priv])
            expect(p.title).toBe('Для себя')
            expect(p.description).toBe('строка 1\nстрока 2')
            expect(p.tracks).toEqual([T1, T2, T3])
            expect(p.owner).toMatchObject({ nick: 'Яна' })
            await expect(rpc(USER, 'public.playlist_create($1)', ['   '])).rejects.toThrow(/от 1 до 80/)
            await expect(rpc(USER, 'public.playlist_create($1)', ['я'.repeat(81)])).rejects.toThrow(/от 1 до 80/)
        })

        it('не-друг видит только публичный; друг — все; сам — все', async () => {
            const titles = async (claims: object) => ((await rpc(claims, 'public.user_playlists($1)', [USER.sub])) as any[]).map((p) => p.title).sort()
            expect(await titles(STRANGER)).toEqual(['Для всех'])
            expect(await titles(USER2)).toEqual(['Для всех', 'Для себя'])
            expect(await titles(USER)).toEqual(['Для всех', 'Для себя'])
            await expect(rpc(STRANGER, 'public.playlist_get($1)', [priv])).rejects.toThrow(/не найден/)
            expect((await rpc(STRANGER, 'public.playlist_get($1)', [pub])).tracks).toEqual([T3])
            expect((await rpc(USER2, 'public.playlist_get($1)', [priv])).tracks).toHaveLength(3)
        })

        it('напрямую: RLS те же правила', async () => {
            expect((await as(db, 'authenticated', STRANGER, 'select title from public.playlists')).rows.map((r) => r.title)).toEqual(['Для всех'])
            expect((await as(db, 'authenticated', STRANGER, 'select * from public.playlist_tracks where playlist_id = $1', [priv])).rows).toHaveLength(0)
            expect((await as(db, 'authenticated', STRANGER, 'select * from public.playlist_tracks where playlist_id = $1', [pub])).rows).toHaveLength(1)
            expect((await as(db, 'authenticated', USER2, 'select * from public.playlist_tracks where playlist_id = $1', [priv])).rows).toHaveLength(3)
        })

        it('чужой плейлист не изменить: ни RPC, ни напрямую', async () => {
            const attempts = [
                ['public.playlist_update($1, $2)', [pub, 'взлом']],
                ['public.playlist_add_track($1, $2)', [pub, T1]],
                ['public.playlist_remove_track($1, $2)', [pub, T3]],
                ['public.playlist_reorder($1, $2)', [priv, [T3, T2, T1]]],
                ['public.playlist_set_cover($1, 1)', [pub]],
                ['public.playlist_delete($1)', [pub]]
            ] as const
            for (const [sql, params] of attempts) {
                await expect(rpc(USER2, sql, [...params])).rejects.toThrow(/не найден/)
                await expect(rpc(ADMIN, sql, [...params])).rejects.toThrow(/не найден/)
            }
            await expect(as(db, 'authenticated', USER2, "update public.playlists set title = 'x'")).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER2, 'delete from public.playlist_tracks')).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER2, 'insert into public.playlists (owner_id, title) values ($1, $2)', [USER.sub, 'x'])).rejects.toThrow(/permission denied/)
            expect((await rpc(USER, 'public.playlist_get($1)', [pub])).title).toBe('Для всех')
        })

        it('дубль трека не добавляется', async () => {
            await expect(rpc(USER, 'public.playlist_add_track($1, $2)', [priv, T1])).rejects.toThrow(/уже в плейлисте/)
        })

        it('порядок: перестановка, удаление с перенумерацией, проверка состава', async () => {
            expect((await rpc(USER, 'public.playlist_reorder($1, $2)', [priv, [T3, T1, T2]])).tracks).toEqual([T3, T1, T2])
            await expect(rpc(USER, 'public.playlist_reorder($1, $2)', [priv, [T3, T1]])).rejects.toThrow(/изменился/)
            await expect(rpc(USER, 'public.playlist_reorder($1, $2)', [priv, [T3, T1, T1]])).rejects.toThrow(/изменился/)
            await expect(rpc(USER, 'public.playlist_reorder($1, $2)', [priv, [T3, T1, 'x/y']])).rejects.toThrow(/изменился/)
            await rpc(USER, 'public.playlist_remove_track($1, $2)', [priv, T1])
            const rows = (await db.query<any>('select track_id, position from public.playlist_tracks where playlist_id = $1 order by position', [priv])).rows
            expect(rows).toEqual([{ track_id: T3, position: 1 }, { track_id: T2, position: 2 }])
        })

        it('лимит — 200 треков в плейлисте (и для service role)', async () => {
            const big = (await rpc(USER2, 'public.playlist_create($1)', ['Большой'])).id
            await db.exec(`insert into public.playlist_tracks (playlist_id, track_id, position)
                select '${big}', 'bulk/t' || g, g from generate_series(1, 199) g`)
            await rpc(USER2, 'public.playlist_add_track($1, $2)', [big, T1])
            await expect(rpc(USER2, 'public.playlist_add_track($1, $2)', [big, T2])).rejects.toThrow(/200 треков/)
            await expect(db.exec(`insert into public.playlist_tracks (playlist_id, track_id, position) values ('${big}', 'bulk/extra', 500)`)).rejects.toThrow(/200 треков/)
            await rpc(USER2, 'public.playlist_delete($1)', [big])
        })

        it('лимит — 50 плейлистов', async () => {
            const have = Number((await one('select count(*) n from public.playlists where owner_id = $1', [STRANGER.sub])).n)
            for (let i = have; i < 50; i++) await rpc(STRANGER, 'public.playlist_create($1)', [`п${i}`])
            await expect(rpc(STRANGER, 'public.playlist_create($1)', ['лишний'])).rejects.toThrow(/50 плейлистов/)
            await db.exec(`delete from public.playlists where owner_id = '${STRANGER.sub}'`)
        })

        it('удаление плейлиста — со всеми треками', async () => {
            const tmp = (await rpc(USER, 'public.playlist_create($1)', ['Временный'])).id
            await rpc(USER, 'public.playlist_add_track($1, $2)', [tmp, T1])
            await rpc(USER, 'public.playlist_delete($1)', [tmp])
            expect((await one('select count(*)::int n from public.playlist_tracks where playlist_id = $1', [tmp])).n).toBe(0)
        })

        describe('обложки (бакет playlist-covers)', () => {
            const put = (claims: object, name: string) => as(db, 'authenticated', claims, "insert into storage.objects (bucket_id, name) values ('playlist-covers', $1)", [name])
            const visible = async (claims: object, name: string) =>
                (await as(db, 'authenticated', claims, "select name from storage.objects where bucket_id = 'playlist-covers' and name = $1", [name])).rows.length

            it('бакет приватный, до 512 КБ, только картинки', async () => {
                const b = await one("select * from storage.buckets where id = 'playlist-covers'")
                expect(b.public).toBe(false)
                expect(Number(b.file_size_limit)).toBe(524288)
                expect(b.allowed_mime_types).toEqual(['image/webp', 'image/jpeg', 'image/png'])
            })

            it('загрузить может только владелец плейлиста и только в свою папку', async () => {
                await put(USER, `${USER.sub}/${priv}`)
                await put(USER, `${USER.sub}/${pub}`)
                await expect(put(USER2, `${USER2.sub}/${priv}`)).rejects.toThrow(/row-level security/)
                await expect(put(USER2, `${USER.sub}/${priv}`)).rejects.toThrow(/row-level security/)
                await expect(put(USER, `${USER.sub}/${priv}.png`)).rejects.toThrow(/row-level security/)
                await expect(put(USER, `${USER.sub}/00000000-0000-4000-8000-0000000000aa`)).rejects.toThrow(/row-level security/)
                await expect(as(db, 'anon', ANON, "insert into storage.objects (bucket_id, name) values ('playlist-covers', $1)", [`${USER.sub}/${pub}`])).rejects.toThrow(/row-level security|permission denied/)
            })

            it('видимость — как у плейлиста', async () => {
                expect(await visible(STRANGER, `${USER.sub}/${pub}`)).toBe(1)
                expect(await visible(STRANGER, `${USER.sub}/${priv}`)).toBe(0)
                expect(await visible(USER2, `${USER.sub}/${priv}`)).toBe(1)
                // Плейлист стал приватным — обложку чужой больше не видит.
                await rpc(USER, 'public.playlist_update($1, null, null, false)', [pub])
                expect(await visible(STRANGER, `${USER.sub}/${pub}`)).toBe(0)
                await rpc(USER, 'public.playlist_update($1, null, null, true)', [pub])
            })

            it('чужую обложку не удалить и не перезаписать', async () => {
                await as(db, 'authenticated', USER2, "delete from storage.objects where bucket_id = 'playlist-covers'")
                await as(db, 'authenticated', USER2, "update storage.objects set owner = $1 where bucket_id = 'playlist-covers'", [USER2.sub])
                expect((await one("select count(*)::int n, count(owner)::int o from storage.objects where bucket_id = 'playlist-covers'"))).toEqual({ n: 2, o: 0 })
                await as(db, 'authenticated', USER, "delete from storage.objects where bucket_id = 'playlist-covers' and name = $1", [`${USER.sub}/${pub}`])
                expect((await one("select count(*)::int n from storage.objects where bucket_id = 'playlist-covers'")).n).toBe(1)
            })

            it('версия обложки — только владелец; null возвращает коллаж', async () => {
                expect((await rpc(USER, 'public.playlist_set_cover($1, 1700000000000)', [priv])).cover_version).toBe(1700000000000)
                expect((await rpc(USER, 'public.playlist_set_cover($1, null)', [priv])).cover_version).toBeNull()
                await expect(rpc(USER, 'public.playlist_set_cover($1, 0)', [priv])).rejects.toThrow(/версия/)
            })
        })
    })

    describe('«мой топ» и «сейчас слушает»', () => {
        beforeAll(async () => {
            await db.exec(`insert into public.play_events (track_key, user_id, created_at) values
                ('album-one-0', '${USER.sub}', now()),
                ('album-one-0', '${USER.sub}', now() - interval '1 day'),
                ('album-one-1', '${USER.sub}', now() - interval '10 days'),
                ('album-one-1', '${USER.sub}', now() - interval '11 days'),
                ('album-one-1', '${USER.sub}', now() - interval '12 days'),
                ('single-0', '${USER.sub}', now() - interval '100 days'),
                ('single-0', '${USER2.sub}', now())`)
        })

        it('периоды 7 / 30 дней / всё время, только свои прослушивания', async () => {
            const top = (days: number | null) => rpc(USER, 'public.user_top($1, $2)', [USER.sub, days])
            expect(await top(7)).toEqual([{ track_key: 'album-one-0', plays: 2 }])
            expect(await top(30)).toEqual([{ track_key: 'album-one-1', plays: 3 }, { track_key: 'album-one-0', plays: 2 }])
            expect(await top(null)).toEqual([{ track_key: 'album-one-1', plays: 3 }, { track_key: 'album-one-0', plays: 2 }, { track_key: 'single-0', plays: 1 }])
            await expect(top(365)).rejects.toThrow(/Период/)
        })

        it('друг видит топ, не-друг — нет', async () => {
            expect(await rpc(USER2, 'public.user_top($1, null)', [USER.sub])).toHaveLength(3)
            await expect(rpc(STRANGER, 'public.user_top($1, null)', [USER.sub])).rejects.toThrow(/Нет доступа/)
        })

        it('«сейчас слушает»: видно себе и другу, не-другу — нет; старше 5 минут — не видно', async () => {
            await rpc(USER, 'public.now_playing_set($1)', [T1])
            expect((await rpc(USER2, 'public.profile_by_nick($1)', ['Яна'])).now_playing).toMatchObject({ track_id: T1 })
            expect((await rpc(USER, 'public.profile_by_nick($1)', ['Яна'])).now_playing).toMatchObject({ track_id: T1 })
            expect((await rpc(STRANGER, 'public.profile_by_nick($1)', ['Яна'])).now_playing).toBeNull()
            expect((await as(db, 'authenticated', STRANGER, 'select * from public.now_playing')).rows).toHaveLength(0)
            expect((await rpc(USER2, 'public.friends_list()')).friends[0].now_playing).toMatchObject({ track_id: T1 })
            await db.exec(`update public.now_playing set updated_at = now() - interval '6 minutes'`)
            expect((await rpc(USER2, 'public.profile_by_nick($1)', ['Яна'])).now_playing).toBeNull()
        })

        it('пишется не чаще раза в 30 секунд; чужое не пишется', async () => {
            await db.exec('delete from public.now_playing')
            await rpc(USER, 'public.now_playing_set($1)', [T1])
            await rpc(USER, 'public.now_playing_set($1)', [T2])
            expect((await one('select track_id from public.now_playing where user_id = $1', [USER.sub])).track_id).toBe(T1)
            await db.exec(`update public.now_playing set updated_at = now() - interval '31 seconds'`)
            await rpc(USER, 'public.now_playing_set($1)', [T2])
            expect((await one('select track_id from public.now_playing where user_id = $1', [USER.sub])).track_id).toBe(T2)
            await expect(as(db, 'authenticated', STRANGER, 'update public.now_playing set track_id = $1', [T3])).rejects.toThrow(/permission denied/)
        })
    })

    describe('админ и удаление аккаунта', () => {
        it('admin_user_social: избранное, плейлисты с треками, друзья и заявки', async () => {
            const s = await rpc(ADMIN, 'public.admin_user_social($1)', [USER.sub])
            expect(s.playlists.map((p: any) => p.title).sort()).toEqual(['Для всех', 'Для себя'])
            expect(s.playlists[0].tracks).toBeDefined()
            expect(s.friends.map((f: any) => [f.nick, f.status])).toEqual([['Второй', 'accepted']])
            await expect(as(db, 'anon', ANON, `select public.admin_user_social('${USER.sub}')`)).rejects.toThrow(/permission denied/)
        })

        it('по are_friends нельзя узнать чужие дружбы', async () => {
            expect(await rpc(USER2, 'public.are_friends($1, $2)', [USER2.sub, USER.sub])).toBe(true)
            expect(await rpc(STRANGER, 'public.are_friends($1, $2)', [USER2.sub, USER.sub])).toBe(false)
        })

        it('внутренние помощники недоступны сайту', async () => {
            for (const sql of [`public.relation_to('${USER.sub}')`, `public.friends_count('${USER.sub}')`, `public.fresh_now_playing('${USER.sub}')`, 'public.require_active_user()']) {
                await expect(rpc(USER, sql)).rejects.toThrow(/permission denied/)
            }
        })

        it('удаление пользователя удаляет избранное, плейлисты, дружбы и заявки', async () => {
            await rpc(OWNER, 'public.friend_request($1)', [USER.sub])
            await db.exec(`delete from auth.users where id = '${USER.sub}'`)
            for (const [table, col] of [['favorites', 'user_id'], ['playlists', 'owner_id'], ['now_playing', 'user_id']]) {
                expect((await one(`select count(*)::int n from public.${table} where ${col} = $1`, [USER.sub])).n).toBe(0)
            }
            expect((await one('select count(*)::int n from public.playlist_tracks')).n).toBe(0)
            expect((await one('select count(*)::int n from public.friendships where $1 in (requester, addressee)', [USER.sub])).n).toBe(0)
            expect((await rpc(USER2, 'public.friends_list()')).friends).toEqual([])
        })
    })
})
