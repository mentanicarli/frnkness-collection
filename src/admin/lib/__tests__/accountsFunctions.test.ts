// @vitest-environment node
/**
 * Edge Functions аккаунтов (register, recovery-request, account,
 * admin-users) на фейковых Auth, базе и капче.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
    type AccountsDeps,
    type AccountPrivate,
    type AuthUser,
    type Playlist,
    type Profile,
    LIMITS,
    adminPermission,
    createAccountHandler,
    createAdminUsersHandler,
    createRecoveryHandler,
    createRegisterHandler
} from '../../../../supabase/functions/_shared/accountsCore.ts'
import { nickKey, techEmail } from '../../../../supabase/functions/_shared/accounts.ts'

interface FakeUser extends AuthUser {
    password: string
}

let users: Map<string, FakeUser>
let profiles: Map<string, Profile>
let privs: Map<string, AccountPrivate>
let recovery: { nick: string; nick_key: string; user_id: string | null; contact: string; comment: string }[]
let limits: Map<string, number>
let signedOut: string[]
let avatarsRemoved: string[]
let playlists: Map<string, Playlist>
let coversRemoved: string[]
let captchaCalls: URLSearchParams[]
let now: number
let nextId: number
let deps: AccountsDeps

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

async function addUser(nick: string, password: string, role?: 'admin' | 'owner'): Promise<string> {
    const id = uuid(nextId++)
    users.set(id, { id, email: await techEmail(nick), password, app_metadata: role ? { role } : { role: 'user' } })
    profiles.set(id, { id, nick, nick_key: nickKey(nick), avatar: 'initials:0', bio: '' })
    privs.set(id, { must_change_password: false, nick_changed_at: null })
    return id
}

function setup() {
    users = new Map()
    profiles = new Map()
    privs = new Map()
    recovery = []
    limits = new Map()
    signedOut = []
    avatarsRemoved = []
    playlists = new Map()
    coversRemoved = []
    captchaCalls = []
    now = Date.parse('2026-10-06T12:00:00Z')
    nextId = 1
    deps = {
        env: { turnstileSecret: 'ts-secret', hashSecret: 'hash-secret' },
        fetch: (async (_url: string, init?: RequestInit) => {
            const form = init!.body as URLSearchParams
            captchaCalls.push(form)
            return new Response(JSON.stringify({ success: form.get('response') === 'good-captcha' }))
        }) as typeof fetch,
        now: () => now,
        auth: {
            async getUser(jwt) {
                const id = jwt.replace(/^jwt-/, '')
                const u = users.get(id)
                return u ? { ...u } : null
            },
            async getUserById(id) {
                const u = users.get(id)
                return u ? { ...u } : null
            },
            async createUser(email, password) {
                if ([...users.values()].some((u) => u.email === email)) return 'exists'
                const id = uuid(nextId++)
                users.set(id, { id, email, password, app_metadata: { role: 'user' } })
                return { id }
            },
            async updateUser(id, update) {
                const u = users.get(id)!
                if (update.email && [...users.values()].some((o) => o.id !== id && o.email === update.email)) throw new Error('exists')
                if (update.role === 'admin' || update.role === 'user') {
                    if (u.app_metadata?.role === 'owner') throw new Error('Владельца нельзя понизить')
                    u.app_metadata = { ...u.app_metadata, role: update.role }
                }
                if (update.password !== undefined) u.password = update.password
                if (update.email !== undefined) u.email = update.email
                if (update.ban !== undefined) u.banned_until = update.ban ? '2126-01-01T00:00:00Z' : null
            },
            async deleteUser(id) {
                if (users.get(id)?.app_metadata?.role === 'owner') throw new Error('Владельца нельзя удалить')
                users.delete(id)
                profiles.delete(id)
                privs.delete(id)
            },
            async verifyPassword(email, password) {
                return [...users.values()].some((u) => u.email === email && u.password === password)
            }
        },
        db: {
            async rateLimit(action, key, max) {
                const k = `${action}:${key}`
                const used = limits.get(k) ?? 0
                if (used >= max) return false
                limits.set(k, used + 1)
                return true
            },
            async profileById(id) {
                return profiles.get(id) ?? null
            },
            async profileByKey(key) {
                return [...profiles.values()].find((p) => p.nick_key === key) ?? null
            },
            async insertProfile(p) {
                if ([...profiles.values()].some((o) => o.nick_key === p.nick_key)) return false
                profiles.set(p.id, { ...p, avatar: 'initials:0', bio: '' })
                return true
            },
            async updateProfile(id, patch) {
                if (patch.nick_key && [...profiles.values()].some((o) => o.id !== id && o.nick_key === patch.nick_key)) return false
                profiles.set(id, { ...profiles.get(id)!, ...patch })
                return true
            },
            async getPrivate(id) {
                return privs.get(id) ?? null
            },
            async upsertPrivate(id, patch) {
                privs.set(id, { must_change_password: false, nick_changed_at: null, ...privs.get(id), ...patch })
            },
            async insertRecovery(r) {
                recovery.push(r)
            },
            async signOutUser(id) {
                signedOut.push(id)
            },
            async playlistById(id) {
                return playlists.get(id) ?? null
            },
            async updatePlaylist(id, patch) {
                playlists.set(id, { ...playlists.get(id)!, ...patch })
            },
            async deletePlaylist(id) {
                playlists.delete(id)
            }
        },
        storage: {
            async removeAvatar(id) {
                avatarsRemoved.push(id)
            },
            async removePlaylistCover(ownerId, playlistId) {
                coversRemoved.push(`${ownerId}/${playlistId}`)
            },
            async removePlaylistCovers(userId) {
                coversRemoved.push(`${userId}/`)
            }
        }
    }
}

beforeEach(setup)

function request(fn: string, body: unknown, opts: { jwt?: string; ip?: string; origin?: string | null; method?: string } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-forwarded-for': `${opts.ip ?? '1.2.3.4'}, 10.0.0.1` }
    if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`
    const origin = opts.origin === undefined ? 'https://frnkness.ru' : opts.origin
    if (origin) headers.Origin = origin
    return new Request(`https://x.supabase.co/functions/v1/${fn}`, {
        method: opts.method ?? 'POST',
        headers,
        body: opts.method === 'OPTIONS' ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    })
}

async function send(handler: (r: Request) => Promise<Response>, req: Request) {
    const res = await handler(req)
    return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers }
}

const register = (body: Record<string, unknown>, ip?: string) =>
    send(createRegisterHandler(deps), request('register', { agree: true, captchaToken: 'good-captcha', ...body }, { ip }))
const recover = (body: Record<string, unknown>, ip?: string) =>
    send(createRecoveryHandler(deps), request('recovery-request', { captchaToken: 'good-captcha', ...body }, { ip }))
const account = (id: string, body: Record<string, unknown>) => send(createAccountHandler(deps), request('account', body, { jwt: `jwt-${id}` }))
const adminCall = (id: string, body: Record<string, unknown>) => send(createAdminUsersHandler(deps), request('admin-users', body, { jwt: `jwt-${id}` }))

describe('общее: CORS и формат', () => {
    it('preflight с frnkness.ru и localhost, чужой сайт — 403', async () => {
        const h = createRegisterHandler(deps)
        expect((await h(request('register', null, { method: 'OPTIONS' }))).status).toBe(204)
        expect((await h(request('register', null, { method: 'OPTIONS', origin: 'http://localhost:5173' }))).headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
        expect((await send(h, request('register', {}, { origin: 'https://evil.example' }))).status).toBe(403)
    })

    it('не JSON — 400; неожиданная ошибка не раскрывает подробностей', async () => {
        expect((await send(createRegisterHandler(deps), request('register', 'not json'))).status).toBe(400)
        deps.db.profileByKey = async () => {
            throw new Error('секретная подробность базы')
        }
        const res = await register({ nick: 'нормальный', password: 'password1' })
        expect(res.status).toBe(500)
        expect(JSON.stringify(res.body)).not.toContain('секрет')
    })
})

describe('register', () => {
    it('создаёт аккаунт с техническим адресом, профиль и роль user', async () => {
        const res = await register({ nick: 'Ёжик_1', password: 'password1' })
        expect(res).toMatchObject({ status: 200, body: { ok: true } })
        const user = [...users.values()][0]
        expect(user.email).toBe(await techEmail('ежик_1'))
        expect(user.app_metadata).toEqual({ role: 'user' })
        expect(profiles.get(user.id)).toMatchObject({ nick: 'Ёжик_1', nick_key: nickKey('ежик_1') })
        // Капча проверена на сервере Cloudflare с IP клиента.
        expect(captchaCalls[0].get('secret')).toBe('ts-secret')
        expect(captchaCalls[0].get('remoteip')).toBe('1.2.3.4')
    })

    it('без капчи, с плохой капчей, без согласия — отказ, аккаунт не создаётся', async () => {
        expect((await register({ nick: 'nick1', password: 'password1', captchaToken: 'bad' })).body.error.code).toBe('captcha')
        expect((await register({ nick: 'nick1', password: 'password1', captchaToken: undefined })).body.error.code).toBe('captcha')
        expect((await register({ nick: 'nick1', password: 'password1', agree: false })).body.error.code).toBe('agree')
        expect(users.size).toBe(0)
    })

    it('без секрета капчи регистрация закрыта', async () => {
        deps.env.turnstileSecret = undefined
        expect((await register({ nick: 'nick1', password: 'password1' })).body.error.code).toBe('captcha')
    })

    it.each([
        ['ab', 'password1', /от 3 до 20/],
        ['admin', 'password1', /занят/],
        ['ник пробел', 'password1', /только/],
        ['nick1', 'short', /минимум 8/],
        ['nickname', 'NICKNAME', /не должен совпадать/]
    ])('правила: %s / %s', async (nick, password, re) => {
        const res = await register({ nick, password })
        expect(res.status).toBe(400)
        expect(res.body.error.message).toMatch(re)
    })

    it('занятый ник с другим регистром и похожими буквами — 409', async () => {
        await addUser('Ян_1', 'password1')
        for (const nick of ['ян_1', 'ЯН.1', 'Ян-1']) {
            const res = await register({ nick, password: 'password1' })
            expect(res.status).toBe(409)
            expect(res.body.error.message).toBe('Этот ник занят')
        }
    })

    it('гонка: адрес уже есть в Auth — 409, профиль не создаётся', async () => {
        users.set('x', { id: 'x', email: await techEmail('гонка'), password: 'p', app_metadata: {} })
        expect((await register({ nick: 'гонка', password: 'password1' })).status).toBe(409)
        expect(profiles.size).toBe(0)
    })

    it(`лимит: ${LIMITS.registerPerIpDay} регистраций с IP в сутки`, async () => {
        for (let i = 0; i < LIMITS.registerPerIpDay; i++) expect((await register({ nick: `user${i}x`, password: 'password1' }, '5.5.5.5')).status).toBe(200)
        expect((await register({ nick: 'oneMore', password: 'password1' }, '5.5.5.5')).status).toBe(429)
        expect((await register({ nick: 'otherIp', password: 'password1' }, '6.6.6.6')).status).toBe(200)
        // В лимитах — хеш, а не IP.
        expect([...limits.keys()].join()).not.toContain('5.5.5.5')
    })
})

describe('recovery-request', () => {
    it('одинаковый ответ для существующего и несуществующего ника', async () => {
        const id = await addUser('есть', 'password1')
        const a = await recover({ nick: 'ЕСТЬ', contact: '@tg', comment: 'забыл' })
        const b = await recover({ nick: 'нету', contact: '@tg2' }, '9.9.9.9')
        expect(a).toEqual({ ...a, status: 200, body: { ok: true } })
        expect(b.body).toEqual(a.body)
        expect(recovery).toEqual([
            { nick: 'ЕСТЬ', nick_key: nickKey('есть'), user_id: id, contact: '@tg', comment: 'забыл' },
            { nick: 'нету', nick_key: nickKey('нету'), user_id: null, contact: '@tg2', comment: '' }
        ])
    })

    it('контакт обязателен, капча обязательна', async () => {
        expect((await recover({ nick: 'есть', contact: '' })).status).toBe(400)
        expect((await recover({ nick: 'есть', contact: '@tg', captchaToken: 'bad' })).body.error.code).toBe('captcha')
        expect(recovery).toHaveLength(0)
    })

    it('не больше 3 в сутки на ник и на IP — сверх лимита тот же ответ, но заявка не пишется', async () => {
        for (let i = 0; i < 5; i++) expect((await recover({ nick: 'цель', contact: '@x' }, `7.7.7.${i}`)).body).toEqual({ ok: true })
        expect(recovery).toHaveLength(LIMITS.recoveryPerNickDay)
        for (let i = 0; i < 5; i++) await recover({ nick: `ник${i}`, contact: '@x' }, '8.8.8.8')
        expect(recovery.filter((r) => r.nick.startsWith('ник'))).toHaveLength(LIMITS.recoveryPerIpDay)
    })
})

describe('account', () => {
    it('без входа — 401, забаненный — 403', async () => {
        expect((await send(createAccountHandler(deps), request('account', { action: 'change-password' }))).status).toBe(401)
        const id = await addUser('bannedOne', 'password1')
        users.get(id)!.banned_until = '2126-01-01T00:00:00Z'
        expect((await account(id, { action: 'change-password', current: 'password1', password: 'newpassword' })).status).toBe(403)
    })

    it('смена пароля требует текущий', async () => {
        const id = await addUser('user1', 'password1')
        expect((await account(id, { action: 'change-password', current: 'wrong', password: 'newpassword' })).body.error.code).toBe('wrong_password')
        expect((await account(id, { action: 'change-password', current: 'password1', password: 'newpassword' })).status).toBe(200)
        expect(users.get(id)!.password).toBe('newpassword')
    })

    it('после сброса админом текущий не нужен, флаг снимается; временный повторить нельзя', async () => {
        const id = await addUser('user1', 'temporary1')
        privs.get(id)!.must_change_password = true
        expect((await account(id, { action: 'change-password', password: 'temporary1' })).body.error.message).toMatch(/отличаться/)
        expect((await account(id, { action: 'change-password', password: 'brandnew1' })).status).toBe(200)
        expect(privs.get(id)!.must_change_password).toBe(false)
    })

    it('попытки проверки пароля ограничены', async () => {
        const id = await addUser('user1', 'password1')
        for (let i = 0; i < LIMITS.passwordChecksPerUserHour; i++) await account(id, { action: 'delete-account', password: 'wrong' })
        expect((await account(id, { action: 'delete-account', password: 'password1' })).status).toBe(429)
        expect(users.has(id)).toBe(true)
    })

    it('смена ника: адрес меняется, вход по новому нику; раз в 30 дней', async () => {
        const id = await addUser('старый', 'password1')
        const res = await account(id, { action: 'change-nick', nick: 'Новый' })
        expect(res.body).toEqual({ ok: true, nick: 'Новый' })
        expect(users.get(id)!.email).toBe(await techEmail('новый'))
        expect(profiles.get(id)!.nick).toBe('Новый')
        now += 29 * 86_400_000
        expect((await account(id, { action: 'change-nick', nick: 'Третий' })).status).toBe(429)
        now += 2 * 86_400_000
        expect((await account(id, { action: 'change-nick', nick: 'Третий' })).status).toBe(200)
    })

    it('смена ника на занятый — 409, адрес не меняется', async () => {
        await addUser('занят', 'password1')
        const id = await addUser('мой', 'password1')
        const email = users.get(id)!.email
        expect((await account(id, { action: 'change-nick', nick: 'ЗАНЯТ' })).status).toBe(409)
        expect(users.get(id)!.email).toBe(email)
    })

    it('удаление аккаунта — с паролем; аватар и сеансы удаляются', async () => {
        const id = await addUser('уйду', 'password1')
        expect((await account(id, { action: 'delete-account', password: 'nope' })).status).toBe(400)
        expect((await account(id, { action: 'delete-account', password: 'password1' })).status).toBe(200)
        expect(users.has(id)).toBe(false)
        expect(profiles.has(id)).toBe(false)
        expect(avatarsRemoved).toEqual([id])
        // Обложки плейлистов — из Storage; строки базы удаляет каскад.
        expect(coversRemoved).toEqual([`${id}/`])
        expect(signedOut).toEqual([id])
    })

    it('владелец удалить себя не может', async () => {
        const id = await addUser('frnkness', 'password1', 'owner')
        expect((await account(id, { action: 'delete-account', password: 'password1' })).status).toBe(403)
        expect(users.has(id)).toBe(true)
    })
})

describe('admin-users: права', () => {
    const A = { id: 'a', role: 'admin' } as const
    const O = { id: 'o', role: 'owner' } as const
    const U = { id: 'u', role: 'user' } as const
    const A2 = { id: 'a2', role: 'admin' } as const

    it('матрица разрешений', () => {
        expect(adminPermission(A, U, 'ban')).toBeNull()
        expect(adminPermission(A, U, 'reset-password')).toBeNull()
        expect(adminPermission(A, U, 'set-role')).toMatch(/только владелец/)
        expect(adminPermission(A, A2, 'ban')).toMatch(/только у владельца/)
        expect(adminPermission(A, A, 'rename')).toMatch(/только у владельца/)
        expect(adminPermission(A, O, 'rename')).toMatch(/Владельца/)
        expect(adminPermission(O, A, 'set-role')).toBeNull()
        expect(adminPermission(O, A, 'delete')).toBeNull()
        expect(adminPermission(O, O, 'set-role')).toMatch(/нельзя/)
        expect(adminPermission(O, O, 'delete')).toMatch(/нельзя/)
        expect(adminPermission(O, O, 'ban')).toMatch(/нельзя/)
        expect(adminPermission(O, O, 'rename')).toBeNull()
        expect(adminPermission(U, U, 'sign-out')).toBe('Нет доступа')
    })
})

describe('admin-users', () => {
    let owner: string, admin: string, admin2: string, user: string
    beforeEach(async () => {
        owner = await addUser('frnkness', 'ownerpass1', 'owner')
        admin = await addUser('друг', 'adminpass1', 'admin')
        admin2 = await addUser('другой', 'adminpass2', 'admin')
        user = await addUser('слушатель', 'userpass1')
    })

    it('обычный пользователь — 403 на любое действие', async () => {
        for (const action of ['ban', 'sign-out', 'set-role', 'delete']) {
            expect((await adminCall(user, { action, userId: admin, role: 'user' })).status).toBe(403)
        }
        expect(users.get(admin)!.app_metadata).toEqual({ role: 'admin' })
    })

    it('сброс пароля: временный пароль, смена при входе, все сеансы завершены', async () => {
        expect((await adminCall(admin, { action: 'reset-password', userId: user, password: 'temp-pass-1' })).status).toBe(200)
        expect(users.get(user)!.password).toBe('temp-pass-1')
        expect(privs.get(user)!.must_change_password).toBe(true)
        expect(signedOut).toEqual([user])
    })

    it('бан и разбан, завершение сеансов', async () => {
        await adminCall(admin, { action: 'ban', userId: user })
        expect(users.get(user)!.banned_until).toBeTruthy()
        expect(signedOut).toEqual([user])
        await adminCall(admin, { action: 'unban', userId: user })
        expect(users.get(user)!.banned_until).toBeNull()
    })

    it('переименование админом — в любой момент и без отметки 30 дней', async () => {
        privs.get(user)!.nick_changed_at = new Date(now).toISOString()
        expect((await adminCall(admin, { action: 'rename', userId: user, nick: 'Слушатель2' })).status).toBe(200)
        expect(users.get(user)!.email).toBe(await techEmail('слушатель2'))
        expect(privs.get(user)!.nick_changed_at).toBe(new Date(now).toISOString())
    })

    it('удаление аватара и «о себе»', async () => {
        profiles.get(user)!.avatar = 'upload:123'
        await adminCall(admin, { action: 'remove-avatar', userId: user })
        expect(profiles.get(user)!.avatar).toBe('initials:0')
        expect(avatarsRemoved).toEqual([user])
        expect((await adminCall(admin, { action: 'set-bio', userId: user, bio: 'x'.repeat(201) })).status).toBe(400)
        await adminCall(admin, { action: 'set-bio', userId: user, bio: ' ок ' })
        expect(profiles.get(user)!.bio).toBe('ок')
    })

    it('удаление аккаунта админом — вместе с обложками плейлистов', async () => {
        expect((await adminCall(admin, { action: 'delete', userId: user })).status).toBe(200)
        expect(users.has(user)).toBe(false)
        expect(coversRemoved).toEqual([`${user}/`])
    })

    describe('модерация плейлистов', () => {
        const PL = '11111111-1111-4111-8111-111111111111'
        beforeEach(() => {
            playlists.set(PL, { id: PL, owner_id: user, title: 'Плохое название', cover_version: 5 })
        })

        it('переименовать: название чистится и проверяется', async () => {
            const res = await adminCall(admin, { action: 'playlist-rename', userId: user, playlistId: PL, title: '  Нормальное\u0007 ' })
            expect(res.status).toBe(200)
            expect(playlists.get(PL)!.title).toBe('Нормальное')
            expect((await adminCall(admin, { action: 'playlist-rename', userId: user, playlistId: PL, title: '   ' })).status).toBe(400)
            expect((await adminCall(admin, { action: 'playlist-rename', userId: user, playlistId: PL, title: 'я'.repeat(81) })).status).toBe(400)
        })

        it('удалить обложку: файл из Storage, плейлист — снова коллаж', async () => {
            expect((await adminCall(admin, { action: 'playlist-cover-remove', userId: user, playlistId: PL })).status).toBe(200)
            expect(coversRemoved).toEqual([`${user}/${PL}`])
            expect(playlists.get(PL)!.cover_version).toBeNull()
        })

        it('удалить плейлист — вместе с обложкой', async () => {
            expect((await adminCall(admin, { action: 'playlist-delete', userId: user, playlistId: PL })).status).toBe(200)
            expect(playlists.has(PL)).toBe(false)
            expect(coversRemoved).toEqual([`${user}/${PL}`])
        })

        it('плейлист другого пользователя под чужим userId — 404', async () => {
            expect((await adminCall(admin, { action: 'playlist-delete', userId: admin2, playlistId: PL })).status).toBe(403)
            const other = await addUser('другой2', 'password1')
            expect((await adminCall(admin, { action: 'playlist-delete', userId: other, playlistId: PL })).status).toBe(404)
            expect((await adminCall(admin, { action: 'playlist-delete', userId: user, playlistId: 'bad' })).status).toBe(400)
            expect(playlists.has(PL)).toBe(true)
        })

        it('права как у остальных действий: пользователь — нет, плейлист владельца — только он сам', async () => {
            expect((await adminCall(user, { action: 'playlist-delete', userId: user, playlistId: PL })).status).toBe(403)
            const OPL = '22222222-2222-4222-8222-222222222222'
            playlists.set(OPL, { id: OPL, owner_id: owner, title: 'Владельца', cover_version: null })
            expect((await adminCall(admin, { action: 'playlist-rename', userId: owner, playlistId: OPL, title: 'x' })).status).toBe(403)
            expect((await adminCall(owner, { action: 'playlist-rename', userId: owner, playlistId: OPL, title: 'x' })).status).toBe(200)
        })
    })

    it('админ не может выдавать роли и трогать других админов и владельца', async () => {
        expect((await adminCall(admin, { action: 'set-role', userId: user, role: 'admin' })).status).toBe(403)
        expect((await adminCall(admin, { action: 'ban', userId: admin2 })).status).toBe(403)
        expect((await adminCall(admin, { action: 'reset-password', userId: owner, password: 'hijack-pass' })).status).toBe(403)
        expect((await adminCall(admin, { action: 'delete', userId: owner })).status).toBe(403)
        expect(users.get(user)!.app_metadata).toEqual({ role: 'user' })
        expect(users.get(owner)!.password).toBe('ownerpass1')
    })

    it('владелец выдаёт и снимает права админа', async () => {
        expect((await adminCall(owner, { action: 'set-role', userId: user, role: 'admin' })).status).toBe(200)
        expect(users.get(user)!.app_metadata?.role).toBe('admin')
        expect((await adminCall(owner, { action: 'set-role', userId: admin, role: 'user' })).status).toBe(200)
        expect(users.get(admin)!.app_metadata?.role).toBe('user')
        expect((await adminCall(owner, { action: 'set-role', userId: user, role: 'owner' })).status).toBe(400)
    })

    it('владельца нельзя забанить, удалить или понизить — даже самому', async () => {
        for (const action of ['ban', 'delete', 'set-role']) {
            expect((await adminCall(owner, { action, userId: owner, role: 'user' })).status).toBe(403)
        }
        expect(users.get(owner)!.app_metadata?.role).toBe('owner')
    })

    it('снятая роль действует сразу (роль берётся из Auth на каждый запрос)', async () => {
        users.get(admin)!.app_metadata = { role: 'user' }
        expect((await adminCall(admin, { action: 'sign-out', userId: user })).status).toBe(403)
    })

    it('неизвестный пользователь и действие', async () => {
        expect((await adminCall(admin, { action: 'ban', userId: uuid(999) })).status).toBe(404)
        expect((await adminCall(admin, { action: 'hack', userId: user })).status).toBe(400)
        expect((await adminCall(admin, { action: 'ban', userId: 'not-a-uuid' })).status).toBe(400)
    })
})
