import { shallowReactive } from 'vue'

/** Окно «Выйти из аккаунта?» (его открывают меню профиля и страницы с кнопкой выхода). */
export const logoutUi = shallowReactive({ open: false })

export const askLogout = (): void => {
    logoutUi.open = true
}
