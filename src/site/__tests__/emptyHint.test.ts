import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h } from 'vue'
import EmptyHint from '../components/EmptyHint.vue'

const els: HTMLElement[] = []
afterEach(() => els.splice(0).forEach((e) => e.remove()))

function mount(props: Record<string, unknown>, withAction: boolean) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    els.push(el)
    createApp({ render: () => h(EmptyHint, props, withAction ? { default: () => h('button', { type: 'button' }, 'Найти друзей') } : undefined) }).mount(el)
    return el
}

describe('подсказка вместо пустого раздела', () => {
    it('заголовок, текст и кнопка-действие', () => {
        const el = mount({ title: 'Здесь будут друзья', text: 'Найди знакомых по нику' }, true)
        expect(el.querySelector('.empty-hint-title')!.textContent).toBe('Здесь будут друзья')
        expect(el.querySelector('.empty-hint-text')!.textContent).toBe('Найди знакомых по нику')
        expect(el.querySelector('.empty-hint-actions button')!.textContent).toBe('Найти друзей')
    })

    it('без кнопки блока действий нет', () => {
        expect(mount({ title: 'a', text: 'b' }, false).querySelector('.empty-hint-actions')).toBeNull()
    })

    it('тексты выводятся с экранированием', () => {
        const el = mount({ title: '<img src=x onerror=alert(1)>', text: '<b>x</b>' }, false)
        expect(el.querySelector('img')).toBeNull()
        expect(el.querySelector('b')).toBeNull()
        expect(el.querySelector('.empty-hint-title')!.textContent).toBe('<img src=x onerror=alert(1)>')
    })
})
