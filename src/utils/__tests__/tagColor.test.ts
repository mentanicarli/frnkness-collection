import { describe, it, expect } from 'vitest'
import { TAG_NAME_MAX, contrastRatio, isTagColor, luminance, normalizeTagColor, tagTextColor } from '../tagColor'

describe('цвет тега', () => {
    it('принимается только #RRGGBB', () => {
        for (const ok of ['#000000', '#ffffff', '#FF8800', '#a1B2c3']) expect(isTagColor(ok), ok).toBe(true)
        for (const bad of ['red', '#fff', '#ggg000', '#12345678', 'ff8800', '#ff8800; background:url(x)', '', ' #ff8800', '#ff8800 ', 'rgb(1,2,3)', null, undefined, 123]) {
            expect(isTagColor(bad), String(bad)).toBe(false)
        }
    })

    it('нормализация: нижний регистр; неверный формат — null', () => {
        expect(normalizeTagColor('#FF8800')).toBe('#ff8800')
        expect(normalizeTagColor('#fff')).toBeNull()
        expect(TAG_NAME_MAX).toBe(20)
    })

    it('яркость и контраст по WCAG', () => {
        expect(luminance('#000000')).toBe(0)
        expect(luminance('#ffffff')).toBeCloseTo(1, 5)
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 3)
        expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5)
    })

    it('цвет текста: на тёмном фоне белый, на светлом чёрный', () => {
        for (const dark of ['#000000', '#000080', '#1a1a2e', '#800000', '#006400', '#4b0082', '#333333']) expect(tagTextColor(dark), dark).toBe('#ffffff')
        for (const light of ['#ffffff', '#ffff00', '#ffd700', '#90ee90', '#add8e6', '#f5f5f5', '#00ff00']) expect(tagTextColor(light), light).toBe('#000000')
    })

    it('выбирается тот, у которого контраст выше, — для любого цвета читаемость не хуже 4.5 хотя бы у одного из двух', () => {
        let worst = 21
        for (let r = 0; r < 256; r += 51) {
            for (let g = 0; g < 256; g += 51) {
                for (let b = 0; b < 256; b += 51) {
                    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
                    const text = tagTextColor(hex)
                    const chosen = contrastRatio(hex, text)
                    const other = contrastRatio(hex, text === '#ffffff' ? '#000000' : '#ffffff')
                    expect(chosen, hex).toBeGreaterThanOrEqual(other)
                    worst = Math.min(worst, chosen)
                }
            }
        }
        // Худший случай (серединные цвета) всё равно читается: больше 4.5.
        expect(worst).toBeGreaterThan(4.5)
    })

    it('неверный цвет не ломает значок: белый текст', () => {
        expect(tagTextColor('не цвет')).toBe('#ffffff')
    })
})
