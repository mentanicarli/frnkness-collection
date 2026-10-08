/**
 * Общий принцип закрытия окон и панелей сайта (см. ModalFrame.vue):
 *  - нажатие на затемнённый фон;
 *  - крестик;
 *  - Esc на компьютере — закрывается только верхнее окно;
 *  - свайп вниз, если окно — нижняя панель на телефоне.
 */

// ── Esc: стек открытых окон ────────────────────────────────────────────
const stack: Array<() => void> = []
let bound = false

function onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || !stack.length) return
    // Окно перехватывает Esc: полноэкранный плеер под ним остаётся открытым.
    e.preventDefault()
    e.stopImmediatePropagation()
    stack[stack.length - 1]()
}

/** Окно открылось: Esc закроет его (если оно верхнее). Возвращает «окно закрылось». */
export function pushDismiss(close: () => void): () => void {
    if (!bound && typeof document !== 'undefined') {
        document.addEventListener('keydown', onKey, true)
        bound = true
    }
    stack.push(close)
    return () => {
        const i = stack.lastIndexOf(close)
        if (i >= 0) stack.splice(i, 1)
    }
}

export const openModalCount = (): number => stack.length

// ── Свайп вниз ─────────────────────────────────────────────────────────
/** Сдвиг вниз, после которого панель закрывается, и скорость «броска» (пикселей в мс). */
export const SWIPE_CLOSE_PX = 90
export const SWIPE_CLOSE_SPEED = 0.5
/** Меньше этого сдвига жест не считается свайпом (иначе мешает нажатиям). */
export const SWIPE_START_PX = 6

/** Закрыть ли панель, когда палец отпущен: сдвинули далеко или резко бросили вниз. */
export function swipeShouldClose(dy: number, durationMs: number): boolean {
    if (dy <= 0) return false
    if (dy >= SWIPE_CLOSE_PX) return true
    return dy >= 30 && dy / Math.max(1, durationMs) >= SWIPE_CLOSE_SPEED
}

/**
 * Свайп не начинаем, если палец на прокручиваемом списке внутри панели, который
 * уже прокручен вниз (иначе жест прокрутки закрыл бы окно), или на элементе
 * с data-no-swipe (ползунок, обрезка картинки).
 */
export function swipeBlocked(target: EventTarget | null, panel: HTMLElement): boolean {
    let el = target instanceof HTMLElement ? target : null
    while (el) {
        if (el.dataset?.noSwipe !== undefined) return true
        if (el.scrollTop > 0) return true
        if (el === panel) break
        el = el.parentElement
    }
    return false
}

/** Нижняя панель (телефон и экраны без наведения) — та же граница, что в social.css. */
export function isBottomSheetLayout(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px), (hover: none)').matches
}
