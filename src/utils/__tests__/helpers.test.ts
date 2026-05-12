import { describe, it, expect } from 'vitest'
import { formatTime, normalizeSearchText, escapeHtml, debounce, throttle } from '../helpers'

describe('formatTime', () => {
    it('formats seconds to MM:SS', () => {
        expect(formatTime(0)).toBe('0:00')
        expect(formatTime(65)).toBe('1:05')
        expect(formatTime(3661)).toBe('61:01')
    })

    it('returns 0:00 for NaN', () => {
        expect(formatTime(NaN)).toBe('0:00')
    })

    it('pads seconds with leading zero', () => {
        expect(formatTime(61)).toBe('1:01')
        expect(formatTime(9)).toBe('0:09')
    })
})

describe('normalizeSearchText', () => {
    it('lowercases and trims', () => {
        expect(normalizeSearchText('  Hello World  ')).toBe('hello world')
        expect(normalizeSearchText('UPPER')).toBe('upper')
    })

    it('handles empty and non-string inputs', () => {
        expect(normalizeSearchText('')).toBe('')
        expect(normalizeSearchText(null as any)).toBe('')
    })
})

describe('escapeHtml', () => {
    it('escapes all special HTML characters', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe(
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        )
        expect(escapeHtml("it's & 'quoted'")).toBe("it&#039;s &amp; &#039;quoted&#039;")
    })

    it('returns empty string for empty input', () => {
        expect(escapeHtml('')).toBe('')
        expect(escapeHtml(null as any)).toBe('')
    })
})

describe('debounce', () => {
    it('calls function only once after delay', async () => {
        let count = 0
        const fn = debounce(() => { count++ }, 50)
        fn(); fn(); fn()
        expect(count).toBe(0)
        await new Promise(r => setTimeout(r, 60))
        expect(count).toBe(1)
    })
})

describe('throttle', () => {
    it('calls function at most once per limit interval', async () => {
        let count = 0
        const fn = throttle(() => { count++ }, 50)
        fn(); fn(); fn()
        expect(count).toBe(1)
        await new Promise(r => setTimeout(r, 60))
        fn()
        expect(count).toBe(2)
    })
})
