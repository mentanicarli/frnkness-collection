import { reactive, readonly } from 'vue'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/supabaseClient'
import { functionUrl, SUPABASE_ANON_KEY } from '@/supabaseConfig'
import { type AppRole, cleanNick, roleOf, techEmail } from '../../supabase/functions/_shared/accounts.ts'

/**
 * Кто вошёл на сайт (docs/frnkness-accounts-update.md, разделы 2–5).
 *
 * Вход — ник + пароль: из ника считается технический адрес аккаунта
 * (supabase/functions/_shared/accounts.ts), дальше обычный вход Supabase.
 * Ошибка входа всегда одна — «Неверный ник или пароль».
 */

export interface SessionUser {
    id: string
    nick: string
    role: AppRole
    avatar: string
    bio: string
    createdAt: string
}

const state = reactive({
    user: null as SessionUser | null,
    // Сессия проверена при загрузке (до этого роутер ждёт).
    ready: false,
    mustChangePassword: false,
    nickChangedAt: null as string | null,
    // Сессия пропала без нажатия «Выйти» (истекла, аккаунт удалён или забанен).
    expired: false
})

export const session = readonly(state)

let accessToken: string | null = null
let manualSignOut = false
let readyResolve: () => void = () => undefined
const readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve
})
let initialized = false
let loadSeq = 0

/** Текущий access-токен — для запросов в обход клиента (keepalive при закрытии страницы). */
export function currentAccessToken(): string | null {
    return accessToken
}

async function loadAccount(s: Session): Promise<void> {
    const seq = ++loadSeq
    const uid = s.user.id
    const [profile, priv] = await Promise.all([
        supabase.from('profiles').select('nick, avatar, bio, created_at').eq('id', uid).maybeSingle(),
        supabase.from('account_private').select('must_change_password, nick_changed_at').eq('id', uid).maybeSingle()
    ])
    if (seq !== loadSeq) return
    const p = profile.data as { nick: string; avatar: string; bio: string; created_at: string } | null
    const a = priv.data as { must_change_password: boolean; nick_changed_at: string | null } | null
    state.user = {
        id: uid,
        nick: p?.nick ?? '',
        role: roleOf(s.user.app_metadata),
        avatar: p?.avatar ?? 'initials:0',
        bio: p?.bio ?? '',
        createdAt: p?.created_at ?? s.user.created_at
    }
    state.mustChangePassword = Boolean(a?.must_change_password)
    state.nickChangedAt = a?.nick_changed_at ?? null
}

async function applySession(s: Session | null): Promise<void> {
    accessToken = s?.access_token ?? null
    if (!s) {
        loadSeq++
        loading = null
        if (state.user && !manualSignOut) state.expired = true
        manualSignOut = false
        state.user = null
        state.mustChangePassword = false
        state.nickChangedAt = null
        return
    }
    state.expired = false
    // Обновление токена не меняет профиль — не перечитываем.
    if (state.user?.id === s.user.id) {
        state.user.role = roleOf(s.user.app_metadata)
        return
    }
    // При запуске сессию приносят и getSession(), и событие INITIAL_SESSION:
    // второй вызов ждёт ту же загрузку, а не начинает новую.
    if (loading?.id === s.user.id) return loading.promise
    const promise = loadAccount(s)
        .catch(() => {
            // Профиль не прочитался (нет сети) — пускаем с тем, что есть в токене.
            state.user = { id: s.user.id, nick: '', role: roleOf(s.user.app_metadata), avatar: 'initials:0', bio: '', createdAt: s.user.created_at }
        })
        .finally(() => {
            if (loading?.promise === promise) loading = null
        })
    loading = { id: s.user.id, promise }
    return promise
}

let loading: { id: string; promise: Promise<void> } | null = null

export function initSession(): Promise<void> {
    if (!initialized) {
        initialized = true
        supabase.auth
            .getSession()
            .then(({ data }) => applySession(data.session))
            .catch(() => applySession(null))
            .finally(() => {
                state.ready = true
                readyResolve()
            })
        supabase.auth.onAuthStateChange((_event, s) => {
            // Колбэк не должен ждать запросов к базе (иначе supabase-js
            // может зависнуть на блокировке) — откладываем.
            setTimeout(() => void applySession(s), 0)
        })
    }
    return readyPromise
}

export function whenSessionReady(): Promise<void> {
    return initSession()
}

// ── Вход, регистрация, выход ───────────────────────────────────────────

export const LOGIN_ERROR = 'Неверный ник или пароль'

function authErrorMessage(error: { status?: number; code?: string; message?: string }): string {
    if (error.status === 429 || error.code === 'over_request_rate_limit') return 'Слишком много попыток входа — подожди несколько минут'
    if (error.code === 'user_banned' || /banned/i.test(error.message ?? '')) return 'Аккаунт заблокирован'
    if (!error.status || error.status >= 500) return 'Не удалось связаться с сервером — попробуй ещё раз'
    return LOGIN_ERROR
}

/** null — вошли; иначе текст ошибки. */
export async function signIn(nick: string, password: string): Promise<string | null> {
    const clean = cleanNick(nick)
    if (!clean || !password) return 'Введи ник и пароль'
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: await techEmail(clean), password })
        if (error || !data.session) return authErrorMessage(error ?? {})
        await applySession(data.session)
        return null
    } catch {
        return 'Не удалось связаться с сервером — попробуй ещё раз'
    }
}

export async function signOut(): Promise<void> {
    manualSignOut = true
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    await applySession(null)
}

export interface FunctionResult<T = Record<string, unknown>> {
    ok: boolean
    data?: T
    error?: string
    code?: string
    status?: number
}

/** Вызов Edge Function аккаунтов. С withAuth — от имени вошедшего. */
export async function callFunction<T = Record<string, unknown>>(name: string, body: unknown, withAuth = true): Promise<FunctionResult<T>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY }
    if (withAuth) {
        const { data } = await supabase.auth.getSession()
        if (!data.session) return { ok: false, error: 'Нужно войти', code: 'unauthorized', status: 401 }
        headers.Authorization = `Bearer ${data.session.access_token}`
    }
    try {
        const res = await fetch(functionUrl(name), { method: 'POST', headers, body: JSON.stringify(body) })
        const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
        if (!res.ok) {
            return {
                ok: false,
                status: res.status,
                code: json?.error?.code,
                error: json?.error?.message || (res.status === 429 ? 'Слишком много попыток — попробуй позже' : 'Что-то пошло не так, попробуй позже')
            }
        }
        return { ok: true, data: (json ?? {}) as T, status: res.status }
    } catch {
        return { ok: false, error: 'Не удалось связаться с сервером — попробуй ещё раз', code: 'network' }
    }
}

export async function register(nick: string, password: string, captchaToken: string): Promise<string | null> {
    const res = await callFunction('register', { nick: cleanNick(nick), password, captchaToken, agree: true }, false)
    if (!res.ok) return res.error ?? 'Не удалось зарегистрироваться'
    const error = await signIn(nick, password)
    return error ? `Аккаунт создан, но войти не удалось: ${error}` : null
}

// ── Профиль ────────────────────────────────────────────────────────────

/** Перечитать свой профиль (после смены ника, аватара, пароля). */
export async function refreshAccount(): Promise<void> {
    const { data } = await supabase.auth.getSession()
    if (data.session) await loadAccount(data.session)
}

export async function updateOwnProfile(patch: { avatar?: string; bio?: string }): Promise<string | null> {
    if (!state.user) return 'Нужно войти'
    const { error } = await supabase.from('profiles').update(patch).eq('id', state.user.id)
    if (error) return 'Не удалось сохранить — попробуй ещё раз'
    if (patch.avatar !== undefined) state.user.avatar = patch.avatar
    if (patch.bio !== undefined) state.user.bio = patch.bio
    return null
}

/** Тестам: сбросить состояние модуля. */
export function __setSessionForTests(user: SessionUser | null, extra: { mustChangePassword?: boolean } = {}): void {
    initialized = true
    state.user = user
    state.ready = true
    state.mustChangePassword = Boolean(extra.mustChangePassword)
    readyResolve()
}
