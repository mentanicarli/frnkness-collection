import { describe, it, expect } from 'vitest'
import { playerKeyAction } from '../playerKeys'

const key = (code: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => ({
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods
})

describe('горячие клавиши плеера', () => {
    it('Alt+1/2/3 — назад, играть/пауза, вперёд', () => {
        expect(playerKeyAction(key('Digit1', { altKey: true }))).toBe('back')
        expect(playerKeyAction(key('Digit2', { altKey: true }))).toBe('toggle')
        expect(playerKeyAction(key('Digit3', { altKey: true }))).toBe('forward')
    })

    it('обычный набор не перехватывается', () => {
        expect(playerKeyAction(key('Space'))).toBeNull()
        expect(playerKeyAction(key('Digit2'))).toBeNull()
        expect(playerKeyAction(key('Digit2', { shiftKey: true }))).toBeNull()
        expect(playerKeyAction(key('Space', { altKey: true }))).toBeNull()
        expect(playerKeyAction(key('KeyF', { altKey: true }))).toBeNull()
    })

    it('AltGr (Ctrl+Alt) и прочие сочетания — нет', () => {
        expect(playerKeyAction(key('Digit2', { altKey: true, ctrlKey: true }))).toBeNull()
        expect(playerKeyAction(key('Digit2', { altKey: true, metaKey: true }))).toBeNull()
        expect(playerKeyAction(key('Digit2', { ctrlKey: true }))).toBeNull()
    })
})
