// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
    TECH_EMAIL_RE,
    cleanBio,
    isReservedNick,
    nextNickChangeAt,
    nickKey,
    roleOf,
    techEmail,
    validateBio,
    validateNick,
    validatePassword
} from '../../../supabase/functions/_shared/accounts.ts'

describe('ключ ника', () => {
    it.each([
        ['Ян', 'ЯН'],
        ['Ёжик', 'ежик'],
        ['Hello', 'неllо'], // латинские H, e — кириллические
        ['Mopc', 'морс'],
        ['frnk_ness', 'FRNK.NESS'],
        ['frnk-ness', 'frnk_ness'],
        ['B0T', 'вот'],
        ['xyz', 'ХУZ']
    ])('%s = %s', (a, b) => {
        expect(nickKey(a)).toBe(nickKey(b))
    })

    it.each([
        ['ян', 'яна'],
        ['abc1', 'abc2'],
        ['и', 'й']
    ])('%s ≠ %s', (a, b) => {
        expect(nickKey(a)).not.toBe(nickKey(b))
    })

    it('й, введённая разложенной (macOS), равна обычной', () => {
        expect(nickKey('Мой'.normalize('NFD'))).toBe(nickKey('мой'))
        expect(validateNick('Мой'.normalize('NFD'))).toBeNull()
    })

    it('пробелы по краям не важны', () => {
        expect(nickKey('  frnkness ')).toBe(nickKey('frnkness'))
    })
})

describe('правила ника', () => {
    it.each(['frnkness', 'Ян_1', 'twizzy.R', 'a-b', 'Ёлка', 'абвгдеёжзийклмнопрст'])('подходит: %s', (nick) => {
        expect(validateNick(nick)).toBeNull()
    })

    it.each([
        ['ab', /от 3 до 20/],
        ['абвгдеёжзийклмнопрсту', /от 3 до 20/],
        ['ник с пробелом', /только/],
        ['nick!', /только/],
        ['<script>', /только/],
        ['ник😀', /только/],
        ['admin', /занят/],
        ['Admin_2', /занят/],
        ['аdmin', /занят/], // кириллическая «а»
        ['Администратор', /занят/],
        ['support', /занят/],
        ['moderator', /занят/],
        ['owner', /занят/],
        ['владелец', /занят/],
        ['root', /занят/]
    ])('не подходит: %s', (nick, re) => {
        expect(validateNick(nick)).toMatch(re)
    })

    it('frnkness разрешён', () => {
        expect(isReservedNick('frnkness')).toBe(false)
    })
})

describe('пароль', () => {
    it('минимум 8 символов', () => {
        expect(validatePassword('1234567', 'nick')).toMatch(/минимум 8/)
        expect(validatePassword('12345678', 'nick')).toBeNull()
    })

    it('не совпадает с ником, в том числе с другим регистром и похожими буквами', () => {
        expect(validatePassword('frnkness', 'frnkness')).toMatch(/не должен совпадать/)
        expect(validatePassword('FRNKNESS', 'frnkness')).toMatch(/не должен совпадать/)
        expect(validatePassword('frnkness1', 'frnkness')).toBeNull()
    })

    it('не длиннее 72 байт (ограничение bcrypt)', () => {
        expect(validatePassword('я'.repeat(37), 'nick')).toMatch(/длинный/)
        expect(validatePassword('я'.repeat(36), 'nick')).toBeNull()
    })
})

describe('технический адрес', () => {
    it('одинаковый для эквивалентных ников и не содержит ник', async () => {
        const a = await techEmail('Ян_Ёлкин')
        expect(a).toMatch(TECH_EMAIL_RE)
        expect(await techEmail('ян.елкин')).toBe(a)
        expect(await techEmail('ян_елкин2')).not.toBe(a)
        expect(a).not.toContain('ян')
    })

    it('совпадает с шаблоном в триггере базы', async () => {
        expect(TECH_EMAIL_RE.source).toBe('^u-[0-9a-f]{32}@id\\.frnkness\\.ru$')
    })
})

describe('прочее', () => {
    it('«о себе»: до 200 символов, без управляющих символов', () => {
        expect(cleanBio(' привет\u0000 ')).toBe('привет')
        expect(validateBio('я'.repeat(200))).toBeNull()
        expect(validateBio('я'.repeat(201))).toMatch(/до 200/)
    })

    it('роль из app_metadata', () => {
        expect(roleOf({ role: 'owner' })).toBe('owner')
        expect(roleOf({ role: 'admin' })).toBe('admin')
        expect(roleOf({ role: 'god' })).toBe('user')
        expect(roleOf(undefined)).toBe('user')
    })

    it('смена ника — раз в 30 дней', () => {
        expect(nextNickChangeAt(null)).toBeNull()
        expect(nextNickChangeAt('2026-10-01T00:00:00Z')?.toISOString()).toBe('2026-10-31T00:00:00.000Z')
    })
})
