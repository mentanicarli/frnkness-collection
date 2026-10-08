import { describe, it, expect } from 'vitest'
import { currentPage, parseBrowser, scrubText, trimStack } from '../diagnostics'

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop'
const UUID = '123e4567-e89b-12d3-a456-426614174000'

describe('вычистка личных данных', () => {
    it('токены, пароли, почта, uuid, параметры адреса и длинные строки заменяются', () => {
        const text = scrubText(`fail Bearer ${'a'.repeat(30)} password=hunter2 token: "abc123" ${JWT} me@example.com ${UUID} /x?access_token=ZZZ&y=1 ${'k'.repeat(50)}`, 1000)
        for (const secret of ['hunter2', 'abc123', JWT, 'me@example.com', UUID, 'ZZZ', 'a'.repeat(30), 'k'.repeat(50)]) expect(text).not.toContain(secret)
        expect(text).toContain('[email]')
        expect(text).toContain('[id]')
    })

    it('обычный текст остаётся как есть; длина режется', () => {
        expect(scrubText('TypeError: x is not a function', 100)).toBe('TypeError: x is not a function')
        expect(scrubText('ы'.repeat(50) + ' ' + 'д'.repeat(50), 20)).toHaveLength(20)
        expect(scrubText(null, 10)).toBe('')
    })

    it('стек: не больше восьми строк, без параметров адреса', () => {
        const stack = Array.from({ length: 20 }, (_, i) => `    at f${i} (https://frnkness.ru/a.js?token=S${i}:1:2)`).join('\n')
        const out = trimStack(stack)
        expect(out.split('\n')).toHaveLength(8)
        expect(out).not.toContain('token=S')
        expect(trimStack(undefined)).toBe('')
    })

    it('страница: путь и «#/…» без параметров', () => {
        expect(currentPage({ pathname: '/', hash: '#/welcome?next=/room/' + UUID })).toBe('/#/welcome')
        expect(currentPage({ pathname: '/', hash: '#/track/a/b' })).toBe('/#/track/a/b')
        expect(currentPage({ pathname: '/', hash: '#/room/' + UUID })).toBe('/#/room/[id]')
    })
})

describe('браузер без полной строки User-Agent', () => {
    it.each([
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', 'Chrome 126 / Windows'],
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari 17 / iOS'],
        ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 YaBrowser/24.4.0.0', 'Yandex 24 / Android'],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0', 'Firefox 127 / Windows'],
        ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0.2592.81', 'Edge 126 / Windows'],
        ['странный агент', 'Browser']
    ])('%s', (ua, expected) => {
        expect(parseBrowser(ua)).toBe(expected)
    })
})
