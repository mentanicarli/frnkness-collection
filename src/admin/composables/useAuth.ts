import { computed, reactive } from 'vue'
import type { Session } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, supabase } from '../api/supabase'
import { cleanNick, isAdminRole, roleOf, techEmail } from '../../../supabase/functions/_shared/accounts.ts'

/**
 * Состояние входа. Вход — тем же ником и паролем, что на сайте, сессия
 * общая с сайтом. Роль в интерфейсе — только для выбора экрана: настоящая
 * проверка прав делается на сервере (RLS, RPC, функции) по базе.
 */
const state = reactive({
    ready: false,
    session: null as Session | null,
    nick: '',
    notice: ''
})

let manualSignOut = false
let initialized = false

export function isAdminSession(session: Session | null): boolean {
    return Boolean(session) && isAdminRole(roleOf(session?.user?.app_metadata))
}

async function loadNick(session: Session | null) {
    if (!session) {
        state.nick = ''
        return
    }
    const { data } = await supabase.from('profiles').select('nick').eq('id', session.user.id).maybeSingle()
    state.nick = (data as { nick?: string } | null)?.nick ?? ''
}

function init() {
    if (initialized) return
    initialized = true
    // Сессия была сохранена, но не восстановилась (истёк refresh-токен,
    // пока вкладка была закрыта) — говорим об этом, а не молча просим войти.
    let hadStoredSession = false
    try {
        hadStoredSession = Boolean(localStorage.getItem(AUTH_STORAGE_KEY))
    } catch {
        hadStoredSession = false
    }
    supabase.auth.getSession().then(({ data }) => {
        state.session = data.session
        if (!data.session && hadStoredSession) state.notice = 'Сессия истекла — войди заново'
        state.ready = true
        void loadNick(data.session).catch(() => undefined)
    })
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            // Выход без нажатия «Выйти» — истекла сессия или не удалось
            // обновить токен.
            if (!manualSignOut && state.session) state.notice = 'Сессия истекла — войди заново'
            manualSignOut = false
        }
        const userChanged = state.session?.user.id !== session?.user.id
        state.session = session
        state.ready = true
        if (userChanged) setTimeout(() => void loadNick(session).catch(() => undefined), 0)
    })
}

async function signIn(nick: string, password: string): Promise<string | null> {
    state.notice = ''
    const clean = cleanNick(nick)
    if (!clean || !password) return 'Введи ник и пароль'
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: await techEmail(clean), password })
        if (error) {
            if (error.status === 429) return 'Слишком много попыток входа — подожди несколько минут'
            if (error.code === 'user_banned') return 'Аккаунт заблокирован'
            if (!error.status || error.status >= 500) return `Не удалось войти: ${error.message}`
            return 'Неверный ник или пароль'
        }
        state.session = data.session
        await loadNick(data.session).catch(() => undefined)
        return null
    } catch {
        return 'Не удалось связаться с сервером'
    }
}

async function signOut() {
    manualSignOut = true
    state.notice = ''
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    state.session = null
    state.nick = ''
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
    const role = computed(() => roleOf(state.session?.user?.app_metadata))
    return {
        state,
        isAdmin: computed(() => isAdminSession(state.session)),
        isOwner: computed(() => role.value === 'owner'),
        role,
        userId: computed(() => state.session?.user?.id ?? ''),
        /** Как подписать вошедшего: ник, пока профиль не прочитан — «…». */
        name: computed(() => state.nick || '…'),
        signIn,
        signOut,
        expire
    }
}
