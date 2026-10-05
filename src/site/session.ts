import { readonly, reactive } from 'vue'

/**
 * Кто вошёл на сайт — задел на этап «Аккаунты» (docs/frnkness-accounts-update.md).
 *
 * Сейчас входа нет: user всегда null, и ничего на сайте от этого не зависит.
 * Когда появятся аккаунты, здесь будут профиль, роль и восстановление сессии
 * при загрузке, а роутер начнёт проверять meta.public.
 */

export interface SessionUser {
    id: string
    nick: string
    role: 'user' | 'admin' | 'owner'
}

const state = reactive({
    user: null as SessionUser | null,
    // Сессия проверена при загрузке (сейчас — сразу: проверять нечего).
    ready: true
})

export const session = readonly(state)
