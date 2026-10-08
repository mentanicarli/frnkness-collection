/**
 * Сведения, которые прикладываются к записи об ошибке и к обращению
 * «Сообщить о проблеме»: страница, браузер, версия сборки. Никаких паролей,
 * токенов и личных данных: параметры адреса, почта, uuid и «секретные»
 * строки вычищаются здесь, а потом ещё раз — в базе (scrub_client_text).
 */

export const buildId = (): string => (typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev')

/** Вычистка текста перед отправкой: зеркало scrub_client_text из миграции. */
export function scrubText(input: unknown, max: number): string {
    let t = String(input ?? '')
    // eslint-disable-next-line no-control-regex
    t = t.replace(/[\x01-\x08\x0B-\x1F\x7F]/g, ' ')
    t = t.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}(\.[A-Za-z0-9_-]*)?/g, '[токен]')
    t = t.replace(/bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [токен]')
    t = t.replace(/(password|passwd|pwd|pass|token|secret|apikey|api_key|access_token|refresh_token|authorization|key)(["']?\s*[:=]\s*["']?)[^\s"'&,;)]+/gi, '$1$2[скрыто]')
    t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    t = t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    t = t.replace(/\?[A-Za-z0-9_%.-]+=[^\s)"']*/g, '?…')
    t = t.replace(/[A-Za-z0-9_-]{40,}/g, '[скрыто]')
    return t.trim().slice(0, max)
}

/** Первые строки стека: не больше lines, без параметров адреса. */
export function trimStack(stack: unknown, lines = 8): string {
    if (typeof stack !== 'string') return ''
    return scrubText(stack.split('\n').slice(0, lines).join('\n'), 1500)
}

/** «Chrome 126 / Android»: только семейство и основная версия, без полной строки User-Agent. */
export function parseBrowser(ua: string): string {
    const pick = (re: RegExp) => ua.match(re)?.[1]?.split('.')[0]
    let name = 'Browser'
    let version: string | undefined
    if (/YaBrowser\/(\d+)/.test(ua)) [name, version] = ['Yandex', pick(/YaBrowser\/([\d.]+)/)]
    else if (/Edg(?:e|A|iOS)?\/(\d+)/.test(ua)) [name, version] = ['Edge', pick(/Edg(?:e|A|iOS)?\/([\d.]+)/)]
    else if (/OPR\/(\d+)/.test(ua)) [name, version] = ['Opera', pick(/OPR\/([\d.]+)/)]
    else if (/(?:Firefox|FxiOS)\/(\d+)/.test(ua)) [name, version] = ['Firefox', pick(/(?:Firefox|FxiOS)\/([\d.]+)/)]
    else if (/(?:Chrome|CriOS)\/(\d+)/.test(ua)) [name, version] = ['Chrome', pick(/(?:Chrome|CriOS)\/([\d.]+)/)]
    else if (/Version\/(\d+).*Safari/.test(ua)) [name, version] = ['Safari', pick(/Version\/([\d.]+)/)]
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
    return [version ? `${name} ${version}` : name, os].filter(Boolean).join(' / ')
}

export function currentBrowser(): string {
    return typeof navigator === 'undefined' ? '' : parseBrowser(navigator.userAgent || '')
}

/** Страница сайта: путь и «#/…» без параметров адреса (в них бывают ?next= и прочее). */
export function currentPage(loc: Pick<Location, 'pathname' | 'hash'> = window.location): string {
    return scrubText(`${loc.pathname}${loc.hash}`.split('?')[0], 200)
}

export interface ReportContext {
    page: string
    browser: string
    build: string
}

export function reportContext(): ReportContext {
    return { page: currentPage(), browser: currentBrowser(), build: buildId() }
}
