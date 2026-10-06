import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { readDraft, removeDraft, writeDraft, type Draft } from '../lib/drafts'
import { useAuth } from './useAuth'

/**
 * Автосохранение несохранённой работы страницы в браузер и предложение
 * восстановить её после перезагрузки.
 *
 * - пока есть несохранённые изменения — черновик пишется (с задержкой);
 * - изменений нет (сохранили или отменили) — черновик удаляется;
 * - при открытии трека с черновиком, который отличается от загруженного,
 *   показывается предложение; пока не выбрали, автосохранение ждёт, чтобы
 *   не затереть старый черновик.
 */
export function useDraft<T>(opts: {
    /** Ключ черновика (draftKey); '' — трек не выбран. */
    key: Ref<string>
    /** Трек загружен и состояние страницы готово. */
    ready: Ref<boolean>
    dirty: Ref<boolean>
    /** Что сохранять: состояние редактора. */
    snapshot: () => T
    /** С чего началась правка — содержимое файлов из main. */
    original: () => string
    baseSha: () => string
    /** Вернуть состояние из черновика. */
    apply: (data: T) => void
}) {
    const auth = useAuth()
    const offer = ref<Draft<T> | null>(null) as Ref<Draft<T> | null>
    /** Файл в main изменился после черновика — восстановление перезапишет чужое при сохранении. */
    const offerStale = computed(() => Boolean(offer.value && offer.value.original !== opts.original()))
    const serialized = computed(() => (opts.ready.value ? JSON.stringify(opts.snapshot()) : ''))

    watch(
        [opts.ready, opts.key],
        ([ready, key]) => {
            offer.value = null
            if (!ready || !key) return
            const d = readDraft<T>(key)
            if (!d) return
            if (JSON.stringify(d.data) === serialized.value) removeDraft(key)
            else offer.value = d
        },
        { immediate: true }
    )

    let timer: ReturnType<typeof setTimeout> | undefined
    function persist() {
        const key = opts.key.value
        if (!opts.ready.value || !key || offer.value) return
        if (!opts.dirty.value) {
            removeDraft(key)
            return
        }
        writeDraft<T>(key, {
            savedAt: Date.now(),
            baseSha: opts.baseSha(),
            original: opts.original(),
            data: opts.snapshot(),
            user: auth.state.nick || undefined
        })
    }
    watch([serialized, opts.dirty], () => {
        clearTimeout(timer)
        timer = setTimeout(persist, 400)
    })
    // Уход со страницы — записать сразу, не дожидаясь задержки.
    const flush = () => {
        clearTimeout(timer)
        persist()
    }
    window.addEventListener('pagehide', flush)
    onBeforeUnmount(() => {
        flush()
        window.removeEventListener('pagehide', flush)
    })

    return {
        offer,
        offerStale,
        restore() {
            const d = offer.value
            if (!d) return
            offer.value = null
            opts.apply(d.data)
        },
        discard() {
            if (opts.key.value) removeDraft(opts.key.value)
            offer.value = null
        },
        /** После успешного сохранения. */
        clear() {
            clearTimeout(timer)
            if (opts.key.value) removeDraft(opts.key.value)
        },
        /** Перед сменой трека: записать текущее, пока ключ ещё старый. */
        flush
    }
}
