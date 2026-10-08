/** Копирование и системное «Поделиться» для кнопок со ссылками (адреса — src/utils/share.ts). */

/** Копирует текст; false — не получилось ни Clipboard API, ни запасной способ. */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        // Clipboard API недоступен (http или отказ в доступе) — выделяем
        // адрес через временное поле, это работает везде.
        const input = document.createElement('input')
        input.value = text
        document.body.appendChild(input)
        input.select()
        let ok = false
        try {
            ok = document.execCommand('copy')
        } catch {
            /* молча */
        }
        document.body.removeChild(input)
        return ok
    }
}

export const canNativeShare = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

/** Системное окно «Поделиться». Если его закрыли — это не ошибка. */
export async function nativeShare(title: string, url: string): Promise<void> {
    try {
        await navigator.share({ title, url })
    } catch {
        /* закрыли окно */
    }
}
