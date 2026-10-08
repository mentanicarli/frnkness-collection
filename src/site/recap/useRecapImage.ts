import { ref } from 'vue'
import { recapFilename, renderRecapImage, saveRecapImage, type RenderDeps, type SaveEnv, type SaveResult } from './image'
import type { Recap, RecapCatalog } from './types'

/**
 * «Сохранить картинку»: PNG рисуется заранее (когда открыта сводка), чтобы
 * по нажатию его можно было сразу отдать в «Поделиться» — iOS требует,
 * чтобы share вызывался прямо из жеста пользователя.
 */
export function useRecapImage(recap: () => Recap, catalog: () => RecapCatalog, deps?: RenderDeps, env?: () => SaveEnv) {
    const busy = ref(false)
    const message = ref('')
    const failed = ref(false)
    let prepared: Promise<Blob> | null = null

    function prepare(): Promise<Blob> {
        if (!prepared) {
            prepared = renderRecapImage({ recap: recap(), catalog: catalog() }, deps)
            // Не вышло — в следующий раз попробуем заново.
            prepared.catch(() => { prepared = null })
        }
        return prepared
    }

    const TEXT: Record<SaveResult, string> = {
        shared: '',
        downloaded: 'Картинка сохранена',
        opened: 'Картинка открыта в новой вкладке: нажми и удерживай её, потом «Сохранить»',
        cancelled: ''
    }

    async function save(): Promise<void> {
        if (busy.value) return
        busy.value = true
        failed.value = false
        message.value = ''
        try {
            const blob = await prepare()
            const result = await saveRecapImage(blob, recapFilename(recap().year), env?.())
            message.value = TEXT[result]
        } catch {
            failed.value = true
            message.value = 'Не удалось нарисовать картинку — попробуй ещё раз'
        } finally {
            busy.value = false
        }
    }

    return { busy, message, failed, prepare: () => void prepare().catch(() => undefined), save }
}
