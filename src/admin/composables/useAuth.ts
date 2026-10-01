import { computed, reactive } from 'vue'
import type { Session } from '@supabase/supabase-js'
import { ADMIN_STORAGE_KEY, supabase } from '../api/supabase'

/**
 * Состояние входа. Роль в интерфейсе — только для выбора экрана:
 * настоящая проверка прав делается на сервере (RLS, RPC, функция).
 */
const state = reactive({
    ready: false,
    session: null as Session | null,
    notice: ''
})

let manualSignOut = false
let initialized = false

export function isAdminSession(session: Session | null): boolean {
    return session?.user?.app_metadata?.role === 'admin'
}

function init() {
    if (initialized) return
    initialized = true
    // Сессия была сохранена, но не восстановилась (истёк refresh-токен,
    // пока вкладка была закрыта) — говорим об этом, а не молча просим войти.
    let hadStoredSession = false
    try {
        hadStoredSession = Boolean(localStorage.getItem(ADMIN_STORAGE_KEY))
    } catch {
        hadStoredSession = false
    }
    supabase.auth.getSession().then(({ data }) => {
        state.session = data.session
        if (!data.session && hadStoredSession) state.notice = 'Сессия истекла — войди заново'
        state.ready = true
    })
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            // Выход без нажатия «Выйти» — истекла сессия или не удалось
            // обновить токен.
            if (!manualSignOut && state.session) state.notice = 'Сессия истекла — войди заново'
            manualSignOut = false
        }
        state.session = session
        state.ready = true
    })
}

async function signIn(email: string, password: string): Promise<string | null> {
    state.notice = ''
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
        if (/invalid login credentials/i.test(error.message)) return 'Неверный email или пароль'
        if (/email not confirmed/i.test(error.message)) return 'Email не подтверждён'
        return `Не удалось войти: ${error.message}`
    }
    state.session = data.session
    return null
}

async function signOut() {
    manualSignOut = true
    state.notice = ''
    await supabase.auth.signOut().catch(() => undefined)
    state.session = null
}

/** Сервер ответил 401: сессия больше не действует. */
async function expire() {
    if (!state.session) return
    state.notice = 'Сессия истекла — войди заново'
    manualSignOut = true
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    state.session = null
}

export function useAuth() {
    init()
    return {
        state,
        isAdmin: computed(() => isAdminSession(state.session)),
        email: computed(() => state.session?.user?.email ?? ''),
        signIn,
        signOut,
        expire
    }
}
