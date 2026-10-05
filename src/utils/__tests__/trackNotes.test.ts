import { describe, it, expect } from 'vitest'
import {
    buildNoteMap,
    findDanglingAnnotations,
    isSectionLabel,
    layoutLyrics,
    normalizeLine,
    validateTrackNotes
} from '../trackNotes'

describe('normalizeLine', () => {
    it('ignores case, inner whitespace and edge punctuation', () => {
        // Закрывающая скобка на краю тоже срезается — так работал сайт и раньше.
        expect(normalizeLine('  Пупсики   (смешное имя),  ')).toBe('пупсики (смешное имя')
        expect(normalizeLine('«Привет!»')).toBe('привет')
        expect(normalizeLine('Темки, темки, темки —')).toBe('темки, темки, темки')
    })

    it('keeps punctuation inside the line', () => {
        expect(normalizeLine('Да наш дяхан — это псих.')).toBe('да наш дяхан — это псих')
    })

    it('handles empty values', () => {
        expect(normalizeLine(undefined)).toBe('')
        expect(normalizeLine(null)).toBe('')
    })
})

describe('isSectionLabel', () => {
    it('detects section labels', () => {
        expect(isSectionLabel('[Припев]')).toBe(true)
        expect(isSectionLabel('  [Куплет 2] ')).toBe(true)
        expect(isSectionLabel('[Припев] и строка')).toBe(false)
        expect(isSectionLabel('Обычная строка')).toBe(false)
    })
})

describe('buildNoteMap', () => {
    it('skips incomplete entries and normalizes keys', () => {
        const map = buildNoteMap({
            annotations: [
                { line: 'Строка один,', note: 'раз' },
                { line: '', note: 'нет строки' },
                { line: 'Строка два', note: '' }
            ]
        })
        expect([...map.entries()]).toEqual([['строка один', 'раз']])
    })

    it('tolerates missing entry', () => {
        expect(buildNoteMap(null).size).toBe(0)
        expect(buildNoteMap({}).size).toBe(0)
    })
})

describe('layoutLyrics', () => {
    const text = '[Припев]\nПупсики,\nЕщё строка\n\n[Припев]\nпупсики\n[Куплет]'
    const map = buildNoteMap({ annotations: [{ line: 'Пупсики', note: 'название' }, { line: '[Припев]', note: 'метка' }] })

    it('annotates only the first occurrence', () => {
        const rows = layoutLyrics(text, map)
        const annotated = rows.filter((r) => r.kind === 'line' && r.note)
        expect(annotated).toHaveLength(1)
        expect(rows[1]).toMatchObject({ kind: 'line', text: 'Пупсики,', note: 'название' })
        expect(rows[5]).toMatchObject({ kind: 'line', text: 'пупсики', note: null })
    })

    it('never attaches notes to section labels', () => {
        const rows = layoutLyrics(text, map)
        expect(rows[0]).toEqual({ kind: 'section', text: '[Припев]' })
        expect(rows[3]).toEqual({ kind: 'blank' })
    })
})

// Отрисовка текста и «О треке» — src/site/__tests__/components.test.ts.

describe('findDanglingAnnotations', () => {
    it('reports annotations whose line is gone or is a label', () => {
        const dangling = findDanglingAnnotations('[Припев]\nОстался,\n', {
            annotations: [
                { line: 'остался', note: 'ok' },
                { line: 'Удалён', note: 'висит' },
                { line: '[Припев]', note: 'метка' }
            ]
        })
        expect(dangling.map((a) => a.line)).toEqual(['Удалён', '[Припев]'])
    })
})

describe('validateTrackNotes', () => {
    it('accepts valid notes', () => {
        expect(validateTrackNotes({ about: 'x', annotations: [{ line: 'a', note: 'b' }] })).toEqual([])
        expect(validateTrackNotes({})).toEqual([])
    })

    it('rejects broken structures', () => {
        expect(validateTrackNotes([])).toEqual(['ожидается объект'])
        expect(validateTrackNotes({ about: 1, extra: true, annotations: [{ line: '', note: 'x' }] })).toEqual([
            'лишнее поле «extra»',
            '«about» должно быть строкой',
            'разбор #1: пустая строка'
        ])
    })
})
