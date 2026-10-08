import { shallowReactive } from 'vue'

/** Короткое сообщение внизу экрана («Добавлено в плейлист», ошибки). */
export const notice = shallowReactive({
    text: '',
    error: false,
    n: 0
})

let timer: ReturnType<typeof setTimeout> | null = null

export function showNotice(text: string, error = false): void {
    notice.text = text
    notice.error = error
    notice.n += 1
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
        notice.text = ''
    }, error ? 5000 : 2600)
}
