import { describe, it, expect } from 'vitest'
import { COVER_WIDTHS, coverSrcset, coverVariant } from '../cover'

describe('обложки: уменьшенные копии', () => {
    it('адрес копии — рядом с оригиналом, webp', () => {
        expect(coverVariant('images/album1-cover.jpg', 320)).toBe('images/album1-cover-320.webp')
        expect(coverVariant('images/new.release.PNG', 160)).toBe('images/new.release-160.webp')
    })

    it('картинки не из images/ (Storage, data:, blob:) остаются как есть', () => {
        expect(coverVariant('https://x.supabase.co/storage/v1/a.jpg', 320)).toBeNull()
        expect(coverVariant('data:image/png;base64,AAAA', 320)).toBeNull()
        expect(coverVariant('blob:https://site/1', 320)).toBeNull()
        expect(coverVariant('images/cover.webp', 320)).toBeNull()
    })

    it('srcset перечисляет все ширины', () => {
        expect(coverSrcset('images/a.jpg')).toBe(COVER_WIDTHS.map((w) => `images/a-${w}.webp ${w}w`).join(', '))
        expect(coverSrcset('https://x/a.jpg')).toBeUndefined()
        expect(coverSrcset(null)).toBeUndefined()
    })
})
