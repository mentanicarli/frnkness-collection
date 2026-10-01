import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { isNotesEmpty, noteFor, normalizeNewlines, parseNotes, removeNote, serializeNotes, setNote } from '../notesEdit'
import { buildNoteMap, findDanglingAnnotations } from '@/utils/trackNotes'

describe('notesEdit', () => {
    it('сериализация совпадает с существующими файлами байт в байт', () => {
        const dir = path.resolve(__dirname, '../../../../lyrics')
        const files: string[] = []
        const walk = (d: string) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, e.name)
                if (e.isDirectory()) walk(full)
                else if (e.name.endsWith('.notes.json')) files.push(full)
            }
        }
        walk(dir)
        expect(files.length).toBeGreaterThan(10)
        for (const f of files) {
            const original = normalizeNewlines(fs.readFileSync(f, 'utf8'))
            const { notes, error } = parseNotes(original)
            expect(error, f).toBeNull()
            expect(serializeNotes(notes), f).toBe(original)
        }
    })

    it('пустые поля не пишутся, пробелы по краям убираются', () => {
        expect(serializeNotes({ about: '  ', annotations: [{ line: ' a ', note: '' }] })).toBe('{}\n')
        expect(serializeNotes({ about: 'Текст\r\n\r\nВторой ' })).toBe('{\n  "about": "Текст\\n\\nВторой"\n}\n')
        expect(isNotesEmpty({ about: ' ', annotations: [] })).toBe(true)
        expect(isNotesEmpty({ annotations: [{ line: 'a', note: 'b' }] })).toBe(false)
    })

    it('parseNotes: отсутствующий, битый и некорректный файл', () => {
        expect(parseNotes(null)).toEqual({ notes: {}, error: null })
        expect(parseNotes('{oops').error).toMatch(/повреждён/)
        expect(parseNotes('{"annotations": 5}').error).toMatch(/некорректен/)
    })

    it('setNote: добавить, изменить, удалить по нормализованной строке', () => {
        let list = setNote([], 'Пупсики (смешное имя),', 'Первое появление')
        expect(list).toEqual([{ line: 'Пупсики (смешное имя),', note: 'Первое появление' }])
        list = setNote(list, '  пупсики (смешное имя) ', 'Новый текст')
        expect(list).toEqual([{ line: 'Пупсики (смешное имя),', note: 'Новый текст' }])
        list = setNote(list, 'Вторая строка', 'x')
        expect(noteFor(list, 'вторая строка.')).toBe('x')
        list = removeNote(list, 'Пупсики (смешное имя)')
        expect(list).toEqual([{ line: 'Вторая строка', note: 'x' }])
    })

    it('дубли одной строки схлопываются в одну запись', () => {
        const list = [
            { line: 'a', note: '1' },
            { line: 'b', note: '2' },
            { line: 'A,', note: '3' }
        ]
        expect(noteFor(list, 'a')).toBe('3') // как buildNoteMap на сайте
        expect(buildNoteMap({ annotations: list }).get('a')).toBe('3')
        expect(setNote(list, 'a', '4')).toEqual([
            { line: 'a', note: '4' },
            { line: 'b', note: '2' }
        ])
    })

    it('после правки текста видны «висящие» разборы', () => {
        const notes = { annotations: [{ line: 'Старая строка', note: 'x' }, { line: 'Осталась', note: 'y' }] }
        expect(findDanglingAnnotations('Осталась\nНовая строка', notes).map((a) => a.line)).toEqual(['Старая строка'])
    })
})
