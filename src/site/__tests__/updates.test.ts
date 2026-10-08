import { describe, it, expect } from 'vitest'
import { canReloadNow } from '../updates'

describe('обновление сайта', () => {
    it('перезагружаемся на новую версию, только если не играет музыка и человек не печатает', () => {
        expect(canReloadNow({ playing: false, typing: false })).toBe(true)
        expect(canReloadNow({ playing: true, typing: false })).toBe(false)
        expect(canReloadNow({ playing: false, typing: true })).toBe(false)
    })
})
