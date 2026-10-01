import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchTextFile, resetTextFileCache } from '../textFiles'

function textResponse(body: string, init: ResponseInit = {}): Response {
    return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' }, ...init })
}

describe('fetchTextFile', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        resetTextFileCache()
        fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('запрашивает с cache: no-cache и возвращает текст', async () => {
        fetchMock.mockResolvedValue(textResponse('строка'))
        await expect(fetchTextFile('lyrics/a.txt')).resolves.toBe('строка')
        expect(fetchMock).toHaveBeenCalledWith('lyrics/a.txt', { cache: 'no-cache' })
    })

    it('одновременные и повторные вызовы одного файла — один запрос', async () => {
        fetchMock.mockResolvedValue(textResponse('текст'))
        const [a, b] = await Promise.all([fetchTextFile('lyrics/a.txt'), fetchTextFile('lyrics/a.txt')])
        await fetchTextFile('lyrics/a.txt')
        expect(a).toBe('текст')
        expect(b).toBe('текст')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('разные файлы грузятся отдельно', async () => {
        fetchMock.mockImplementation((url: string) => Promise.resolve(textResponse(url)))
        await expect(fetchTextFile('a.lrc')).resolves.toBe('a.lrc')
        await expect(fetchTextFile('a.txt')).resolves.toBe('a.txt')
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('404 и HTML вместо текста — пустая строка', async () => {
        fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
        fetchMock.mockResolvedValueOnce(new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }))
        await expect(fetchTextFile('missing.lrc')).resolves.toBe('')
        await expect(fetchTextFile('spa-fallback.txt')).resolves.toBe('')
    })

    it('после сетевой ошибки следующий вызов идёт в сеть снова', async () => {
        fetchMock.mockRejectedValueOnce(new Error('offline'))
        fetchMock.mockResolvedValueOnce(textResponse('ок'))
        await expect(fetchTextFile('a.txt')).resolves.toBe('')
        await expect(fetchTextFile('a.txt')).resolves.toBe('ок')
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })
})
