import { describe, it, expect } from 'vitest'
import { parseLRC } from '@/utils/lyrics'
import { fixtureText, fixtureTree } from '../../../../tests/fixtures/catalog'
import {
    activeIndex,
    buildLrc,
    cleanLrcText,
    formatLrcTime,
    linesFromLrc,
    linesFromTxt,
    nextUnstamped,
    nudge,
    outOfOrder,
    stamp,
    undoStamp,
    type LrcLine
} from '../lrc'

const read = (rel: string) => fixtureText(`lyrics/${rel}`)!

describe('строки для LRC из .txt', () => {
    it('переносит текст дословно, ничего не срезая с конца', () => {
        expect(cleanLrcText('Пупсики (смешное имя)')).toBe('Пупсики (смешное имя)')
        expect(cleanLrcText('(Бля, не помню.)')).toBe('(Бля, не помню.)')
        expect(cleanLrcText('Кто здесь?')).toBe('Кто здесь?')
        expect(cleanLrcText('Давай!')).toBe('Давай!')
        expect(cleanLrcText('«Маке»')).toBe('«Маке»')
        // Если знак в конце всё же есть, он остаётся: .lrc должен совпасть с .txt.
        expect(cleanLrcText('Один спортзал, один футбол, один IT.')).toBe('Один спортзал, один футбол, один IT.')
        expect(cleanLrcText('Темки, темки, темки —')).toBe('Темки, темки, темки —')
    })

    it('схлопывает пробелы', () => {
        expect(cleanLrcText('  Раз   два  ')).toBe('Раз два')
    })

    it('пропускает пустые строки и метки секций', () => {
        expect(linesFromTxt('[Припев]\nРаз\n\n  [Куплет 1]  \nДва\r\n')).toEqual(['Раз', 'Два'])
    })

    it('совпадает с готовым .lrc для POOPSICKS (кроме разговорной вставки)', () => {
        const fromTxt = linesFromTxt(read('album1/01-poopsicks.txt'))
        const fromLrc = linesFromLrc(read('album1/01-poopsicks.lrc')).map((l) => l.text)
        // Первые 29 строк совпадают один в один; дальше в .lrc реплика склеена в одну строку.
        expect(fromTxt.slice(0, 29)).toEqual(fromLrc.slice(0, 29))
    })

    it('каждая строка готового .lrc дословно есть в .txt', () => {
        for (const slug of ['album1/02-back-to-poopsicks-2', 'singles/faaa', 'singles/boxik']) {
            const fromTxt = linesFromTxt(read(`${slug}.txt`))
            const fromLrc = linesFromLrc(read(`${slug}.lrc`)).map((l) => l.text)
            for (const line of fromLrc) expect(fromTxt).toContain(line)
        }
    })
})

describe('формат времени и сборка файла', () => {
    it('[mm:ss.xx]', () => {
        expect(formatLrcTime(0)).toBe('00:00.00')
        expect(formatLrcTime(11.37)).toBe('00:11.37')
        expect(formatLrcTime(65.005)).toBe('01:05.01')
        expect(formatLrcTime(59.999)).toBe('01:00.00')
        expect(formatLrcTime(754.2)).toBe('12:34.20')
        expect(formatLrcTime(-1)).toBe('00:00.00')
    })

    it('результат парсится parseLRC с сайта', () => {
        const lines: LrcLine[] = [
            { text: 'Первая', time: 11.37 },
            { text: 'Вторая (с скобкой)', time: 14.86 },
            { text: 'Без отметки', time: null },
            { text: 'Третья', time: 75.5 }
        ]
        const lrc = buildLrc(lines)
        expect(lrc).toBe('[00:11.37]Первая\n[00:14.86]Вторая (с скобкой)\n[01:15.50]Третья\n')
        const parsed = parseLRC(lrc)
        expect(parsed.map((l) => l.text)).toEqual(['Первая', 'Вторая (с скобкой)', 'Третья'])
        expect(parsed[0].time).toBeCloseTo(11.37)
        expect(parsed[2].time).toBeCloseTo(75.5)
    })

    it('.lrc в формате репозитория проходят круг «разобрать → собрать» без изменений', () => {
        const files = fixtureTree()
            .map((f) => f.path)
            .filter((p) => p.endsWith('.lrc'))
            .map((p) => p.replace(/^lyrics\//, ''))
        expect(files.length).toBeGreaterThan(3)
        for (const f of files) {
            const original = read(f)
            const rebuilt = buildLrc(linesFromLrc(original))
            expect(rebuilt.trimEnd(), f).toBe(original.trimEnd())
        }
    })
})

describe('синхронизация', () => {
    const base = (): LrcLine[] => ['a', 'b', 'c'].map((text) => ({ text, time: null }))

    it('Пробел ставит время следующей строке, Backspace отменяет последнюю', () => {
        let lines = stamp(base(), 1.234)
        lines = stamp(lines, 2.5)
        expect(lines.map((l) => l.time)).toEqual([1.23, 2.5, null])
        expect(nextUnstamped(lines)).toBe(2)
        lines = undoStamp(lines)
        expect(lines.map((l) => l.time)).toEqual([1.23, null, null])
        lines = stamp(stamp(stamp(lines, 3), 4), 5)
        expect(nextUnstamped(lines)).toBe(3)
        expect(stamp(lines, 9)).toBe(lines)
        expect(undoStamp(base())).toEqual(base())
    })

    it('точная подстройка ±0.1 с', () => {
        let lines = stamp(base(), 1)
        lines = nudge(lines, 0, 0.1)
        lines = nudge(lines, 0, 0.1)
        expect(lines[0].time).toBe(1.2)
        lines = nudge(lines, 0, -5)
        expect(lines[0].time).toBe(0)
        expect(nudge(lines, 1, 0.1)[1].time).toBeNull()
    })

    it('строки не по порядку', () => {
        expect(outOfOrder([{ text: 'a', time: 5 }, { text: 'b', time: 3 }, { text: 'c', time: 6 }, { text: 'd', time: null }])).toEqual([1])
    })

    it('активная строка — как в караоке на сайте', () => {
        const lines = [{ text: 'a', time: 10 }, { text: 'b', time: 20 }, { text: 'c', time: null }]
        expect(activeIndex(lines, 0)).toBe(0)
        expect(activeIndex(lines, 15)).toBe(0)
        expect(activeIndex(lines, 20)).toBe(1)
        expect(activeIndex(lines, 99)).toBe(1)
    })
})
