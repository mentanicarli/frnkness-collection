// Аккаунты в e2e: «Supabase» в памяти. Edge Functions аккаунтов работают
// настоящими обработчиками (supabase/functions/_shared/accountsCore.ts) на
// фейковых Auth, базе и капче — тесты проверяют ту же логику, что в проде.
import { createHash } from 'node:crypto'
import { nickKey } from '../supabase/functions/_shared/accounts.ts'
import {
    type AccountsDeps,
    createAccountHandler,
    createAdminUsersHandler,
    createRecoveryHandler,
    createRegisterHandler
} from '../supabase/functions/_shared/accountsCore.ts'

export type Role = 'user' | 'admin' | 'owner'

export interface MockUser {
    id: string
    nick: string
    password: string
    role: Role | null
    email: string
}

/** Тот же технический адрес, что techEmail() (синхронно, для Node). */
export function techEmailSync(nick: string): string {
    const hash = createHash('sha256').update(`frnkness-nick-v1:${nickKey(nick)}`).digest('hex')
    return `u-${hash.slice(0, 32)}@id.frnkness.ru`
}

export function mkUser(n: number, nick: string, password: string, role: Role | null): MockUser {
    return { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, nick, password, role, email: techEmailSync(nick) }
}

/** Токен, который выдаёт поддельный виджет Turnstile и принимает «Cloudflare». */
export const E2E_CAPTCHA = 'e2e-captcha-ok'

export interface AccountRecord {
    id: string
    email: string
    password: string
    role: Role | null
    bannedUntil: string | null
    createdAt: string
    lastSignInAt: string | null
    nick: string
    nickKey: string
    avatar: string
    bio: string
    mustChangePassword: boolean
    nickChangedAt: string | null
}

export interface RecoveryRecord {
    id: number
    nick: string
    nick_key: string
    user_id: string | null
    contact: string | null
    comment: string
    status: 'new' | 'done' | 'rejected'
    created_at: string
    closed_at: string | null
}

export function jwtSub(jwt: string | null | undefined): string | null {
    if (!jwt) return null
    try {
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
        return typeof payload.sub === 'string' ? payload.sub : null
    } catch {
        return null
    }
}

export class AccountsBackend {
    accounts = new Map<string, AccountRecord>()
    recovery: RecoveryRecord[] = []
    limits = new Map<string, number>()
    avatarUploads: string[] = []
    avatarRemovals: string[] = []
    signedOut: string[] = []
    private nextId = 1000
    private nextRecovery = 1
    readonly handlers: Record<string, (req: Request) => Promise<Response>>

    constructor(users: MockUser[]) {
        for (const u of users) this.add(u)
        const deps = this.deps()
        this.handlers = {
            register: createRegisterHandler(deps),
            'recovery-request': createRecoveryHandler(deps),
            account: createAccountHandler(deps),
            'admin-users': createAdminUsersHandler(deps)
        }
    }

    add(u: MockUser): AccountRecord {
        const rec: AccountRecord = {
            id: u.id,
            email: u.email,
            password: u.password,
            role: u.role,
            bannedUntil: null,
            createdAt: '2026-09-01T10:00:00Z',
            lastSignInAt: null,
            nick: u.nick,
            nickKey: nickKey(u.nick),
            avatar: 'initials:0',
            bio: '',
            mustChangePassword: false,
            nickChangedAt: null
        }
        this.accounts.set(rec.id, rec)
        return rec
    }

    byEmail(email: string): AccountRecord | null {
        return [...this.accounts.values()].find((a) => a.email === email) ?? null
    }

    byJwt(jwt: string | null | undefined): AccountRecord | null {
        const sub = jwtSub(jwt)
        return sub ? this.accounts.get(sub) ?? null : null
    }

    isBanned(a: AccountRecord): boolean {
        return Boolean(a.bannedUntil && Date.parse(a.bannedUntil) > Date.now())
    }

    private authUser(a: AccountRecord) {
        return { id: a.id, email: a.email, app_metadata: a.role ? { role: a.role } : {}, banned_until: a.bannedUntil }
    }

    private profile(a: AccountRecord) {
        return { id: a.id, nick: a.nick, nick_key: a.nickKey, avatar: a.avatar, bio: a.bio }
    }

    deps(): AccountsDeps {
        return {
            env: { turnstileSecret: 'e2e-secret', hashSecret: 'e2e-hash' },
            fetch: (async (_url: string, init?: RequestInit) => {
                const form = init?.body as URLSearchParams
                return new Response(JSON.stringify({ success: form?.get('response') === E2E_CAPTCHA }))
            }) as typeof fetch,
            now: () => Date.now(),
            auth: {
                getUser: async (jwt) => {
                    const a = this.byJwt(jwt)
                    return a ? this.authUser(a) : null
                },
                getUserById: async (id) => {
                    const a = this.accounts.get(id)
                    return a ? this.authUser(a) : null
                },
                createUser: async (email, password) => {
                    if (this.byEmail(email)) return 'exists'
                    const id = `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`
                    this.accounts.set(id, {
                        id,
                        email,
                        password,
                        role: 'user',
                        bannedUntil: null,
                        createdAt: new Date().toISOString(),
                        lastSignInAt: null,
                        nick: '',
                        nickKey: `pending-${id}`,
                        avatar: 'initials:0',
                        bio: '',
                        mustChangePassword: false,
                        nickChangedAt: null
                    })
                    return { id }
                },
                updateUser: async (id, update) => {
                    const a = this.accounts.get(id)!
                    if (update.email && [...this.accounts.values()].some((o) => o.id !== id && o.email === update.email)) throw new Error('exists')
                    if (update.role) {
                        if (a.role === 'owner') throw new Error('Владельца нельзя понизить')
                        a.role = update.role
                    }
                    if (update.password !== undefined) a.password = update.password
                    if (update.email !== undefined) a.email = update.email
                    if (update.ban !== undefined) {
                        if (update.ban && a.role === 'owner') throw new Error('Владельца нельзя забанить')
                        a.bannedUntil = update.ban ? '2126-01-01T00:00:00Z' : null
                    }
                },
                deleteUser: async (id) => {
                    if (this.accounts.get(id)?.role === 'owner') throw new Error('Владельца нельзя удалить')
                    this.accounts.delete(id)
                },
                verifyPassword: async (email, password) => {
                    const a = this.byEmail(email)
                    return Boolean(a && a.password === password)
                }
            },
            db: {
                rateLimit: async (action, key, max) => {
                    const k = `${action}:${key}`
                    const used = this.limits.get(k) ?? 0
                    if (used >= max) return false
                    this.limits.set(k, used + 1)
                    return true
                },
                profileById: async (id) => {
                    const a = this.accounts.get(id)
                    return a && a.nick ? this.profile(a) : null
                },
                profileByKey: async (key) => {
                    const a = [...this.accounts.values()].find((x) => x.nickKey === key && x.nick)
                    return a ? this.profile(a) : null
                },
                insertProfile: async (p) => {
                    if ([...this.accounts.values()].some((x) => x.nickKey === p.nick_key && x.id !== p.id)) return false
                    const a = this.accounts.get(p.id)!
                    a.nick = p.nick
                    a.nickKey = p.nick_key
                    return true
                },
                updateProfile: async (id, patch) => {
                    if (patch.nick_key && [...this.accounts.values()].some((x) => x.id !== id && x.nickKey === patch.nick_key)) return false
                    const a = this.accounts.get(id)!
                    if (patch.nick !== undefined) a.nick = patch.nick
                    if (patch.nick_key !== undefined) a.nickKey = patch.nick_key
                    if (patch.avatar !== undefined) a.avatar = patch.avatar
                    if (patch.bio !== undefined) a.bio = patch.bio
                    return true
                },
                getPrivate: async (id) => {
                    const a = this.accounts.get(id)
                    return a ? { must_change_password: a.mustChangePassword, nick_changed_at: a.nickChangedAt } : null
                },
                upsertPrivate: async (id, patch) => {
                    const a = this.accounts.get(id)
                    if (!a) return
                    if (patch.must_change_password !== undefined) a.mustChangePassword = patch.must_change_password
                    if (patch.nick_changed_at !== undefined) a.nickChangedAt = patch.nick_changed_at
                },
                insertRecovery: async (r) => {
                    this.recovery.push({ ...r, id: this.nextRecovery++, status: 'new', created_at: new Date().toISOString(), closed_at: null })
                },
                signOutUser: async (id) => {
                    this.signedOut.push(id)
                }
            },
            storage: {
                removeAvatar: async (id) => {
                    this.avatarRemovals.push(id)
                }
            }
        }
    }

    // ── PostgREST ──────────────────────────────────────────────────────

    profileRows(id: string | null) {
        return [...this.accounts.values()]
            .filter((a) => a.nick && (!id || a.id === id))
            .map((a) => ({ id: a.id, nick: a.nick, avatar: a.avatar, bio: a.bio, created_at: a.createdAt }))
    }

    privateRows(caller: AccountRecord | null, id: string | null) {
        if (!caller || (id && id !== caller.id)) return []
        return [{ id: caller.id, must_change_password: caller.mustChangePassword, nick_changed_at: caller.nickChangedAt }]
    }

    /** RPC админки и владельца; null — не наша функция. */
    rpc(name: string, args: Record<string, unknown>, caller: AccountRecord | null): { status: number; body: unknown } | null {
        const isAdmin = Boolean(caller && !this.isBanned(caller) && (caller.role === 'admin' || caller.role === 'owner'))
        const isOwner = Boolean(caller && caller.role === 'owner')
        const denied = { status: 403, body: { code: '42501', message: 'Нет доступа' } }
        const adminRow = (a: AccountRecord) => ({
            id: a.id,
            nick: a.nick || null,
            avatar: a.avatar,
            role: a.role ?? 'user',
            created_at: a.createdAt,
            last_sign_in_at: a.lastSignInAt,
            banned_until: this.isBanned(a) ? a.bannedUntil : null,
            has_profile: Boolean(a.nick)
        })
        switch (name) {
            case 'admin_users_list': {
                if (!isAdmin) return denied
                const q = String(args.p_search ?? '').toLowerCase()
                const rows = [...this.accounts.values()].filter((a) => !q || a.nick.toLowerCase().includes(q)).map(adminRow)
                return { status: 200, body: rows }
            }
            case 'admin_user_card': {
                if (!isAdmin) return denied
                const a = this.accounts.get(String(args.p_user))
                if (!a) return { status: 400, body: { code: 'P0002', message: 'Пользователь не найден' } }
                return {
                    status: 200,
                    body: {
                        ...adminRow(a),
                        bio: a.bio,
                        must_change_password: a.mustChangePassword,
                        nick_changed_at: a.nickChangedAt,
                        sessions: 1,
                        plays: 3,
                        plays_30d: 2,
                        last_play_at: '2026-10-01T10:00:00Z',
                        listen_seconds: 420,
                        top: [{ track_key: 'zlaya-nostalgia-0', plays: 3 }]
                    }
                }
            }
            case 'admin_users_overview':
                if (!isAdmin) return denied
                return { status: 200, body: { total: this.accounts.size, active7: 2, new7: 1, banned: [...this.accounts.values()].filter((a) => this.isBanned(a)).length } }
            case 'admin_users_daily': {
                if (!isAdmin) return denied
                const out: { day: string; registrations: number }[] = []
                for (let d = new Date(`${args.p_from}T00:00:00Z`); d <= new Date(`${args.p_to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
                    out.push({ day: d.toISOString().slice(0, 10), registrations: 0 })
                }
                if (out.length) out[out.length - 1].registrations = 1
                return { status: 200, body: out }
            }
            case 'owner_recovery_list':
                if (!isOwner) return denied
                return {
                    status: 200,
                    body: [...this.recovery]
                        .sort((a, b) => Number(b.status === 'new') - Number(a.status === 'new') || b.id - a.id)
                        .map((r) => ({ ...r, current_nick: r.user_id ? this.accounts.get(r.user_id)?.nick ?? null : null }))
                }
            case 'owner_recovery_new_count':
                if (!isOwner) return denied
                return { status: 200, body: this.recovery.filter((r) => r.status === 'new').length }
            case 'owner_recovery_close': {
                if (!isOwner) return denied
                const r = this.recovery.find((x) => x.id === Number(args.p_id) && x.status === 'new')
                if (!r) return { status: 400, body: { code: 'P0002', message: 'Заявка не найдена или уже закрыта' } }
                r.status = args.p_status as 'done' | 'rejected'
                r.contact = null
                r.closed_at = new Date().toISOString()
                return { status: 204, body: null }
            }
        }
        return null
    }
}
