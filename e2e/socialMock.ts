// «Музыка и друзья» в e2e: RPC сайта и админки выполняются настоящими
// SQL-функциями из supabase/migrations на PGlite — тесты проверяют те же
// права и лимиты, что в проде. Бакет playlist-covers: права — через
// storage.objects в той же базе, байты картинок — в памяти.
import type { PGlite } from '@electric-sql/pglite'
import { applyMigrations, createDb } from '../supabase/tests/pgHarness'
import { nickKey } from '../supabase/functions/_shared/accounts.ts'
import type { MockUser, SocialHooks } from './accountsMock'

/** RPC этапа, которые сайт и админка вызывают через PostgREST. */
export const SOCIAL_RPCS = [
    'favorite_set',
    'user_favorites',
    'playlist_create',
    'playlist_update',
    'playlist_delete',
    'playlist_add_track',
    'playlist_remove_track',
    'playlist_reorder',
    'playlist_set_cover',
    'playlist_get',
    'user_playlists',
    'user_top',
    'now_playing_set',
    'friend_request',
    'friend_respond',
    'friend_cancel',
    'friend_remove',
    'friends_list',
    'friend_requests_count',
    'user_search',
    'profile_by_nick',
    'admin_user_social',
    // Топ-4 и лента (этап 5)
    'user_top4',
    'top4_set',
    'feed_prefs_get',
    'feed_prefs_set',
    'friends_feed',
    // Комнаты (этап 4)
    'server_now',
    'room_create',
    'room_join',
    'room_leave',
    'room_close',
    'room_get',
    'room_my',
    'room_info',
    'room_set_state',
    'room_heartbeat',
    'room_kick',
    'room_invite',
    'room_invites_list',
    'room_invites_count',
    'room_invite_dismiss',
    'admin_user_room',
    'admin_room_close',
    // Итоги года
    'my_recap_state',
    'year_recap',
    'admin_recap_overview',
    'admin_recap_status',
    'admin_recap_set'
] as const

const COVERS = 'playlist-covers'

export interface MockResponse {
    status: number
    body: unknown
}

// Ошибки Postgres → ответ PostgREST (код и текст, как видит supabase-js).
function pgError(e: unknown): MockResponse {
    const err = e as { code?: string; message?: string }
    const status = err.code === '42501' ? 403 : err.code === 'P0002' ? 404 : 400
    return { status, body: { code: err.code ?? 'XX000', message: err.message ?? 'error', details: null, hint: null } }
}

export class SocialBackend {
    private dbPromise: Promise<PGlite>
    private queue: Promise<unknown> = Promise.resolve()
    /** Загруженные обложки: путь → байты. */
    readonly covers = new Map<string, { body: Buffer; type: string }>()
    readonly nowPlayingCalls: string[] = []

    constructor(users: MockUser[]) {
        this.dbPromise = (async () => {
            const db = await createDb()
            await applyMigrations(db)
            // Пользователи pgHarness не нужны: заменяем аккаунтами e2e
            // (владелец — только в обход защиты, как в SQL Editor).
            await db.exec("begin; set local app.owner_override = 'on'; delete from auth.users; commit;")
            await db.exec("begin; set local app.owner_override = 'on';")
            for (const u of users) {
                await db.query('insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3)', [u.id, u.email, JSON.stringify(u.role ? { role: u.role } : {})])
                await db.query('insert into public.profiles (id, nick, nick_key) values ($1, $2, $3)', [u.id, u.nick, nickKey(u.nick)])
            }
            await db.exec('commit;')
            return db
        })()
    }

    /** База одна на тест: запросы — строго по очереди (роль и claims — на соединение). */
    private run<T>(fn: (db: PGlite) => Promise<T>): Promise<T> {
        const next = this.queue.then(async () => fn(await this.dbPromise))
        this.queue = next.catch(() => undefined)
        return next
    }

    private async asUser<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
        const claims = userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' }
        await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role ${userId ? 'authenticated' : 'anon'};`)
        try {
            return await fn()
        } finally {
            await db.exec('reset role;')
        }
    }

    ready(): Promise<void> {
        return this.run(async () => undefined)
    }

    /** RPC от имени вошедшего; null — не наша функция. */
    rpc(name: string, args: Record<string, unknown>, userId: string | null): Promise<MockResponse> | null {
        if (!(SOCIAL_RPCS as readonly string[]).includes(name)) return null
        if (name === 'now_playing_set') this.nowPlayingCalls.push(String(args.p_track_id))
        return this.run(async (db) => {
            const keys = Object.keys(args)
            const params = keys.map((k) => args[k])
            const named = keys.map((k, i) => `${k} => $${i + 1}${Array.isArray(args[k]) ? (k === 'p_users' ? '::uuid[]' : '::text[]') : ''}`).join(', ')
            try {
                const { rows } = await this.asUser(db, userId, () => db.query<{ r: unknown }>(`select public.${name}(${named}) as r`, params))
                const value = rows[0]?.r ?? null
                return value === '' || value === null ? { status: 200, body: null } : { status: 200, body: value }
            } catch (e) {
                return pgError(e)
            }
        })
    }

    // ── Storage: playlist-covers ───────────────────────────────────────

    /** Загрузка (upsert): права проверяют политики storage.objects. */
    upload(userId: string | null, name: string, body: Buffer, type: string): Promise<MockResponse> {
        return this.run(async (db) => {
            try {
                const done = await this.asUser(db, userId, async () => {
                    const existing = await db.query('update storage.objects set owner = owner where bucket_id = $1 and name = $2 returning id', [COVERS, name])
                    if (existing.rows.length) return true
                    await db.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [COVERS, name])
                    return true
                })
                if (done) this.covers.set(name, { body, type })
                return { status: 200, body: { Key: `${COVERS}/${name}`, Id: name } }
            } catch {
                return { status: 403, body: { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' } }
            }
        })
    }

    remove(userId: string | null, names: string[]): Promise<MockResponse> {
        return this.run(async (db) => {
            const { rows } = await this.asUser(db, userId, () =>
                db.query<{ name: string }>('delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name', [COVERS, names])
            )
            for (const r of rows) this.covers.delete(r.name)
            return { status: 200, body: rows.map((r) => ({ name: r.name })) }
        })
    }

    /** Подписанные ссылки — только на то, что вошедшему видно. */
    sign(userId: string | null, paths: string[]): Promise<MockResponse> {
        return this.run(async (db) => {
            const { rows } = await this.asUser(db, userId, () =>
                db.query<{ name: string }>('select name from storage.objects where bucket_id = $1 and name = any($2::text[])', [COVERS, paths])
            )
            const visible = new Set(rows.map((r) => r.name))
            return {
                status: 200,
                body: paths.map((p) =>
                    visible.has(p) && this.covers.has(p)
                        ? { path: p, error: null, signedURL: `/object/sign/${COVERS}/${p}?token=e2e` }
                        : { path: p, error: 'Either the object does not exist or you do not have access to it', signedURL: null }
                )
            }
        })
    }

    file(name: string): { body: Buffer; type: string } | null {
        return this.covers.get(name) ?? null
    }

    // ── Для функции admin-users (service role) ─────────────────────────

    hooks(): SocialHooks {
        return {
            playlistById: (id) =>
                this.run(async (db) => {
                    const { rows } = await db.query<{ id: string; owner_id: string; title: string; cover_version: string | null }>(
                        'select id, owner_id, title, cover_version from public.playlists where id = $1',
                        [id]
                    )
                    const p = rows[0]
                    return p ? { ...p, cover_version: p.cover_version === null ? null : Number(p.cover_version) } : null
                }),
            updatePlaylist: (id, patch) =>
                this.run(async (db) => {
                    if (patch.title !== undefined) await db.query('update public.playlists set title = $2, updated_at = now() where id = $1', [id, patch.title])
                    if (patch.cover_version === null) await db.query('update public.playlists set cover_version = null, updated_at = now() where id = $1', [id])
                }),
            deletePlaylist: (id) =>
                this.run(async (db) => {
                    await db.query('delete from public.playlists where id = $1', [id])
                }),
            removeCover: (nameOrPrefix) => {
                void this.run(async (db) => {
                    const prefix = nameOrPrefix.endsWith('/')
                    const { rows } = await db.query<{ name: string }>(
                        prefix
                            ? 'delete from storage.objects where bucket_id = $1 and name like $2 || \'%\' returning name'
                            : 'delete from storage.objects where bucket_id = $1 and name = $2 returning name',
                        [COVERS, nameOrPrefix]
                    )
                    for (const r of rows) this.covers.delete(r.name)
                })
            }
        }
    }

    /**
     * Политика Realtime для канала комнаты — настоящая функция базы
     * (room_topic_access, на ней стоят политики realtime.messages).
     */
    roomAccess(userId: string | null, topic: string, ownerOnly: boolean): Promise<boolean> {
        if (!userId) return Promise.resolve(false)
        return this.run(async (db) => {
            // Канал реакций (roomfx:…) — свои правила: пишут и слушают все участники
            // (room_react_access, на ней стоят политики «members send/hear reactions»).
            const { rows } = topic.startsWith('roomfx:')
                ? await this.asUser(db, userId, () => db.query<{ ok: boolean }>('select public.room_react_access($1) as ok', [topic]))
                : await this.asUser(db, userId, () => db.query<{ ok: boolean }>('select public.room_topic_access($1, $2) as ok', [topic, ownerOnly]))
            return rows[0]?.ok === true
        })
    }

    /** Прямой запрос к базе (подготовка данных в тесте), без ролей. */
    sql<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
        return this.run(async (db) => (await db.query<T>(query, params)).rows)
    }
}

/** Ответы без базы — для тестов, которые этап не проверяют. */
export function socialStub(name: string): MockResponse | null {
    if (!(SOCIAL_RPCS as readonly string[]).includes(name)) return null
    switch (name) {
        case 'user_favorites':
        case 'user_playlists':
        case 'user_search':
        case 'user_top':
        case 'user_top4':
        case 'top4_set':
            return { status: 200, body: [] }
        case 'feed_prefs_get':
        case 'feed_prefs_set':
            return { status: 200, body: { hide_listens: false } }
        case 'friends_feed':
            return { status: 200, body: { events: [], has_more: false } }
        case 'friend_requests_count':
        case 'room_invites_count':
            return { status: 200, body: 0 }
        case 'room_invites_list':
            return { status: 200, body: [] }
        case 'room_my':
        case 'admin_user_room':
            return { status: 200, body: null }
        case 'friends_list':
            return { status: 200, body: { friends: [], incoming: [], outgoing: [] } }
        case 'server_now':
            return { status: 200, body: Date.now() }
        case 'now_playing_set':
        case 'profile_by_nick':
        case 'my_recap_state': // итоги не открыты — на сайте нет и следа
            return { status: 200, body: null }
        default:
            return { status: 400, body: { code: '22023', message: 'В этом тесте база «Музыки и друзей» не подключена' } }
    }
}
