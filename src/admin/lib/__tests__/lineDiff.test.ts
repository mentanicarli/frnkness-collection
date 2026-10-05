import { describe, it, expect } from 'vitest'
import { compactDiff, hasChanges, lineDiff } from '../lineDiff'

describe('разница версий при конфликте', () => {
    it('изменённая строка — удаление и добавление, остальное без изменений', () => {
        expect(lineDiff('[00:01.00]А\n[00:02.00]Б\n[00:03.00]В\n', '[00:01.00]А\n[00:02.50]Б\n[00:03.00]В\n')).toEqual([
            { kind: 'same', text: '[00:01.00]А' },
            { kind: 'del', text: '[00:02.00]Б' },
            { kind: 'add', text: '[00:02.50]Б' },
            { kind: 'same', text: '[00:03.00]В' }
        ])
    })

    it('вставка и удаление строк, CRLF не считается изменением', () => {
        const d = lineDiff('a\r\nb\r\nc', 'a\nc\nd\n')!
        expect(d.map((l) => (l.kind === 'gap' ? '' : `${l.kind}:${l.text}`))).toEqual(['same:a', 'del:b', 'same:c', 'add:d'])
        expect(hasChanges(lineDiff('x\n', 'x')!)).toBe(false)
    })

    it('компактный вид: изменения с контекстом, остальное свёрнуто', () => {
        const before = Array.from({ length: 10 }, (_, i) => `строка ${i}`).join('\n')
        const after = before.replace('строка 5', 'строка 5!')
        expect(compactDiff(lineDiff(before, after)!)).toEqual([
            { kind: 'gap', count: 4 },
            { kind: 'same', text: 'строка 4' },
            { kind: 'del', text: 'строка 5' },
            { kind: 'add', text: 'строка 5!' },
            { kind: 'same', text: 'строка 6' },
            { kind: 'gap', count: 3 }
        ])
    })
})
