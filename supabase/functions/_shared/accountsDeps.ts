// Настоящие зависимости функций аккаунтов: supabase-js с service role.
// Только для Deno (Edge Functions); логика — в accountsCore.ts.
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { AccountsDeps, AccountPrivate, Profile } from './accountsCore.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, NO_SESSION)

const PROFILE_COLUMNS = 'id, nick, nick_key, avatar, bio'
// Бан «навсегда» (100 лет) — так его снимает только unban.
const BAN_FOREVER = '876000h'

function fail(what: string, error: { message?: string } | null): never {
    throw new Error(`${what}: ${error?.message ?? 'unknown'}`)
}

export function accountsDeps(): AccountsDeps {
    return {
        env: {
            turnstileSecret: Deno.env.get('TURNSTILE_SECRET_KEY') || undefined,
            hashSecret: Deno.env.get('ACCOUNTS_HASH_SECRET') || SERVICE_ROLE_KEY
        },
        fetch: (input, init) => fetch(input, init),
        now: () => Date.now(),
        log: (message) => console.error(message),
        auth: {
            async getUser(jwt) {
                const { data, error } = await admin.auth.getUser(jwt)
                if (error || !data.user) return null
                return data.user
            },
            async getUserById(id) {
                const { data, error } = await admin.auth.admin.getUserById(id)
                if (error || !data.user) return null
                return data.user
            },
            async createUser(email, password) {
                const { data, error } = await admin.auth.admin.createUser({
                    email,
                    password,
                    email_confirm: true,
                    app_metadata: { role: 'user' }
                })
                if (error) {
                    if (error.code === 'email_exists' || /already (been )?registered|exists/i.test(error.message)) return 'exists'
                    fail('createUser', error)
                }
                return { id: data.user!.id }
            },
            async updateUser(id, update) {
                const attrs: Record<string, unknown> = {}
                if (update.password !== undefined) attrs.password = update.password
                if (update.email !== undefined) {
                    attrs.email = update.email
                    attrs.email_confirm = true
                }
                if (update.role !== undefined) attrs.app_metadata = { role: update.role }
                if (update.ban !== undefined) attrs.ban_duration = update.ban ? BAN_FOREVER : 'none'
                const { error } = await admin.auth.admin.updateUserById(id, attrs)
                if (error) fail('updateUser', error)
            },
            async deleteUser(id) {
                const { error } = await admin.auth.admin.deleteUser(id)
                if (error) fail('deleteUser', error)
            },
            async verifyPassword(email, password) {
                // Отдельный клиент без сохранения сессии; созданный вход сразу
                // завершаем, чтобы проверка не оставляла лишний сеанс.
                const probe = createClient(SUPABASE_URL, ANON_KEY, NO_SESSION)
                const { data, error } = await probe.auth.signInWithPassword({ email, password })
                if (error || !data.session) return false
                await admin.auth.admin.signOut(data.session.access_token, 'local').catch(() => undefined)
                return true
            }
        },
        db: {
            async rateLimit(action, key, max, windowSeconds) {
                const { data, error } = await admin.rpc('rate_limit_hit', {
                    p_action: action,
                    p_key: key,
                    p_max: max,
                    p_window: `${windowSeconds} seconds`
                })
                if (error) fail('rate_limit_hit', error)
                return data === true
            },
            async profileById(id) {
                const { data, error } = await admin.from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle()
                if (error) fail('profileById', error)
                return (data as Profile | null) ?? null
            },
            async profileByKey(key) {
                const { data, error } = await admin.from('profiles').select(PROFILE_COLUMNS).eq('nick_key', key).maybeSingle()
                if (error) fail('profileByKey', error)
                return (data as Profile | null) ?? null
            },
            async insertProfile(p) {
                const { error } = await admin.from('profiles').insert(p)
                if (error?.code === '23505') return false
                if (error) fail('insertProfile', error)
                return true
            },
            async updateProfile(id, patch) {
                const { error } = await admin.from('profiles').update(patch).eq('id', id)
                if (error?.code === '23505') return false
                if (error) fail('updateProfile', error)
                return true
            },
            async getPrivate(id) {
                const { data, error } = await admin.from('account_private').select('must_change_password, nick_changed_at').eq('id', id).maybeSingle()
                if (error) fail('getPrivate', error)
                return (data as AccountPrivate | null) ?? null
            },
            async upsertPrivate(id, patch) {
                const { error } = await admin.from('account_private').upsert({ id, ...patch }, { onConflict: 'id' })
                if (error) fail('upsertPrivate', error)
            },
            async insertRecovery(r) {
                const { error } = await admin.from('recovery_requests').insert(r)
                if (error) fail('insertRecovery', error)
            },
            async signOutUser(id) {
                const { error } = await admin.rpc('service_sign_out_user', { p_user: id })
                if (error) fail('service_sign_out_user', error)
            }
        },
        storage: {
            async removeAvatar(userId) {
                const { error } = await admin.storage.from('avatars').remove([`${userId}/avatar`])
                if (error) fail('removeAvatar', error)
            }
        }
    }
}
