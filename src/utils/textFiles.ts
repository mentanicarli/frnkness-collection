/**
 * Загрузка текстовых файлов песен (.txt / .lrc) — одна на весь сайт.
 *
 * Один и тот же файл нужен сразу нескольким местам: плееру (текст и караоке),
 * странице трека, запасному индексу поиска. Здесь запросы одного адреса
 * объединяются: пока файл грузится или уже загружен, повторный вызов
 * получает тот же промис, а не идёт в сеть ещё раз.
 *
 * cache: 'no-cache' — браузер всё равно спрашивает сервер, но дёшево, по
 * ETag: GitHub Pages отдаёт файлы с HTTP-кэшем на 10 минут, и без этого
 * правка из админки доходила бы до посетителя с опозданием.
 */

const pending = new Map<string, Promise<string>>()

// SPA-хостинг на месте отсутствующего файла может отдать index.html.
function isHtmlPayload(response: Response, text: string): boolean {
    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('text/html')) return true
    return /<!doctype html|<html|<head|<link|<body/i.test(text || '')
}

/**
 * Текст файла или пустая строка, если файла нет (404, HTML вместо текста).
 * Сетевая ошибка не запоминается: следующий вызов попробует снова.
 */
export function fetchTextFile(url: string): Promise<string> {
    const existing = pending.get(url)
    if (existing) return existing

    const request = fetch(url, { cache: 'no-cache' })
        .then(async (response) => {
            if (!response.ok) return ''
            const text = await response.text()
            return isHtmlPayload(response, text) ? '' : text
        })
        .catch(() => {
            pending.delete(url)
            return ''
        })
    pending.set(url, request)
    return request
}

/** Только для тестов: сбросить объединённые запросы. */
export function resetTextFileCache(): void {
    pending.clear()
}
