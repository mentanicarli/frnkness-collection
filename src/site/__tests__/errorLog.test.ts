import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/supabaseClient', () => ({ supabase: { rpc: vi.fn() } }))

const { MAX_PER_SESSION, clientKey, createErrorLogger, describeError, installErrorLogging, resetErrorLoggingForTests } = await import('../errorLog')

type Sent = { message: string; stack: string; page: string; browser: string; build: string; client: string }

function setup() {
    const sent: Sent[] = []
    const logger = createErrorLogger((r) => {
        sent.push(r)
    })
    return { sent, logger }
}

afterEach(() => {
    resetErrorLoggingForTests()
    localStorage.clear()
})

describe('журнал ошибок сайта', () => {
    it('отправляет текст, первые строки стека, страницу, браузер, версию сборки и ключ браузера', () => {
        const { sent, logger } = setup()
        const stack = ['Error: boom', ...Array.from({ length: 15 }, (_, i) => `    at f${i} (https://frnkness.ru/a.js:${i}:1)`)].join('\n')
        expect(logger.report({ message: 'boom', stack })).toBe(true)
        expect(sent).toHaveLength(1)
        expect(sent[0].message).toBe('boom')
        expect(sent[0].stack.split('\n')).toHaveLength(8)
        expect(sent[0].build).toBe(__BUILD_ID__)
        expect(sent[0].page).toMatch(/^\//)
        expect(sent[0].client).toMatch(/^[a-z0-9]{8,40}$/)
    })

    it('одинаковые ошибки за сессию не дублируются, даже если отличаются числами', () => {
        const { sent, logger } = setup()
        expect(logger.report({ message: 'Load failed 123', stack: 'at a (x.js:1:2)' })).toBe(true)
        expect(logger.report({ message: 'Load failed 456', stack: 'at a (x.js:9:9)' })).toBe(false)
        expect(logger.report({ message: 'Other', stack: 'at a (x.js:1:2)' })).toBe(true)
        expect(sent).toHaveLength(2)
    })

    it(`за сессию уходит не больше ${MAX_PER_SESSION} разных ошибок`, () => {
        const { sent, logger } = setup()
        for (let i = 0; i < 50; i++) logger.report({ message: `error number ${'x'.repeat(i)}`, stack: '' })
        expect(sent).toHaveLength(MAX_PER_SESSION)
    })

    it('пароли, токены и почта не уходят в базу', () => {
        const { sent, logger } = setup()
        logger.report({ message: 'password=hunter2 for me@example.com', stack: 'at f (https://x/a.js?token=SECRET:1:1)' })
        const all = JSON.stringify(sent[0])
        for (const secret of ['hunter2', 'me@example.com', 'SECRET']) expect(all).not.toContain(secret)
    })

    it('шум не отправляется: «Script error.», ResizeObserver, расширения браузера, пустое', () => {
        const { sent, logger } = setup()
        logger.report({ message: 'Script error.', stack: '' })
        logger.report({ message: 'ResizeObserver loop completed with undelivered notifications.', stack: '' })
        logger.report({ message: 'x', stack: 'at a (chrome-extension://abc/content.js:1:1)' })
        logger.report({ message: '   ', stack: '' })
        expect(sent).toHaveLength(0)
    })

    it('сбой отправки (исключение и отказ промиса) не ломает сайт и не порождает новых отчётов', async () => {
        const throwing = createErrorLogger(() => {
            throw new Error('network')
        })
        expect(() => throwing.report({ message: 'a', stack: '' })).not.toThrow()
        const rejecting = createErrorLogger(() => Promise.reject(new Error('down')))
        expect(() => rejecting.report({ message: 'b', stack: '' })).not.toThrow()
        // Отказ обработан внутри: необработанного отказа не остаётся.
        const unhandled = vi.fn()
        process.on('unhandledRejection', unhandled)
        await new Promise((r) => setTimeout(r, 10))
        process.off('unhandledRejection', unhandled)
        expect(unhandled).not.toHaveBeenCalled()
    })

    it('запрос supabase-js (thenable) действительно запускается: вызывается .then', () => {
        const then = vi.fn()
        const logger = createErrorLogger(() => ({ then }) as unknown as PromiseLike<unknown>)
        logger.report({ message: 'c', stack: '' })
        expect(then).toHaveBeenCalledTimes(1)
    })

    it('ключ браузера хранится между визитами; без хранилища работает на время вкладки', () => {
        const first = clientKey()
        expect(clientKey()).toBe(first)
        expect(localStorage.getItem('frnk-client-id')).toBe(first)
        const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        expect(clientKey()).toMatch(/^[a-z0-9]{8,40}$/)
        expect(clientKey()).toBe(clientKey())
        spy.mockRestore()
        setSpy.mockRestore()
    })

    it('install: ловит window.onerror и unhandledrejection, повторная установка ничего не удваивает', () => {
        const sent: Sent[] = []
        const target = new EventTarget() as unknown as Window
        installErrorLogging(target, (r) => void sent.push(r))
        installErrorLogging(target, (r) => void sent.push(r))
        const err = new ErrorEvent('error', { error: new Error('from onerror'), message: 'from onerror' })
        target.dispatchEvent(err)
        const rej = new Event('unhandledrejection') as Event & { reason: unknown }
        rej.reason = new Error('from promise')
        target.dispatchEvent(rej)
        // Ошибка загрузки ресурса (без error и message) — не наша.
        target.dispatchEvent(new ErrorEvent('error'))
        expect(sent.map((s) => s.message)).toEqual(['from onerror', 'from promise'])
    })

    it('describeError понимает Error, строки, объекты и пустоту', () => {
        expect(describeError(new TypeError('bad')).message).toBe('bad')
        expect(describeError('text')).toEqual({ message: 'text', stack: '' })
        expect(describeError({ message: 'obj', stack: 's' })).toEqual({ message: 'obj', stack: 's' })
        expect(describeError({ code: 1 }).message).toBe('{"code":1}')
        expect(describeError(undefined, 'fallback').message).toBe('fallback')
        const cyclic: Record<string, unknown> = {}
        cyclic.self = cyclic
        expect(describeError(cyclic).message).toBe('Unknown error')
    })
})
