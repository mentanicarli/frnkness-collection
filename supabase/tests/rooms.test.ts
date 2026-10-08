// @vitest-environment node
/**
 * Права и лимиты этапа «Комнаты» на настоящем Postgres (PGlite): одна открытая
 * комната у хозяина, одна комната на человека, до 20 участников, выгнанный не
 * возвращается; чужой не читает и не управляет комнатой; состояние пишет
 * только хозяин, а seq и время выдаёт база; идле-закрытие через 30 минут;
 * бан и удаление закрывают комнаты; политики Realtime (realtime.messages)
 * пускают в канал только участников, а команды принимают только от хозяина.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import { ADMIN, ANON, OWNER, REPO, USER, USER2, applyMigrations, as, createDb } from './pgHarness'

const STRANGER = { role: 'authenticated', sub: '00000000-0000-4000-8000-000000000003', app_metadata: { role: 'user' } }
const TECH = (n: number) => `u-${String(n).padStart(32, '0')}@id.frnkness.ru`
const uid = (n: number) => `00000000-0000-4000-8000-${String(100 + n).padStart(12, '0')}`
const crowd = (n: number) => ({ role: 'authenticated', sub: uid(n), app_metadata: { role: 'user' } })

const STATE = {
    queue: { source: { kind: 'release', releaseId: 'album-one' }, trackIds: ['album-one/first-track', 'album-one/second-track'], order: [0, 1], pos: 0, shuffle: false, endless: false },
    track_id: 'album-one/first-track',
    pos_ms: 1500,
    playing: true
}

describe('комнаты: права и лимиты', () => {
    let db: PGlite
    const one = async (sql: string, params?: unknown[]) => (await db.query<any>(sql, params)).rows[0]
    const rpc = async (claims: object, sql: string, params?: unknown[]) => (await as(db, 'authenticated', claims, `select ${sql} as r`, params)).rows[0].r
    /** Новая комната хозяина; возвращает её id. */
    const mkRoom = async (owner: { sub: string }, title = 'Тест') => (await rpc(owner, 'public.room_create($1)', [title])).id as string
    const befriend = async (a: { sub: string }, b: { sub: string }) => {
        await rpc(a, 'public.friend_request($1)', [b.sub])
        await rpc(b, 'public.friend_respond($1, true)', [a.sub])
    }
    const memberCount = async (room: string) => Number((await one('select count(*)::int n from public.room_members where room_id = $1', [room])).n)
    const closeAllRooms = async () => {
        await db.exec(`update public.rooms set closed_at = now(), closed_reason = 'admin' where closed_at is null; delete from public.room_members; delete from public.room_kicks; delete from public.room_invites; delete from public.rate_limits;`)
    }

    // Тест не оставляет за собой комнат, даже если упал.
    afterEach(async () => {
        await db.exec(`update auth.users set banned_until = null, deleted_at = null; delete from public.friendships;`).catch(() => undefined)
        await closeAllRooms()
    })

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
        // Толпа для проверки лимита в 20 человек.
        for (let i = 1; i <= 22; i++) {
            await db.exec(`
                insert into auth.users (id, email, raw_app_meta_data) values ('${uid(i)}', '${TECH(i)}', '{"role":"user"}');
                insert into public.profiles (id, nick, nick_key) values ('${uid(i)}', 'Гость${i}', 'гость${i}');
            `)
        }
    }, 120_000)

    describe('закрытые таблицы', () => {
        it('прямого доступа к таблицам нет ни у вошедших, ни у анонимов', async () => {
            const id = await mkRoom(USER, 'Закрытая')
            for (const t of ['rooms', 'room_members', 'room_kicks', 'room_invites']) {
                await expect(as(db, 'authenticated', USER, `select * from public.${t}`)).rejects.toThrow(/permission denied/)
                await expect(as(db, 'anon', ANON, `select * from public.${t}`)).rejects.toThrow(/permission denied/)
            }
            await expect(as(db, 'authenticated', USER, `insert into public.rooms (owner_id, title) values ('${USER.sub}', 'x')`)).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, `update public.rooms set title = 'x' where id = '${id}'`)).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, `delete from public.room_members`)).rejects.toThrow(/permission denied/)
            await closeAllRooms()
        })

        it('анонимы не вызывают ни одной функции комнат', async () => {
            const calls = [
                'public.server_now()',
                "public.room_create('x')",
                `public.room_join('${uid(1)}')`,
                'public.room_leave()',
                `public.room_close('${uid(1)}')`,
                `public.room_get('${uid(1)}')`,
                'public.room_my()',
                `public.room_info('${uid(1)}')`,
                `public.room_set_state('${uid(1)}', '{}')`,
                `public.room_heartbeat('${uid(1)}')`,
                `public.room_kick('${uid(1)}', '${uid(2)}')`,
                `public.room_invite('${uid(1)}', '${uid(2)}')`,
                'public.room_invites_list()',
                'public.room_invites_count()',
                `public.room_invite_dismiss('${uid(1)}')`,
                `public.admin_user_room('${uid(1)}')`,
                `public.admin_room_close('${uid(1)}')`
            ]
            for (const c of calls) await expect(as(db, 'anon', ANON, `select ${c}`), c).rejects.toThrow(/permission denied/)
        })

        it('внутренние помощники вошедшим недоступны', async () => {
            await expect(as(db, 'authenticated', USER, `select public.rooms_sweep()`)).rejects.toThrow(/permission denied/)
            await expect(as(db, 'authenticated', USER, `select public.room_close_internal('${uid(1)}', 'admin')`)).rejects.toThrow(/permission denied/)
        })
    })

    describe('создание и вход', () => {
        it('у хозяина одна открытая комната; после закрытия — новая', async () => {
            const first = await mkRoom(USER, 'Первая')
            await expect(rpc(USER, "public.room_create('Вторая')")).rejects.toThrow(/уже есть открытая/)
            await rpc(USER, 'public.room_close($1)', [first])
            const second = await mkRoom(USER, 'Вторая')
            expect(second).not.toBe(first)
            await closeAllRooms()
        })

        it('не больше 20 созданий комнат в час', async () => {
            for (let i = 0; i < 20; i++) {
                const id = await mkRoom(USER)
                await rpc(USER, 'public.room_close($1)', [id])
            }
            await expect(rpc(USER, "public.room_create('ещё')")).rejects.toThrow(/Слишком часто/)
            await closeAllRooms()
        })

        it('название — до 40 символов, пустое заменяется ником; id — uuid', async () => {
            await expect(rpc(USER, 'public.room_create($1)', ['я'.repeat(41)])).rejects.toThrow(/до 40 символов/)
            const ok = await rpc(USER, 'public.room_create($1)', ['я'.repeat(40)])
            expect(ok.title).toHaveLength(40)
            expect(ok.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
            await closeAllRooms()
            const blank = await rpc(USER, "public.room_create('   ')")
            expect(blank.title).toBe('Комната Яна')
            // Управляющие символы убираются.
            await closeAllRooms()
            const dirty = await rpc(USER, 'public.room_create($1)', ['A\u0007B\nC'])
            expect(dirty.title).toBe('A B C')
            await closeAllRooms()
        })

        it('войти по ссылке может любой вошедший, не друг тоже', async () => {
            const id = await mkRoom(USER)
            const joined = await rpc(STRANGER, 'public.room_join($1)', [id])
            expect(joined.members.map((m: any) => m.nick)).toEqual(['Яна', 'Чужой'])
            expect(joined.is_owner).toBe(false)
            // Повторный вход — тот же участник.
            await rpc(STRANGER, 'public.room_join($1)', [id])
            expect(await memberCount(id)).toBe(2)
            await closeAllRooms()
        })

        it('неизвестная и закрытая комната — «не найдена»; ссылка не угадывается перебором', async () => {
            await expect(rpc(USER2, "public.room_join('00000000-0000-4000-8000-0000000000ff')")).rejects.toThrow(/не найдена/)
            const id = await mkRoom(USER)
            await rpc(USER, 'public.room_close($1)', [id])
            await expect(rpc(USER2, 'public.room_join($1)', [id])).rejects.toThrow(/не найдена или уже закрыта/)
            expect(await rpc(USER2, 'public.room_info($1)', [id])).toEqual({ closed: true })
            await closeAllRooms()
        })

        it('одновременно — только в одной комнате: вход в другую выводит из прежней', async () => {
            const a = await mkRoom(USER, 'А')
            const b = await mkRoom(USER2, 'Б')
            await rpc(STRANGER, 'public.room_join($1)', [a])
            await rpc(STRANGER, 'public.room_join($1)', [b])
            expect(await memberCount(a)).toBe(1)
            expect(await memberCount(b)).toBe(2)
            expect((await rpc(STRANGER, 'public.room_my()')).id).toBe(b)
            // Прямой обход уникальности тоже невозможен.
            await expect(db.exec(`insert into public.room_members (room_id, user_id) values ('${a}', '${STRANGER.sub}')`)).rejects.toThrow(/unique|duplicate/)
            await closeAllRooms()
        })

        it('хозяин открытой комнаты не входит в чужую; создание комнаты выводит из чужой', async () => {
            const a = await mkRoom(USER, 'А')
            const b = await mkRoom(USER2, 'Б')
            await expect(rpc(USER, 'public.room_join($1)', [b])).rejects.toThrow(/Сначала закрой свою комнату/)
            await rpc(STRANGER, 'public.room_join($1)', [a])
            const own = await mkRoom(STRANGER, 'Своя')
            expect(await memberCount(a)).toBe(1)
            expect(own).not.toBe(a)
            await closeAllRooms()
        })

        it('хозяин не может «выйти» — только закрыть; гость выходит', async () => {
            const id = await mkRoom(USER)
            await rpc(STRANGER, 'public.room_join($1)', [id])
            await expect(rpc(USER, 'public.room_leave()')).rejects.toThrow(/закрывает/)
            await rpc(STRANGER, 'public.room_leave()')
            expect(await memberCount(id)).toBe(1)
            // Повторный выход не ошибка.
            await rpc(STRANGER, 'public.room_leave()')
            await closeAllRooms()
        })

        it('до 20 участников, двадцать первый — отказ, но место освобождается', async () => {
            const id = await mkRoom(USER)
            for (let i = 1; i <= 19; i++) await rpc(crowd(i), 'public.room_join($1)', [id])
            expect(await memberCount(id)).toBe(20)
            await expect(rpc(crowd(20), 'public.room_join($1)', [id])).rejects.toThrow(/уже 20 человек/)
            const info = await rpc(crowd(20), 'public.room_info($1)', [id])
            expect(info).toMatchObject({ members: 20, full: true, is_member: false })
            await rpc(crowd(1), 'public.room_leave()')
            await rpc(crowd(20), 'public.room_join($1)', [id])
            expect(await memberCount(id)).toBe(20)
            await closeAllRooms()
        })

        it('забаненный и удалённый не создают и не входят', async () => {
            const id = await mkRoom(USER)
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${STRANGER.sub}'`)
            await expect(rpc(STRANGER, 'public.room_join($1)', [id])).rejects.toThrow(/Нужно войти/)
            await expect(rpc(STRANGER, "public.room_create('x')")).rejects.toThrow(/Нужно войти/)
            await db.exec(`update auth.users set banned_until = null where id = '${STRANGER.sub}'`)
            await closeAllRooms()
        })
    })

    describe('чужой не читает и не управляет', () => {
        it('не участник: room_get, set_state, kick, close, invite, heartbeat — отказ', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await expect(rpc(STRANGER, 'public.room_get($1)', [id])).rejects.toThrow(/не найдена/)
            await expect(rpc(STRANGER, 'public.room_set_state($1, $2)', [id, STATE])).rejects.toThrow(/не найдена/)
            await expect(rpc(STRANGER, 'public.room_close($1)', [id])).rejects.toThrow(/не найдена/)
            await expect(rpc(STRANGER, 'public.room_kick($1, $2)', [id, USER2.sub])).rejects.toThrow(/не найдена/)
            await expect(rpc(STRANGER, 'public.room_invite($1, $2)', [id, USER2.sub])).rejects.toThrow(/не найдена/)
            expect(await rpc(STRANGER, 'public.room_heartbeat($1)', [id])).toMatchObject({ member: false, closed: false })
            expect(await rpc(STRANGER, 'public.room_my()')).toBeNull()
            await closeAllRooms()
        })

        it('гость (участник, но не хозяин) тоже не управляет', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await expect(rpc(USER2, 'public.room_set_state($1, $2)', [id, STATE])).rejects.toThrow(/не найдена/)
            await expect(rpc(USER2, 'public.room_close($1)', [id])).rejects.toThrow(/не найдена/)
            await expect(rpc(USER2, 'public.room_kick($1, $2)', [id, USER.sub])).rejects.toThrow(/не найдена/)
            await expect(rpc(USER2, 'public.room_invite($1, $2)', [id, STRANGER.sub])).rejects.toThrow(/не найдена/)
            await closeAllRooms()
        })

        it('room_info не раскрывает состояние и список участников', async () => {
            const id = await mkRoom(USER, 'Видно всем')
            await rpc(USER, 'public.room_set_state($1, $2)', [id, STATE])
            const info = await rpc(STRANGER, 'public.room_info($1)', [id])
            expect(Object.keys(info).sort()).toEqual(['capacity', 'closed', 'full', 'id', 'is_member', 'kicked', 'members', 'owner', 'title'])
            expect(info.members).toBe(1)
            await closeAllRooms()
        })

        it('админ управляет только через admin_*; обычный пользователь их не вызывает', async () => {
            const id = await mkRoom(USER)
            await expect(rpc(USER2, 'public.admin_user_room($1)', [USER.sub])).rejects.toThrow(/Нет доступа/)
            await expect(rpc(USER2, 'public.admin_room_close($1)', [id])).rejects.toThrow(/Нет доступа/)
            // Админ не участник, но закрыть может.
            await expect(rpc(ADMIN, 'public.room_get($1)', [id])).rejects.toThrow(/не найдена/)
            const card = await rpc(ADMIN, 'public.admin_user_room($1)', [USER.sub])
            expect(card).toMatchObject({ id, title: 'Тест', members: 1 })
            await rpc(ADMIN, 'public.admin_room_close($1)', [id])
            expect(await rpc(ADMIN, 'public.admin_user_room($1)', [USER.sub])).toBeNull()
            await expect(rpc(ADMIN, 'public.admin_room_close($1)', [id])).rejects.toThrow(/не найдена/)
            expect(await one('select closed_reason from public.rooms where id = $1', [id])).toEqual({ closed_reason: 'admin' })
            await closeAllRooms()
        })
    })

    describe('состояние: seq и время выдаёт база', () => {
        it('seq растёт на 1, at — часы сервера; клиенту их не подсунуть', async () => {
            const id = await mkRoom(USER)
            const before = Date.now()
            const a = await rpc(USER, 'public.room_set_state($1, $2)', [id, STATE])
            const b = await rpc(USER, 'public.room_set_state($1, $2)', [id, { ...STATE, pos_ms: 3000, playing: false }])
            expect(a.seq).toBe(1)
            expect(b.seq).toBe(2)
            expect(Number(a.at_ms)).toBeGreaterThanOrEqual(before - 1000)
            expect(Number(b.at_ms)).toBeGreaterThanOrEqual(Number(a.at_ms))
            expect(Number(b.at_ms)).toBeLessThanOrEqual(Date.now() + 1000)
            // «seq» и «at» внутри состояния — просто данные, номер выдаёт база.
            const c = await rpc(USER, 'public.room_set_state($1, $2)', [id, { ...STATE, seq: 999, at: 1 }])
            expect(c.seq).toBe(3)
            const room = await rpc(USER, 'public.room_get($1)', [id])
            expect(room.seq).toBe(3)
            expect(Number(room.at_ms)).toBe(Number(c.at_ms))
            expect(room.state.track_id).toBe('album-one/first-track')
            await closeAllRooms()
        })

        it('номера не начинаются заново после «перезагрузки» хозяина', async () => {
            const id = await mkRoom(USER)
            await rpc(USER, 'public.room_set_state($1, $2)', [id, STATE])
            await rpc(USER, 'public.room_set_state($1, $2)', [id, STATE])
            // Хозяин пришёл заново: get отдаёт seq, следующая запись продолжает с него.
            expect((await rpc(USER, 'public.room_get($1)', [id])).seq).toBe(2)
            expect((await rpc(USER, 'public.room_set_state($1, $2)', [id, STATE])).seq).toBe(3)
            await closeAllRooms()
        })

        it('мусорное состояние отклоняется', async () => {
            const id = await mkRoom(USER)
            const bad = async (state: unknown) => expect(rpc(USER, 'public.room_set_state($1, $2)', [id, state])).rejects.toThrow()
            await bad([])
            await bad({})
            await bad({ ...STATE, playing: 'yes' })
            await bad({ ...STATE, pos_ms: -1 })
            await bad({ ...STATE, pos_ms: 'x' })
            await bad({ ...STATE, pos_ms: 90_000_000 })
            await bad({ ...STATE, track_id: 'not a track' })
            await bad({ ...STATE, track_id: 5 })
            await bad({ playing: true, pos_ms: 1, track_id: null })
            await bad({ ...STATE, queue: [1] })
            await bad({ ...STATE, queue: { ids: 'я'.repeat(41_000) } })
            await expect(rpc(USER, 'public.room_set_state($1, null)', [id])).rejects.toThrow()
            // Пустое состояние «ничего не играет» допустимо.
            expect((await rpc(USER, 'public.room_set_state($1, $2)', [id, { queue: null, track_id: null, pos_ms: 0, playing: false }])).seq).toBe(1)
            await closeAllRooms()
        })

        it('server_now — миллисекунды по часам сервера', async () => {
            const t = Number(await rpc(USER, 'public.server_now()'))
            expect(Math.abs(t - Date.now())).toBeLessThan(5000)
        })
    })

    describe('исключение участника', () => {
        it('выгнанный выходит, не возвращается и не получает приглашений; эпоха растёт', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            expect((await rpc(USER, 'public.room_get($1)', [id])).epoch).toBe(0)
            expect(await rpc(USER, 'public.room_kick($1, $2)', [id, USER2.sub])).toEqual({ epoch: 1 })
            expect(await memberCount(id)).toBe(1)
            await expect(rpc(USER2, 'public.room_join($1)', [id])).rejects.toThrow(/выгнали/)
            expect(await rpc(USER2, 'public.room_info($1)', [id])).toMatchObject({ kicked: true, is_member: false })
            expect(await rpc(USER2, 'public.room_heartbeat($1)', [id])).toMatchObject({ member: false })
            await expect(rpc(USER2, 'public.room_get($1)', [id])).rejects.toThrow(/не найдена/)
            expect((await rpc(USER, 'public.room_get($1)', [id])).epoch).toBe(1)
            await closeAllRooms()
        })

        it('нельзя выгнать себя и того, кого нет в комнате', async () => {
            const id = await mkRoom(USER)
            await expect(rpc(USER, 'public.room_kick($1, $2)', [id, USER.sub])).rejects.toThrow(/Себя/)
            await expect(rpc(USER, 'public.room_kick($1, $2)', [id, STRANGER.sub])).rejects.toThrow(/нет в комнате/)
            await closeAllRooms()
        })

        it('после закрытия комнаты список выгнанных не копится', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await rpc(USER, 'public.room_kick($1, $2)', [id, USER2.sub])
            await rpc(USER, 'public.room_close($1)', [id])
            expect((await one('select count(*)::int n from public.room_kicks')).n).toBe(0)
            await closeAllRooms()
        })
    })

    describe('приглашения', () => {
        it('приглашать можно только друзей; приглашённый видит и принимает', async () => {
            await befriend(USER, USER2)
            const id = await mkRoom(USER)
            await expect(rpc(USER, 'public.room_invite($1, $2)', [id, STRANGER.sub])).rejects.toThrow(/только друзей/)
            await rpc(USER, 'public.room_invite($1, $2)', [id, USER2.sub])
            expect(await rpc(USER2, 'public.room_invites_count()')).toBe(1)
            const list = await rpc(USER2, 'public.room_invites_list()')
            expect(list).toHaveLength(1)
            expect(list[0]).toMatchObject({ room_id: id, title: 'Тест', from: { nick: 'Яна' } })
            // Чужие приглашения не видны.
            expect(await rpc(STRANGER, 'public.room_invites_count()')).toBe(0)
            await expect(rpc(USER, 'public.room_invite($1, $2)', [id, USER.sub])).rejects.toThrow()
            await rpc(USER2, 'public.room_join($1)', [id])
            expect(await rpc(USER2, 'public.room_invites_count()')).toBe(0)
            await expect(rpc(USER, 'public.room_invite($1, $2)', [id, USER2.sub])).rejects.toThrow(/Уже в комнате/)
            await closeAllRooms()
        })

        it('отклонить; закрытая комната и выгнанный; не больше 40 в час', async () => {
            await befriend(USER, USER2)
            const id = await mkRoom(USER)
            await rpc(USER, 'public.room_invite($1, $2)', [id, USER2.sub])
            await rpc(USER2, 'public.room_invite_dismiss($1)', [id])
            expect(await rpc(USER2, 'public.room_invites_count()')).toBe(0)
            await rpc(USER, 'public.room_invite($1, $2)', [id, USER2.sub])
            await rpc(USER, 'public.room_close($1)', [id])
            expect(await rpc(USER2, 'public.room_invites_count()')).toBe(0)

            const id2 = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id2])
            await rpc(USER, 'public.room_kick($1, $2)', [id2, USER2.sub])
            await expect(rpc(USER, 'public.room_invite($1, $2)', [id2, USER2.sub])).rejects.toThrow(/выгнали/)

            await closeAllRooms()
            const id3 = await mkRoom(USER)
            for (let i = 0; i < 40; i++) await rpc(USER, 'public.room_invite($1, $2)', [id3, USER2.sub])
            await expect(rpc(USER, 'public.room_invite($1, $2)', [id3, USER2.sub])).rejects.toThrow(/Слишком много приглашений/)
        })
    })

    describe('статистика', () => {
        it('каждый участник засчитывается отдельно: трек попадает в «мой топ» гостя со своим user_id', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            // Хозяин и гость слушают один трек в комнате: обычное прослушивание у каждого.
            await as(db, 'authenticated', USER, "select public.increment_play_count('album-one-2')")
            await as(db, 'authenticated', USER2, "select public.increment_play_count('album-one-2')")
            await as(db, 'authenticated', USER2, "select public.increment_play_count('album-one-2')")
            expect(await rpc(USER2, 'public.user_top($1, null)', [USER2.sub])).toEqual([{ track_key: 'album-one-2', plays: 2 }])
            expect(await rpc(USER, 'public.user_top($1, null)', [USER.sub])).toEqual([{ track_key: 'album-one-2', plays: 1 }])
            // Чужой топ гость не видит (если они не друзья).
            await expect(rpc(USER2, 'public.user_top($1, null)', [USER.sub])).rejects.toThrow(/Нет доступа/)
            const rows = (await db.query<any>("select user_id from public.play_events where track_key = 'album-one-2' order by user_id")).rows
            expect(rows.map((r) => r.user_id).sort()).toEqual([USER.sub, USER2.sub, USER2.sub].sort())
        })
    })

    describe('закрытие', () => {
        it('хозяин закрывает: все выходят и могут войти в другую комнату', async () => {
            const a = await mkRoom(USER, 'А')
            await rpc(USER2, 'public.room_join($1)', [a])
            await rpc(USER, 'public.room_close($1)', [a])
            expect(await rpc(USER2, 'public.room_my()')).toBeNull()
            expect(await rpc(USER2, 'public.room_heartbeat($1)', [a])).toMatchObject({ member: false, closed: true })
            const b = await mkRoom(OWNER, 'Б')
            await rpc(USER2, 'public.room_join($1)', [b])
            await closeAllRooms()
        })

        it('30 минут без признаков жизни — комната закрывается при обращении', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await db.exec(`update public.rooms set last_activity = now() - interval '29 minutes' where id = '${id}'`)
            await rpc(STRANGER, 'public.room_info($1)', [id]) // чужое обращение запускает уборку
            expect((await rpc(USER2, 'public.room_my()'))?.id).toBe(id)
            await db.exec(`update public.rooms set last_activity = now() - interval '31 minutes' where id = '${id}'`)
            expect(await rpc(STRANGER, 'public.room_info($1)', [id])).toEqual({ closed: true })
            expect(await one('select closed_reason from public.rooms where id = $1', [id])).toEqual({ closed_reason: 'idle' })
            expect(await rpc(USER2, 'public.room_my()')).toBeNull()
            expect(await memberCount(id)).toBe(0)
            // Хозяин может сразу создать новую.
            await mkRoom(USER)
            await closeAllRooms()
        })

        it('сердцебиение продлевает комнату', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await db.exec(`update public.rooms set last_activity = now() - interval '29 minutes' where id = '${id}'`)
            expect(await rpc(USER2, 'public.room_heartbeat($1)', [id])).toMatchObject({ member: true, closed: false, epoch: 0 })
            await db.exec(`update public.rooms set last_activity = last_activity where id = '${id}'`)
            const row = await one('select (last_activity > now() - interval \'1 minute\') as fresh from public.rooms where id = $1', [id])
            expect(row.fresh).toBe(true)
            await closeAllRooms()
        })

        it('давно пропавшие гости выходят, хозяин остаётся', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await db.exec(`update public.room_members set last_seen = now() - interval '11 minutes' where room_id = '${id}'`)
            await rpc(STRANGER, 'public.room_info($1)', [id])
            expect(await memberCount(id)).toBe(1)
            expect((await rpc(USER, 'public.room_get($1)', [id])).members.map((m: any) => m.nick)).toEqual(['Яна'])
            await closeAllRooms()
        })
    })

    describe('бан и удаление аккаунта', () => {
        it('бан хозяина закрывает его комнату и выводит всех', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER.sub}'`)
            expect(await one('select closed_reason from public.rooms where id = $1', [id])).toEqual({ closed_reason: 'owner_blocked' })
            expect(await memberCount(id)).toBe(0)
            expect(await rpc(USER2, 'public.room_my()')).toBeNull()
            await db.exec(`update auth.users set banned_until = null where id = '${USER.sub}'`)
            await closeAllRooms()
        })

        it('бан гостя выводит его из чужой комнаты, комната живёт', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await rpc(USER, 'public.room_invite($1, $2)', [id, STRANGER.sub]).catch(() => undefined)
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER2.sub}'`)
            expect(await memberCount(id)).toBe(1)
            expect((await one('select closed_at from public.rooms where id = $1', [id])).closed_at).toBeNull()
            await db.exec(`update auth.users set banned_until = null where id = '${USER2.sub}'`)
            await closeAllRooms()
        })

        it('мягкое и полное удаление: комната закрыта или исчезла, гость свободен', async () => {
            const id = await mkRoom(STRANGER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await db.exec(`update auth.users set deleted_at = now() where id = '${STRANGER.sub}'`)
            expect(await one('select closed_reason from public.rooms where id = $1', [id])).toEqual({ closed_reason: 'owner_blocked' })
            expect(await rpc(USER2, 'public.room_my()')).toBeNull()
            await db.exec(`update auth.users set deleted_at = null where id = '${STRANGER.sub}'`)
            await closeAllRooms()

            const id2 = await mkRoom(crowd(5), 'Удаляемая')
            await rpc(crowd(6), 'public.room_join($1)', [id2])
            await db.exec(`delete from auth.users where id = '${uid(5)}'`)
            expect(await one('select count(*)::int n from public.rooms where id = $1', [id2])).toEqual({ n: 0 })
            expect(await rpc(crowd(6), 'public.room_my()')).toBeNull()
            // Участник можно удалить, пока он в чужой комнате.
            const id3 = await mkRoom(crowd(7))
            await rpc(crowd(8), 'public.room_join($1)', [id3])
            await db.exec(`delete from auth.users where id = '${uid(8)}'`)
            expect(await memberCount(id3)).toBe(1)
            await closeAllRooms()
        })
    })

    describe('Realtime Authorization (realtime.messages)', () => {
        const topic = (id: string, epoch = 0) => `room:${id}:${epoch}`
        const setTopic = (t: string) => db.query('select set_config($1, $2, false)', ['realtime.topic', t])
        /** Видит ли пользователь сообщения канала (политика select). */
        const canListen = async (claims: object, t: string, role = 'authenticated') => {
            await setTopic(t)
            try {
                return Number((await as(db, role, claims, 'select count(*)::int n from realtime.messages')).rows[0].n) > 0
            } catch (e) {
                // У anon нет даже прав на таблицу — это тоже отказ.
                if (/permission denied/.test((e as Error).message)) return false
                throw e
            }
        }
        /** Принимает ли канал отправку от пользователя (политика insert). */
        const canSend = async (claims: object, t: string, extension: string) => {
            await setTopic(t)
            try {
                await as(db, 'authenticated', claims, 'insert into realtime.messages (topic, extension, payload) values ($1, $2, $3)', [t, extension, '{}'])
                return true
            } catch (e) {
                if (/row-level security/.test((e as Error).message)) return false
                throw e
            }
        }
        beforeAll(async () => {
            await db.exec(`insert into realtime.messages (topic, extension, payload) values ('x', 'broadcast', '{}')`)
        })

        it('слушают участники; чужой, не вошедший и анонимный — нет', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            expect(await canListen(USER, topic(id))).toBe(true)
            expect(await canListen(USER2, topic(id))).toBe(true)
            expect(await canListen(STRANGER, topic(id))).toBe(false)
            expect(await canListen(ADMIN, topic(id))).toBe(false)
            expect(await canListen(ANON, topic(id), 'anon')).toBe(false)
            await closeAllRooms()
        })

        it('команды шлёт только хозяин; присутствие объявляют участники', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            expect(await canSend(USER, topic(id), 'broadcast')).toBe(true)
            expect(await canSend(USER2, topic(id), 'broadcast')).toBe(false)
            expect(await canSend(STRANGER, topic(id), 'broadcast')).toBe(false)
            expect(await canSend(USER2, topic(id), 'presence')).toBe(true)
            expect(await canSend(USER, topic(id), 'presence')).toBe(true)
            expect(await canSend(STRANGER, topic(id), 'presence')).toBe(false)
            // Неизвестный вид сообщений запрещён всем.
            expect(await canSend(USER, topic(id), 'postgres_changes')).toBe(false)
            await closeAllRooms()
        })

        it('выгнанный теряет доступ: старая эпоха закрыта для всех, новая — только для оставшихся', async () => {
            const id = await mkRoom(USER)
            await rpc(USER2, 'public.room_join($1)', [id])
            await rpc(STRANGER, 'public.room_join($1)', [id])
            await rpc(USER, 'public.room_kick($1, $2)', [id, STRANGER.sub])
            expect(await canListen(STRANGER, topic(id, 0))).toBe(false)
            expect(await canListen(STRANGER, topic(id, 1))).toBe(false)
            expect(await canListen(USER2, topic(id, 1))).toBe(true)
            // Старый топик закрыт и для оставшихся: переезд на новый обязателен.
            expect(await canListen(USER2, topic(id, 0))).toBe(false)
            // Хозяин может сообщить «тебя выгнали» по старому топику (одна эпоха назад)…
            expect(await canSend(USER, topic(id, 0), 'broadcast')).toBe(true)
            expect(await canSend(USER2, topic(id, 0), 'broadcast')).toBe(false)
            expect(await canSend(STRANGER, topic(id, 0), 'broadcast')).toBe(false)
            expect(await canSend(USER, topic(id, 1), 'broadcast')).toBe(true)
            // …а позже — нет: через две эпохи старый топик закрыт и для хозяина.
            await rpc(USER2, 'public.room_join($1)', [id]).catch(() => undefined)
            await rpc(USER, 'public.room_kick($1, $2)', [id, USER2.sub])
            expect(await canSend(USER, topic(id, 0), 'broadcast')).toBe(false)
            expect(await canSend(USER, topic(id, 1), 'broadcast')).toBe(true)
            expect(await canSend(USER, topic(id, 2), 'broadcast')).toBe(true)
            // Вернуться по ссылке выгнанный тоже не может.
            await expect(rpc(STRANGER, 'public.room_join($1)', [id])).rejects.toThrow(/выгнали/)
            expect(await canListen(STRANGER, topic(id, 1))).toBe(false)
            await closeAllRooms()
        })

        it('закрытая комната, бан, чужой uuid и кривые топики — отказ', async () => {
            const id = await mkRoom(USER)
            const other = await mkRoom(USER2)
            expect(await canListen(USER, topic(other))).toBe(false)
            for (const bad of ['', `room:${id}`, `room:${id}:x`, `room:${id}:0:1`, `Room:${id}:0`, `room:${id.toUpperCase()}:0`, `room:${id}:99999999999`, 'room:not-a-uuid:0', `realtime:room:${id}:0`]) {
                expect(await canListen(USER, bad), bad).toBe(false)
                expect(await canSend(USER, bad, 'broadcast'), bad).toBe(false)
            }
            await db.exec(`update auth.users set banned_until = now() + interval '1 day' where id = '${USER2.sub}'`)
            expect(await canListen(USER2, topic(other))).toBe(false)
            await db.exec(`update auth.users set banned_until = null where id = '${USER2.sub}'`)
            await rpc(USER, 'public.room_close($1)', [id])
            expect(await canListen(USER, topic(id))).toBe(false)
            expect(await canSend(USER, topic(id), 'broadcast')).toBe(false)
            await closeAllRooms()
        })

        it('других политик на realtime.messages нет', async () => {
            const rows = (await db.query<{ policyname: string }>(`select policyname from pg_policies where schemaname = 'realtime' and tablename = 'messages' order by 1`)).rows
            expect(rows.map((r) => r.policyname)).toEqual(['rooms: members announce presence', 'rooms: members listen', 'rooms: owner sends commands'])
        })
    })

    describe('скрипт аудита', () => {
        it('rooms_audit.sql выполняется и подтверждает: таблицы закрыты, три политики Realtime, функции без anon', async () => {
            const sql = fs.readFileSync(path.join(REPO, 'supabase/audit/rooms_audit.sql'), 'utf8')
            // Несколько запросов в одном файле: исполняем по одному.
            const statements = sql.split(/;\s*\n/).map((t) => t.trim()).filter((t) => /^select/im.test(t.replace(/^(--.*\n)+/gm, '')))
            const rows: { section: string; item: string; value: string }[] = []
            for (const st of statements) rows.push(...(await db.query<any>(st)).rows)
            const of = (prefix: string) => rows.filter((r) => r.section.startsWith(prefix))
            expect(of('1 rls').map((r) => r.value)).toEqual(['true', 'true', 'true', 'true'])
            expect(of('2 table grants')).toEqual([])
            expect(of('3 table policies')).toEqual([])
            expect(of('4 realtime').map((r) => r.item)).toEqual(['rooms: members announce presence', 'rooms: members listen', 'rooms: owner sends commands'])
            expect(of('5 functions').filter((r) => r.value.includes('anon=true'))).toEqual([])
            const internal = of('5 functions').filter((r) => /^(rooms_sweep|room_close_internal|room_json|require_own_room|epoch_ms|rooms_on_user_blocked)/.test(r.item))
            expect(internal.every((r) => r.value.includes('authenticated=false'))).toBe(true)
            expect(of('6 search_path').every((r) => r.value.includes("search_path=\"\""))).toBe(true)
            expect(of('7 trigger')).toHaveLength(1)
        })
    })
})
