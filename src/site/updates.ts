import { player } from './player/state'

/**
 * Обновление сайта без «залипания» на старой версии.
 *
 * Service worker (src/sw.js) отдаёт оболочку из кэша сразу, а сам
 * обновляется в фоне: браузер проверяет его при каждом заходе, мы
 * дополнительно — при возврате в приложение (установленное PWA на iPhone
 * неделями живёт в памяти). Новая версия активируется сразу (skipWaiting),
 * и страница перезагружается на неё, как только это не помешает:
 * не играет музыка и человек не печатает.
 */

const RELOAD_GUARD_KEY = 'frnk-reload-at'
/** Не перезагружать чаще раза в столько мс (защита от петли). */
const RELOAD_MIN_GAP_MS = 30_000

export interface ReloadContext {
    playing: boolean
    typing: boolean
}

/** Можно ли прямо сейчас перезагрузить страницу, не сбив человека. */
export function canReloadNow(ctx: ReloadContext): boolean {
    return !ctx.playing && !ctx.typing
}

function isTyping(doc: Document): boolean {
    const el = doc.activeElement
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable === true
}

function reloadAllowedByGuard(): boolean {
    try {
        const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0)
        if (Date.now() - last < RELOAD_MIN_GAP_MS) return false
        sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
    } catch {
        /* без хранилища — без защиты */
    }
    return true
}

/** Перезагрузка из-за устаревшего чанка (после деплоя старый файл исчез с сервера). */
export function reloadForStaleChunk(): void {
    if (reloadAllowedByGuard()) location.reload()
}

/** Регистрация service worker и перезагрузка на новую версию. */
export function setupUpdates(baseUrl: string): void {
    window.addEventListener('vite:preloadError', (e) => {
        e.preventDefault()
        reloadForStaleChunk()
    })
    if (!('serviceWorker' in navigator)) return

    let pending = false
    const tryReload = () => {
        if (!pending) return
        if (!canReloadNow({ playing: player.isPlaying, typing: isTyping(document) })) return
        pending = false
        if (reloadAllowedByGuard()) location.reload()
    }

    // Первый заход (контроллера ещё нет) перезагружать не нужно.
    const hadController = Boolean(navigator.serviceWorker.controller)
    if (hadController) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            pending = true
            tryReload()
        })
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') tryReload()
    })
    // Отложенная перезагрузка: музыка встала или поле потеряло фокус.
    setInterval(tryReload, 5000)

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(`${baseUrl}sw.js`, { updateViaCache: 'none' })
            .then((registration) => {
                const check = () => void registration.update().catch(() => undefined)
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') check()
                })
                window.addEventListener('online', check)
            })
            .catch(() => {
                // Ошибку регистрации игнорируем: в private mode/PWA-ограничениях это допустимо.
            })
    })
}
