import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { throttle } from '@/utils/helpers'
import { applyCardAccent, resetCardAccent } from '../services/colors'

/**
 * Карточка релиза под курсором: свечение следует за мышью (--mouse-x/y),
 * акцент — цвет обложки. Карточка с fixedAccent (промо) держит акцент и
 * после ухода курсора.
 */
export function useCardHover(card: Ref<HTMLElement | null>, options: { fixedAccent?: boolean } = {}) {
    const move = throttle((e: MouseEvent) => {
        const el = card.value
        if (!el) return
        const rect = el.getBoundingClientRect()
        el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
        el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
    }, 16)

    const enter = () => {
        const el = card.value
        if (!el) return
        el.addEventListener('mousemove', move)
        const img = el.querySelector('img')
        if (img) void applyCardAccent(el, img.src)
    }

    const leave = () => {
        const el = card.value
        if (!el) return
        el.removeEventListener('mousemove', move)
        if (!options.fixedAccent) resetCardAccent(el)
    }

    onMounted(() => {
        card.value?.addEventListener('mouseenter', enter)
        card.value?.addEventListener('mouseleave', leave)
    })
    onBeforeUnmount(() => {
        card.value?.removeEventListener('mouseenter', enter)
        card.value?.removeEventListener('mouseleave', leave)
        card.value?.removeEventListener('mousemove', move)
    })
}

/** Картинка не загрузилась — прячем её, а не показываем «битую» иконку. */
export function hideBrokenImage(e: Event): void {
    ;(e.target as HTMLElement).style.display = 'none'
}
