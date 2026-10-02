import { describe, it, expect } from 'vitest'
import { lyricsBookFilename } from '../lyricsBook'

describe('lyricsBookFilename', () => {
    it('собирает имя из названия релиза', () => {
        expect(lyricsBookFilename('Злая Ностальгия')).toBe('frnk ness — Злая Ностальгия (тексты).pdf')
    })

    it('убирает символы, запрещённые в именах файлов', () => {
        expect(lyricsBookFilename('Most Venture Poopsicks / Last Over V')).toBe('frnk ness — Most Venture Poopsicks - Last Over V (тексты).pdf')
        expect(lyricsBookFilename('Disinvolto: Danilovsky')).toBe('frnk ness — Disinvolto Danilovsky (тексты).pdf')
        expect(lyricsBookFilename('какой тебе боксик?')).toBe('frnk ness — какой тебе боксик (тексты).pdf')
    })
})
