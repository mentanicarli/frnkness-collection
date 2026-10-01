import { computed, ref } from 'vue'

/**
 * Hash-роутинг админки: #/раздел/параметр/... Без зависимостей —
 * разделов мало, а адрес в hash не требует настроек GitHub Pages.
 */
const hash = ref(typeof location !== 'undefined' ? location.hash : '')

if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', () => {
        hash.value = location.hash
    })
}

export function parseHash(value: string): string[] {
    return value
        .replace(/^#\/?/, '')
        .split('/')
        .filter(Boolean)
        .map((s) => {
            try {
                return decodeURIComponent(s)
            } catch {
                return s
            }
        })
}

export function buildHash(...segments: (string | number)[]): string {
    return '#/' + segments.map((s) => encodeURIComponent(String(s))).join('/')
}

export function navigate(...segments: (string | number)[]) {
    location.hash = buildHash(...segments)
}

export function useRoute() {
    const segments = computed(() => parseHash(hash.value))
    return {
        segments,
        section: computed(() => segments.value[0] || 'home')
    }
}
