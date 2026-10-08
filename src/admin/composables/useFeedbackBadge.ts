import { ref } from 'vue'
import { fetchFeedbackNewCount } from '../api/diagnostics'

/**
 * Число новых обращений — значок у пункта «Обращения» в боковой панели.
 * Читается при открытии админки, раз в две минуты и после смены статуса.
 */
const count = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

export async function refreshFeedbackBadge(): Promise<void> {
    try {
        count.value = await fetchFeedbackNewCount()
    } catch {
        // Значок — не главное: при ошибке оставляем прежнее число.
    }
}

export function startFeedbackBadge(): void {
    void refreshFeedbackBadge()
    if (!timer) timer = setInterval(() => void refreshFeedbackBadge(), 120_000)
}

export function stopFeedbackBadge(): void {
    if (timer) clearInterval(timer)
    timer = null
}

export function setFeedbackBadge(n: number): void {
    count.value = Math.max(0, n)
}

export const feedbackNewCount = count
