import { describe, it, expect } from 'vitest'
import { rgbToHsl, hslToRgb, normalizeColor } from '../colors'

describe('rgbToHsl', () => {
    it('converts red to HSL', () => {
        const { h, s, l } = rgbToHsl(255, 0, 0)
        expect(h).toBeCloseTo(0)
        expect(s).toBeCloseTo(100)
        expect(l).toBeCloseTo(50)
    })

    it('converts pure white', () => {
        const { s, l } = rgbToHsl(255, 255, 255)
        expect(s).toBeCloseTo(0)
        expect(l).toBeCloseTo(100)
    })

    it('converts pure black', () => {
        const { s, l } = rgbToHsl(0, 0, 0)
        expect(s).toBeCloseTo(0)
        expect(l).toBeCloseTo(0)
    })

    it('converts blue correctly', () => {
        const { h } = rgbToHsl(0, 0, 255)
        expect(h).toBeCloseTo(240)
    })
})

describe('hslToRgb', () => {
    it('converts pure red back to RGB', () => {
        const { r, g, b } = hslToRgb(0, 100, 50)
        expect(r).toBe(255)
        expect(g).toBe(0)
        expect(b).toBe(0)
    })

    it('converts gray (no saturation)', () => {
        const { r, g, b } = hslToRgb(0, 0, 50)
        expect(r).toBe(128)
        expect(g).toBe(128)
        expect(b).toBe(128)
    })

    it('roundtrips through rgbToHsl', () => {
        const original = { r: 120, g: 80, b: 200 }
        const { h, s, l } = rgbToHsl(original.r, original.g, original.b)
        const result = hslToRgb(h, s, l)
        expect(result.r).toBeCloseTo(original.r, 0)
        expect(result.g).toBeCloseTo(original.g, 0)
        expect(result.b).toBeCloseTo(original.b, 0)
    })
})

describe('normalizeColor', () => {
    it('returns a valid ColorSet with hex, glow, soft', () => {
        const result = normalizeColor([100, 150, 200])
        expect(result).toHaveProperty('hex')
        expect(result).toHaveProperty('glow')
        expect(result).toHaveProperty('soft')
        expect(result.hex).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
        expect(result.glow).toMatch(/^rgba\(\d+, \d+, \d+, 0\.\d+\)$/)
    })

    it('handles near-gray colors without crashing', () => {
        const result = normalizeColor([128, 128, 128])
        expect(result.hex).toMatch(/^rgb\(/)
    })

    it('normalizes very dark colors to acceptable lightness', () => {
        const result = normalizeColor([10, 5, 50])
        const match = result.hex.match(/rgb\((\d+), (\d+), (\d+)\)/)
        expect(match).not.toBeNull()
        const [r, g, b] = [Number(match![1]), Number(match![2]), Number(match![3])]
        // Нормализованный цвет должен быть светлее оригинала
        const avgNorm = (r + g + b) / 3
        expect(avgNorm).toBeGreaterThan(50)
    })
})
