import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/** Предупреждает о несохранённых правках при закрытии вкладки. */
export function useUnsaved(dirty: Ref<boolean>) {
    const handler = (e: BeforeUnloadEvent) => {
        if (!dirty.value) return
        e.preventDefault()
        e.returnValue = ''
    }
    onMounted(() => window.addEventListener('beforeunload', handler))
    onBeforeUnmount(() => window.removeEventListener('beforeunload', handler))

    /** Спросить перед уходом на другой трек/раздел внутри админки. */
    return function confirmLeave(): boolean {
        return !dirty.value || window.confirm('Есть несохранённые изменения. Уйти без сохранения?')
    }
}
