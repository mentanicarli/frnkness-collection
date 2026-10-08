import { shallowReactive } from 'vue'

/**
 * Код восстановления, только что выданный при регистрации. Живёт в памяти
 * страницы до нажатия «Я сохранил»: ни в хранилище браузера, ни в адрес он
 * не попадает. Если страницу обновили раньше, сервер выдаст новый код.
 */
export const recoveryHandoff = shallowReactive<{ code: string | null }>({ code: null })

export function clearRecoveryHandoff(): void {
    recoveryHandoff.code = null
}
