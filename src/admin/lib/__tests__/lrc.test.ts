import { describe, it, expect } from 'vitest'
import { parseLRC } from '@/utils/lyrics'
import { fixtureText, fixtureTree } from '../../../../tests/fixtures/catalog'
import {
    activeIndex,
    buildLrc,
    cleanLrcText,
    earliestTime,
    formatLrcTime,
    formatShift,
    linesFromLrc,
    linesFromTxt,
    nextUnstamped,
    nudge,
    outOfOrder,
    parsePastedLrc,
    shiftAll,
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

    it('сдвиг всех строк вперёд и назад', () => {
        const lines: LrcLine[] = [{ text: 'a', time: 1 }, { text: 'b', time: null }, { text: 'c', time: 2.5 }]
        const fwd = shiftAll(lines, 0.1)
        expect(fwd.applied).toBe(0.1)
        expect(fwd.lines.map((l) => l.time)).toEqual([1.1, null, 2.6])
        const back = shiftAll(fwd.lines, -0.1)
        expect(back.applied).toBe(-0.1)
        expect(back.lines.map((l) => l.time)).toEqual([1, null, 2.5])
        // Исходный массив не меняется, текст и порядок сохраняются.
        expect(lines.map((l) => l.time)).toEqual([1, null, 2.5])
        expect(back.lines.map((l) => l.text)).toEqual(['a', 'b', 'c'])
    })

    it('сдвиг назад упирается в 0.00 одинаково для всех строк', () => {
        const lines: LrcLine[] = [{ text: 'a', time: 0.05 }, { text: 'b', time: 1 }, { text: 'c', time: 3 }]
        const r = shiftAll(lines, -0.1)
        expect(r.applied).toBe(-0.05)
        expect(r.lines.map((l) => l.time)).toEqual([0, 0.95, 2.95])
        const stuck = shiftAll(r.lines, -0.1)
        expect(stuck.applied).toBe(0)
        expect(stuck.lines).toBe(r.lines)
        expect(earliestTime(r.lines)).toBe(0)
        // Вперёд от нуля — можно.
        expect(shiftAll(r.lines, 0.1).lines.map((l) => l.time)).toEqual([0.1, 1.05, 3.05])
    })

    it('сдвиг округляет до сотых без накопления ошибки', () => {
        let lines: LrcLine[] = [{ text: 'a', time: 0.7 }, { text: 'b', time: 12.34 }]
        for (let i = 0; i < 30; i++) lines = shiftAll(lines, 0.1).lines
        expect(lines.map((l) => l.time)).toEqual([3.7, 15.34])
        for (let i = 0; i < 30; i++) lines = shiftAll(lines, -0.1).lines
        expect(lines.map((l) => l.time)).toEqual([0.7, 12.34])
        expect(buildLrc(lines)).toBe('[00:00.70]a\n[00:12.34]b\n')
    })

    it('сдвиг сохраняет порядок строк, даже неотсортированных', () => {
        const lines: LrcLine[] = [{ text: 'a', time: 5 }, { text: 'b', time: 3 }, { text: 'c', time: 6 }]
        const r = shiftAll(lines, -3.5)
        expect(r.applied).toBe(-3)
        expect(r.lines.map((l) => [l.text, l.time])).toEqual([['a', 2], ['b', 0], ['c', 3]])
    })

    it('сдвиг без отмеченных строк ничего не делает', () => {
        const lines: LrcLine[] = [{ text: 'a', time: null }]
        expect(shiftAll(lines, 0.1)).toEqual({ lines, applied: 0 })
        expect(earliestTime(lines)).toBeNull()
    })

    it('подпись накопленного сдвига', () => {
        expect(formatShift(0)).toBe('0.0 с')
        expect(formatShift(0.30000000000000004)).toBe('+0.3 с')
        expect(formatShift(-0.1)).toBe('−0.1 с')
        expect(formatShift(-0.05)).toBe('−0.05 с')
        expect(formatShift(1.25)).toBe('+1.25 с')
    })

    it('вставка готового .lrc: форматы меток, метаданные, повторы', () => {
        const r = parsePastedLrc(
            '[ar:frnk ness]\r\n[ti:FAAA]\n[00:01.5]Раз\n[00:02.345]Два\n[00:03:10]Три\n[00:04]Четыре\n[00:10.00][00:20.00]Припев\nбез метки\n[00:30.00]\n\n'
        )
        expect(r.lines).toEqual([
            { text: 'Раз', time: 1.5 },
            { text: 'Два', time: 2.35 },
            { text: 'Три', time: 3.1 },
            { text: 'Четыре', time: 4 },
            { text: 'Припев', time: 10 },
            { text: 'Припев', time: 20 }
        ])
        expect(r.skipped).toBe(2)
        // То, что собрали из вставки, сохраняется в формате сайта.
        expect(buildLrc(r.lines)).toBe('[00:01.50]Раз\n[00:02.35]Два\n[00:03.10]Три\n[00:04.00]Четыре\n[00:10.00]Припев\n[00:20.00]Припев\n')
    })

    it('вставка: строки по времени, при равном времени — по порядку', () => {
        expect(parsePastedLrc('[00:05.00]Б\n[00:01.00]А\n[00:05.00]В').lines.map((l) => l.text)).toEqual(['А', 'Б', 'В'])
        expect(parsePastedLrc('просто текст').lines).toEqual([])
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
