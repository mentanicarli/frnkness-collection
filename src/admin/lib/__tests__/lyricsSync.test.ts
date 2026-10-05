import { describe, it, expect } from 'vitest'
import { activeLine, lineTime, songLines, syncPoints } from '../lyricsSync'

const TEXT = '[Куплет 1]\nРаз, два\nТри четыре\n\n[Припев]\nПрипев!\nКонец\n\n[Припев]\nПрипев!\nКонец'

describe('подсветка строки в «Текстах»', () => {
    it('строки песни — без пустых и меток секций', () => {
        expect(songLines(TEXT)).toEqual(['Раз, два', 'Три четыре', 'Припев!', 'Конец', 'Припев!', 'Конец'])
    })

    it('сопоставление без учёта регистра и знаков на краях, повторы по порядку', () => {
        const lrc = [
            { text: 'раз, два.', time: 1 },
            { text: '«Три четыре»', time: 3 },
            { text: 'Припев', time: 5 },
            { text: 'Конец', time: 7 },
            { text: 'ПРИПЕВ!', time: 9 },
            { text: 'Конец', time: 11 }
        ]
        expect(syncPoints(songLines(TEXT), lrc).map((p) => p.line)).toEqual([0, 1, 2, 3, 4, 5])
    })

    it('строки, которых нет в тексте, и неотмеченные пропускаются', () => {
        const points = syncPoints(songLines(TEXT), [
            { text: 'Раз, два', time: 1 },
            { text: 'Такой строки нет', time: 2 },
            { text: 'Три четыре', time: null },
            { text: 'Конец', time: 4 }
        ])
        expect(points).toEqual([{ time: 1, line: 0 }, { time: 4, line: 3 }])
    })

    it('повтор без пары дальше по тексту — ищется с начала', () => {
        const points = syncPoints(['А', 'Б'], [{ text: 'А', time: 1 }, { text: 'Б', time: 2 }, { text: 'А', time: 3 }])
        expect(points.map((p) => p.line)).toEqual([0, 1, 0])
    })

    it('звучащая строка и время строки', () => {
        const points = [{ time: 10, line: 0 }, { time: 20, line: 2 }, { time: 30, line: 0 }]
        expect(activeLine(points, 5)).toBe(-1)
        expect(activeLine(points, 10)).toBe(0)
        expect(activeLine(points, 25)).toBe(2)
        expect(activeLine(points, 31)).toBe(0)
        expect(lineTime(points, 0)).toBe(10)
        expect(lineTime(points, 2)).toBe(20)
        expect(lineTime(points, 1)).toBeNull()
    })
})
