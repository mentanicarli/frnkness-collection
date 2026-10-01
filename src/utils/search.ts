/**
 * Сопоставление поискового запроса с текстом: только с начала слова.
 *
 * «Ян» находит «Ян», «Яна», «Яном», но не «натянули» и не «кьянти».
 * \b в JS-регулярках кириллицу не понимает, поэтому граница слова задаётся
 * через Unicode-классы: перед совпадением не должно быть буквы или цифры.
 */

// Ранг совпадения: чем больше, тем выше в выдаче.
export const MATCH_NONE = 0
export const MATCH_PREFIX = 1 // запрос — начало слова: «Ян» → «Яна»
export const MATCH_WORD = 2 // слово (фраза) совпало целиком: «Ян» → «Ян,»

export type MatchRank = typeof MATCH_NONE | typeof MATCH_PREFIX | typeof MATCH_WORD
export type Matcher = (text: string) => MatchRank

/**
 * Нормализация для поиска: нижний регистр, ё → е, пробелы схлопнуты.
 */
export function normalizeForSearch(value: string): string {
    return (value || '')
        .toString()
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/\s+/g, ' ')
        .trim()
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
}

const WORD_START = '(?<![\\p{L}\\p{N}])'
const WORD_END = '(?![\\p{L}\\p{N}])'

/**
 * Собирает функцию сопоставления для запроса. Запрос из нескольких слов
 * ищется как фраза (между словами — любые пробелы). Пустой запрос ничего
 * не находит.
 */
export function createMatcher(query: string): Matcher {
    const normalized = normalizeForSearch(query)
    if (!normalized) return () => MATCH_NONE
    const phrase = normalized.split(' ').map(escapeRegExp).join('\\s+')
    const prefix = new RegExp(WORD_START + phrase, 'u')
    const whole = new RegExp(WORD_START + phrase + WORD_END, 'u')
    return (text: string) => {
        const target = normalizeForSearch(text)
        if (!prefix.test(target)) return MATCH_NONE
        return whole.test(target) ? MATCH_WORD : MATCH_PREFIX
    }
}
