import { describe, it, expect } from 'vitest'
import { createMatcher, normalizeForSearch, MATCH_NONE, MATCH_PREFIX, MATCH_WORD } from '../search'

describe('createMatcher: поиск с начала слова', () => {
    const yan = createMatcher('Ян')

    it('находит слово целиком', () => {
        expect(yan('Ян')).toBe(MATCH_WORD)
        expect(yan('Привет, Ян!')).toBe(MATCH_WORD)
        expect(yan('и ян пошёл')).toBe(MATCH_WORD)
    })

    it('находит по началу слова', () => {
        expect(yan('Яна')).toBe(MATCH_PREFIX)
        expect(yan('звонил Яну')).toBe(MATCH_PREFIX)
        expect(yan('с Яном')).toBe(MATCH_PREFIX)
    })

    it('не находит внутри слова', () => {
        expect(yan('натянули')).toBe(MATCH_NONE)
        expect(yan('тянет')).toBe(MATCH_NONE)
        expect(yan('девяносто')).toBe(MATCH_NONE)
        expect(yan('кьянти')).toBe(MATCH_NONE)
    })

    it('целое слово ранжируется выше, если в строке есть оба варианта', () => {
        expect(yan('Яна и Ян')).toBe(MATCH_WORD)
    })

    it('граница слова — не только пробел: дефис, кавычки, цифры', () => {
        expect(yan('супер-Ян')).toBe(MATCH_WORD)
        expect(yan('«Яна»')).toBe(MATCH_PREFIX)
        expect(yan('2Ян')).toBe(MATCH_NONE)
    })

    it('без учёта регистра и ё = е', () => {
        expect(createMatcher('ЁЖ')('ежик')).toBe(MATCH_PREFIX)
        expect(createMatcher('еж')('Ёжик')).toBe(MATCH_PREFIX)
        expect(createMatcher('пошел')('он пошёл домой')).toBe(MATCH_WORD)
        expect(createMatcher('ПОШЁЛ')('Пошел')).toBe(MATCH_WORD)
    })

    it('несколько слов — фраза с начала слова', () => {
        const m = createMatcher('топ один')
        expect(m('Случайно взяли топ один')).toBe(MATCH_WORD)
        expect(m('топ одиночество')).toBe(MATCH_PREFIX)
        expect(m('стоп один')).toBe(MATCH_NONE)
        expect(m('один топ')).toBe(MATCH_NONE)
        expect(createMatcher('  топ   один ')('топ    один')).toBe(MATCH_WORD)
    })

    it('латиница и цифры тоже с начала слова', () => {
        expect(createMatcher('poop')('POOPSICKS')).toBe(MATCH_PREFIX)
        expect(createMatcher('sicks')('POOPSICKS')).toBe(MATCH_NONE)
        expect(createMatcher('2')('back to poopsicks 2')).toBe(MATCH_WORD)
    })

    it('спецсимволы запроса экранируются', () => {
        expect(createMatcher('(ft.')('Lost Memory (ft. twizzyRRich)')).toBe(MATCH_WORD)
        expect(createMatcher('(ft. twiz')('Lost Memory (ft. twizzyRRich)')).toBe(MATCH_PREFIX)
        expect(createMatcher('a.c')('abc')).toBe(MATCH_NONE)
        expect(createMatcher('[припев')('текст')).toBe(MATCH_NONE)
        expect(() => createMatcher('*+?^$|\\/')('x')).not.toThrow()
    })

    it('пустой запрос ничего не находит', () => {
        expect(createMatcher('')('Ян')).toBe(MATCH_NONE)
        expect(createMatcher('   ')('Ян')).toBe(MATCH_NONE)
    })
})

describe('normalizeForSearch', () => {
    it('нижний регистр, ё → е, схлопнутые пробелы', () => {
        expect(normalizeForSearch('  Ёлка   ЗЕЛЁНАЯ ')).toBe('елка зеленая')
    })
})
