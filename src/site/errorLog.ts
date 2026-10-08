import { supabase } from '@/supabaseClient'
import { buildId, currentBrowser, currentPage, scrubText, trimStack } from './diagnostics'

/**
 * Журнал ошибок сайта: ошибки JavaScript и необработанные отказы промисов
 * тихо уходят в базу через RPC log_client_error (миграция
 * 20261011120000_previews_feedback.sql). Пользователь ничего не видит.
 *
 * Защита от шума и злоупотреблений — на обеих сторонах: здесь одинаковые
 * ошибки не повторяются за сессию, и всего уходит не больше MAX_PER_SESSION;
 * в базе — лимит 20 в час на пользователя или браузер и общий потолок сайта.
 */

export const MAX_PER_SESSION = 20
const MAX_KNOWN = 200
const CLIENT_KEY = 'frnk-client-id'

// Ошибки, которые не про наш код: расширения браузера, кросс-доменные «Script error.»,
// безобидное ResizeObserver.
const IGNORED_MESSAGE = /^(Script error\.?|ResizeObserver loop (limit exceeded|completed with undelivered notifications).*)$/i
const IGNORED_STACK = /(chrome|moz|safari)-extension:\/\//i

export interface ErrorReport {
    message: string
    stack: string
}

export type ErrorSender = (report: { message: string; stack: string; page: string; browser: string; build: string; client: string }) => PromiseLike<unknown> | void

/** Случайный ключ браузера для лимита (не связан с человеком); без хранилища — на время вкладки. */
let memoryKey: string | null = null
export function clientKey(): string {
    try {
        const saved = localStorage.getItem(CLIENT_KEY)
        if (saved && /^[a-z0-9]{8,40}$/.test(saved)) return saved
        const fresh = randomKey()
        localStorage.setItem(CLIENT_KEY, fresh)
        return fresh
    } catch {
        return (memoryKey ??= randomKey())
    }
}

function randomKey(): string {
    const bytes = new Uint8Array(12)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
    return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24)
}

/** Приводит событие window.onerror / отказ промиса к сообщению и стеку. */
export function describeError(reason: unknown, fallbackMessage = ''): ErrorReport {
    if (reason instanceof Error) return { message: reason.message || reason.name || 'Error', stack: reason.stack || '' }
    if (typeof reason === 'string') return { message: reason, stack: '' }
    if (reason && typeof reason === 'object') {
        const r = reason as { message?: unknown; stack?: unknown }
        if (typeof r.message === 'string' && r.message) return { message: r.message, stack: typeof r.stack === 'string' ? r.stack : '' }
        try {
            return { message: JSON.stringify(reason).slice(0, 300), stack: '' }
        } catch {
            /* циклическая ссылка */
        }
    }
    return { message: fallbackMessage || 'Unknown error', stack: '' }
}

export function createErrorLogger(send: ErrorSender) {
    const known = new Set<string>()
    let sent = 0

    /** Отправляет ошибку, если такой за сессию ещё не было. Возвращает true, если ушла. */
    function report(error: ErrorReport): boolean {
        const message = scrubText(error.message, 500)
        const stack = trimStack(error.stack)
        if (!message || IGNORED_MESSAGE.test(message) || IGNORED_STACK.test(error.stack || '')) return false
        const key = `${message.replace(/[0-9]+/g, '#')}|${(stack.split('\n')[0] || '').replace(/[0-9]+/g, '#')}`
        if (known.has(key)) return false
        if (known.size >= MAX_KNOWN) known.clear()
        known.add(key)
        if (sent >= MAX_PER_SESSION) return false
        sent++
        try {
            const result = send({ message, stack, page: currentPage(), browser: currentBrowser(), build: buildId(), client: clientKey() })
            // Отказ отправки не должен породить новую ошибку (и новый отчёт).
            // Запрос supabase-js уходит только при .then(), поэтому вызываем его всегда.
            if (result && typeof result.then === 'function') result.then(undefined, () => undefined)
        } catch {
            /* журнал — не главное */
        }
        return true
    }
    return { report }
}

const sendToServer: ErrorSender = (r) =>
    supabase.rpc('log_client_error', {
        p_message: r.message,
        p_stack: r.stack,
        p_page: r.page,
        p_browser: r.browser,
        p_build: r.build,
        p_client: r.client
    })

let installed: ReturnType<typeof createErrorLogger> | null = null

/** Подписывается на window.onerror и unhandledrejection; повторный вызов ничего не делает. */
export function installErrorLogging(target: Window = window, send: ErrorSender = sendToServer) {
    if (installed) return installed
    const logger = createErrorLogger(send)
    installed = logger
    target.addEventListener('error', (e: ErrorEvent) => {
        // Ошибки загрузки картинок и скриптов приходят без message — не наш случай.
        if (!e.error && !e.message) return
        logger.report(describeError(e.error, e.message))
    })
    target.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
        logger.report(describeError(e.reason, 'Unhandled promise rejection'))
    })
    return logger
}

/** Для тестов: сбросить установку. */
export function resetErrorLoggingForTests(): void {
    installed = null
}
