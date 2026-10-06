import { describe, it, expect } from 'vitest'
import { MAX_NEXT_LENGTH, sanitizeNext, welcomeLocation } from '../auth/redirect'

describe('адрес возврата после входа', () => {
    it.each(['/track/zlaya-nostalgia/makanochki', '/chart', '/release/x?tab=1', '/me#top', '/'])('внутренний путь: %s', (path) => {
        expect(sanitizeNext(path)).toBe(path)
    })

    it.each([
        ['https://evil.example', 'чужой сайт'],
        ['//evil.example/x', 'протокол-относительный адрес'],
        ['/\\evil.example', 'обратный слэш'],
        ['\\\\evil.example', 'обратные слэши'],
        ['javascript:alert(1)', 'javascript:'],
        ['/javascript:alert(1)', 'схема в первом сегменте'],
        ['track/x', 'без ведущего слэша'],
        ['/track/x\n', 'перевод строки'],
        ['/ tab', 'пробел'],
        ['', 'пусто'],
        ['/login', 'экран входа'],
        ['/register?next=/chart', 'экран регистрации'],
        ['/change-password', 'смена пароля'],
        [`/${'a'.repeat(MAX_NEXT_LENGTH)}`, 'слишком длинный']
    ])('отбрасывается: %s (%s)', (path) => {
        expect(sanitizeNext(path)).toBeNull()
    })

    it('не строка — null, массив из query — первый элемент', () => {
        expect(sanitizeNext(undefined)).toBeNull()
        expect(sanitizeNext(42)).toBeNull()
        expect(sanitizeNext(['/chart', '/me'])).toBe('/chart')
    })

    it('заставка запоминает адрес, кроме главной', () => {
        expect(welcomeLocation('/track/a/b')).toEqual({ name: 'welcome', query: { next: '/track/a/b' } })
        expect(welcomeLocation('/')).toEqual({ name: 'welcome' })
        expect(welcomeLocation('//evil')).toEqual({ name: 'welcome' })
    })
})
