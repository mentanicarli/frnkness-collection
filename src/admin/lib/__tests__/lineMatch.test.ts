import { describe, it, expect } from 'vitest'
import { lineSimilarity, matchLines, relinkAnnotations, SIMILARITY_THRESHOLD } from '../lineMatch'
import { followLrc } from '../lrcFollow'
import { moveNote } from '../notesEdit'

const OLD = [
    'Пупсики (смешное имя)',
    'Один спортзал, один футбол, один IT',
    'Мы на тихом, но понтуемся так громко',
    'Темки, темки, темки',
    'Да наш дяхан — это псих'
]

describe('сопоставление строк до и после правки', () => {
    it('без изменений — каждая строка на своём месте', () => {
        expect(matchLines(OLD, OLD)).toEqual([0, 1, 2, 3, 4])
    })

    it('опечатка', () => {
        const next = [...OLD]
        next[1] = 'Один спортзал, один фудбол, один IT'
        expect(matchLines(OLD, next)).toEqual([0, 1, 2, 3, 4])
    })

    it('изменение знаков и регистра — это та же строка', () => {
        const next = [...OLD]
        next[3] = 'Темки — темки, темки!'
        next[4] = 'да наш дяхан это псих'
        expect(matchLines(OLD, next)).toEqual([0, 1, 2, 3, 4])
    })

    it('замена слова', () => {
        const next = [...OLD]
        next[2] = 'Мы на тихом, но выпендриваемся так громко'
        expect(matchLines(OLD, next)[2]).toBe(2)
    })

    it('удалённая строка — null, остальные на месте', () => {
        const next = OLD.filter((_, i) => i !== 2)
        expect(matchLines(OLD, next)).toEqual([0, 1, null, 2, 3])
    })

    it('строку переписали до неузнаваемости — не угадываем', () => {
        const next = [...OLD]
        next[2] = 'Совсем другая мысль про вечер'
        expect(matchLines(OLD, next)[2]).toBeNull()
        expect(lineSimilarity(OLD[2], next[2])).toBeLessThan(SIMILARITY_THRESHOLD)
    })

    it('переставленные строки', () => {
        const next = [OLD[0], OLD[3], OLD[1], OLD[2], OLD[4]]
        expect(matchLines(OLD, next)).toEqual([0, 2, 3, 1, 4])
    })

    it('повторяющийся припев: каждое вхождение — на своё место', () => {
        const old = ['Припев раз', 'Припев два', 'Куплет про двор', 'Припев раз', 'Припев два']
        const next = ['Припев раз', 'Припев два', 'Куплет про наш двор', 'Припев раз', 'Припев два', 'Новая строка']
        expect(matchLines(old, next)).toEqual([0, 1, 2, 3, 4])
        // Правка в первом припеве не утаскивает второй.
        const edited = ['Припев раз!', 'Припев двa', 'Куплет про двор', 'Припев раз', 'Припев два']
        expect(matchLines(old, edited)).toEqual([0, 1, 2, 3, 4])
    })

    it('добавленная строка перед изменённой не сбивает позицию', () => {
        const next = [OLD[0], 'Вставили новую строку', 'Один спортзал, один фудбол, один IT', ...OLD.slice(2)]
        expect(matchLines(OLD, next)).toEqual([0, 2, 3, 4, 5])
    })
})

describe('перенос разборов', () => {
    const notes = [
        { line: 'Один спортзал, один футбол, один IT', note: 'Три увлечения' },
        { line: 'Да наш дяхан — это псих', note: 'Дяхан — Макс' }
    ]

    it('изменённая строка — разбор переезжает, остальные не трогаются', () => {
        const next = [...OLD]
        next[1] = 'Один спортзал, один фудбол, один IT'
        const r = relinkAnnotations(OLD, next, notes)
        expect(r.annotations).toEqual([{ line: next[1], note: 'Три увлечения' }, notes[1]])
        expect(r.moved).toEqual([{ from: OLD[1], to: next[1] }])
    })

    it('удалённая и переписанная строка — разбор остаётся висеть', () => {
        const removed = relinkAnnotations(OLD, OLD.filter((_, i) => i !== 1), notes)
        expect(removed.moved).toEqual([])
        expect(removed.annotations).toBe(notes)
        const next = [...OLD]
        next[1] = 'Совсем про другое'
        expect(relinkAnnotations(OLD, next, notes).moved).toEqual([])
    })

    it('цепочка мелких правок не уводит разбор далеко от исходной строки', () => {
        const next = [...OLD]
        next[1] = 'Один зал, ноль футбола, без айти, но с котом'
        const r = relinkAnnotations([...OLD.slice(0, 1), 'Один зал, ноль футбола, один IT', ...OLD.slice(2)], next, [{ line: 'Один зал, ноль футбола, один IT', note: 'x' }], () => OLD[1])
        expect(r.moved).toEqual([])
    })

    it('строка, на которую переезжал бы разбор, уже со своим разбором — не трогаем', () => {
        const old = ['Раз два три', 'Раз два три четыре']
        const next = ['Раз два три четыре']
        const r = relinkAnnotations(old, next, [{ line: 'Раз два три', note: 'a' }, { line: 'Раз два три четыре', note: 'b' }])
        expect(r.moved).toEqual([])
    })
})

describe('ручная привязка разбора', () => {
    const list = [
        { line: 'Старая строка,', note: 'a' },
        { line: 'Вторая', note: 'b' },
        { line: 'Третья', note: 'c' }
    ]

    it('разбор остаётся на своём месте в списке', () => {
        expect(moveNote(list, 'Старая строка,', 'Новая строка')).toEqual([{ line: 'Новая строка', note: 'a' }, list[1], list[2]])
    })

    it('прежний разбор целевой строки заменяется', () => {
        expect(moveNote(list, 'Старая строка', 'третья!')).toEqual([{ line: 'третья!', note: 'a' }, list[1]])
    })

    it('та же строка — без изменений', () => {
        expect(moveNote(list, 'Вторая', 'вторая.')).toBe(list)
    })
})

describe('.lrc вслед за текстом', () => {
    const TXT = '[Припев]\nРаз, два\nТри четыре\n\n[Куплет]\nПять\n'
    const LRC = '[00:01.00]Раз, два\n[00:02.50]Три четыре\n[00:04.00]Пять\n'

    it('изменён текст строки — та же строка в .lrc с прежним таймкодом', () => {
        const r = followLrc(TXT, TXT.replace('Три четыре', 'Три, четыре!'), LRC)
        expect(r).toEqual({
            kind: 'update',
            changes: [{ index: 1, from: 'Три четыре', to: 'Три, четыре!' }],
            content: '[00:01.00]Раз, два\n[00:02.50]Три, четыре!\n[00:04.00]Пять\n'
        })
    })

    it('метки секций и пустые строки не считаются строками', () => {
        expect(followLrc(TXT, TXT.replace('[Куплет]', '[Куплет 2]').replace('\n\n', '\n\n\n'), LRC)).toEqual({ kind: 'none' })
    })

    it('строк стало больше или меньше — .lrc не трогаем', () => {
        expect(followLrc(TXT, TXT + 'Шесть\n', LRC)).toEqual({ kind: 'structure', before: 3, after: 4 })
        expect(followLrc(TXT, TXT.replace('Пять\n', ''), LRC)).toEqual({ kind: 'structure', before: 3, after: 2 })
    })

    it('.lrc и раньше не совпадал с текстом — не правим, предупреждаем', () => {
        expect(followLrc(TXT, TXT.replace('Пять', 'Пять!'), '[00:01.00]Раз, два\n[00:04.00]Пять\n')).toEqual({ kind: 'mismatch' })
    })

    it('нет .lrc — ничего', () => {
        expect(followLrc(TXT, TXT.replace('Пять', 'Пять!'), null)).toEqual({ kind: 'none' })
    })
})
