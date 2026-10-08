import { shallowReactive } from 'vue'
import { reportContext, type ReportContext } from '../diagnostics'

/** «Сообщить о проблеме»: длина текста — такая же проверка в базе (submit_feedback). */
export const FEEDBACK_MAX = 1000

export const feedbackUi = shallowReactive<{ open: boolean; context: ReportContext | null }>({ open: false, context: null })

/** Открыть окно. Страница запоминается сейчас — пока человек не ушёл с неё. */
export function openFeedback(): void {
    feedbackUi.context = reportContext()
    feedbackUi.open = true
}

export function closeFeedback(): void {
    feedbackUi.open = false
}
