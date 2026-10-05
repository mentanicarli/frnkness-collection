/**
 * Горячие клавиши плеера в «Текстах». Работают и во время набора, поэтому
 * без Пробела и букв: Alt + цифра верхнего ряда ничего не печатает и не
 * занята ни Windows, ни Chrome/Edge/Firefox (Alt+буква открывает меню
 * браузера, Alt+стрелки — назад/вперёд по истории, Ctrl+цифра — вкладки).
 * Клавиша берётся по e.code, поэтому раскладка (рус/англ) не важна.
 */
export type PlayerAction = 'back' | 'toggle' | 'forward'

export const PLAYER_KEYS: { action: PlayerAction; code: string; label: string; hint: string }[] = [
    { action: 'back', code: 'Digit1', label: 'Alt+1', hint: 'назад 3 с' },
    { action: 'toggle', code: 'Digit2', label: 'Alt+2', hint: 'играть / пауза' },
    { action: 'forward', code: 'Digit3', label: 'Alt+3', hint: 'вперёд 3 с' }
]

export function playerKeyAction(e: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): PlayerAction | null {
    // Ctrl+Alt — это AltGr: им печатают символы, его не трогаем.
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null
    return PLAYER_KEYS.find((k) => k.code === e.code)?.action ?? null
}
