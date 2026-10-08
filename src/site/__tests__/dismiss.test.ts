// Общий принцип закрытия окон: фон, крестик, Esc (только верхнее окно), свайп вниз.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp, h, nextTick, ref } from 'vue'
import { openModalCount, pushDismiss, swipeBlocked, swipeShouldClose } from '../composables/dismiss'
import ModalFrame from '../components/ModalFrame.vue'

const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

describe('Esc', () => {
    it('закрывает только верхнее окно и не доходит до остальных обработчиков', () => {
        const bottom = vi.fn()
        const top = vi.fn()
        const other = vi.fn()
        document.addEventListener('keydown', other)
        const offBottom = pushDismiss(bottom)
        const offTop = pushDismiss(top)
        esc()
        expect(top).toHaveBeenCalledTimes(1)
        expect(bottom).not.toHaveBeenCalled()
        expect(other).not.toHaveBeenCalled() // полноэкранный плеер под окном остаётся
        offTop()
        esc()
        expect(bottom).toHaveBeenCalledTimes(1)
        offBottom()
        esc()
        expect(other).toHaveBeenCalledTimes(1) // окон нет — Esc обычный
        expect(openModalCount()).toBe(0)
        document.removeEventListener('keydown', other)
    })
})

describe('свайп вниз', () => {
    it('закрывает при длинном сдвиге или быстром броске, а не при лёгком касании', () => {
        expect(swipeShouldClose(120, 600)).toBe(true)
        expect(swipeShouldClose(40, 60)).toBe(true) // бросок
        expect(swipeShouldClose(40, 800)).toBe(false) // медленно и коротко
        expect(swipeShouldClose(10, 10)).toBe(false)
        expect(swipeShouldClose(-200, 100)).toBe(false) // вверх
        expect(swipeShouldClose(0, 100)).toBe(false)
    })

    it('не начинается на списке, прокрученном вниз, и на элементах с data-no-swipe', () => {
        const panel = document.createElement('div')
        const list = document.createElement('ul')
        const item = document.createElement('li')
        const slider = document.createElement('input')
        slider.dataset.noSwipe = ''
        list.append(item)
        panel.append(list, slider)
        document.body.append(panel)
        expect(swipeBlocked(item, panel)).toBe(false)
        list.scrollTop = 30
        Object.defineProperty(list, 'scrollTop', { value: 30, configurable: true })
        expect(swipeBlocked(item, panel)).toBe(true)
        expect(swipeBlocked(slider, panel)).toBe(true)
        panel.remove()
    })
})

describe('ModalFrame', () => {
    const roots: HTMLElement[] = []
    afterEach(() => {
        roots.splice(0).forEach((r) => r.remove())
        document.body.innerHTML = ''
    })

    function mountFrame(sheet = false) {
        const open = ref(true)
        const closes = vi.fn(() => { open.value = false })
        const el = document.createElement('div')
        document.body.append(el)
        roots.push(el)
        createApp({ render: () => h(ModalFrame, { open: open.value, label: 'Окно', sheet, testid: 'win', onClose: closes }, () => h('p', { id: 'inner' }, 'внутри')) }).mount(el)
        return { open, closes }
    }
    const backdrop = () => document.querySelector<HTMLElement>('[data-testid="modal-backdrop"]')
    const panel = () => document.querySelector<HTMLElement>('[data-testid="win"]')

    it('нажатие на фон закрывает, нажатие внутри — нет', async () => {
        const { closes } = mountFrame()
        await nextTick()
        panel()!.click()
        document.getElementById('inner')!.click()
        expect(closes).not.toHaveBeenCalled()
        backdrop()!.click()
        expect(closes).toHaveBeenCalledTimes(1)
    })

    it('крестик и Esc закрывают; панель с ролью dialog и именем', async () => {
        const a = mountFrame()
        await nextTick()
        expect(panel()!.getAttribute('role')).toBe('dialog')
        expect(panel()!.getAttribute('aria-label')).toBe('Окно')
        document.querySelector<HTMLElement>('[data-testid="modal-x"]')!.click()
        expect(a.closes).toHaveBeenCalledTimes(1)
        await nextTick()
        const b = mountFrame()
        await nextTick()
        esc()
        expect(b.closes).toHaveBeenCalledTimes(1)
    })

    it('закрытое окно не слушает Esc', async () => {
        const { open, closes } = mountFrame()
        await nextTick()
        open.value = false
        await nextTick()
        expect(openModalCount()).toBe(0)
        esc()
        expect(closes).not.toHaveBeenCalled()
    })

    it('нижняя панель: фон, крестик и ручка-«язычок»', async () => {
        const { closes } = mountFrame(true)
        await nextTick()
        expect(panel()!.classList.contains('sheet')).toBe(true)
        expect(panel()!.querySelector('.sheet-grip')).not.toBeNull()
        backdrop()!.click()
        expect(closes).toHaveBeenCalledTimes(1)
    })
})
