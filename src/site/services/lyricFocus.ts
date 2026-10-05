import { shallowRef } from 'vue'

/**
 * Переход из поиска к строке текста на странице трека. Страница
 * дорисовывается асинхронно, поэтому запрос ждёт, пока на экране появится
 * текст именно этого трека (см. TrackPage.vue).
 */
export interface LineFocusRequest {
    releaseId: string
    trackIndex: number
    line: string
}

export const pendingLineFocus = shallowRef<LineFocusRequest | null>(null)

export function focusLyricLine(releaseId: string, trackIndex: number, line: string): void {
    pendingLineFocus.value = { releaseId, trackIndex, line }
}
