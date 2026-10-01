import { describe, it, expect } from 'vitest'
import { barPath, labelEvery, niceCeil, yTicks } from '../chartScale'

describe('chartScale', () => {
    it('niceCeil', () => {
        expect(niceCeil(0)).toBe(1)
        expect(niceCeil(1)).toBe(1)
        expect(niceCeil(3)).toBe(5)
        expect(niceCeil(7)).toBe(10)
        expect(niceCeil(12)).toBe(20)
        expect(niceCeil(48)).toBe(50)
        expect(niceCeil(51)).toBe(100)
        expect(niceCeil(548)).toBe(1000)
    })

    it('yTicks — целые деления до максимума или выше', () => {
        expect(yTicks(0)).toEqual([0, 1])
        expect(yTicks(3)).toEqual([0, 2, 4])
        expect(yTicks(10)).toEqual([0, 5, 10])
        expect(yTicks(37)).toEqual([0, 20, 40])
        for (const max of [1, 2, 9, 23, 99, 101, 777]) {
            const t = yTicks(max)
            expect(t[t.length - 1]).toBeGreaterThanOrEqual(max)
            expect(t.length).toBeLessThanOrEqual(7)
            expect(t.every(Number.isInteger)).toBe(true)
        }
    })

    it('labelEvery', () => {
        expect(labelEvery(60)).toBe(1)
        expect(labelEvery(10)).toBe(5)
        expect(labelEvery(0)).toBe(1)
    })

    it('barPath — скругление не больше половины ширины и высоты', () => {
        expect(barPath(0, 0, 10, 0)).toBe('')
        expect(barPath(0, 10, 10, 2)).toBe('M0,12V12Q0,10 2,10H8Q10,10 10,12V12Z')
        expect(barPath(5, 0, 20, 50)).toContain('Q5,0 9,0')
    })
})
