import { reactive } from 'vue'
import type { Releases, SiteSettings } from '@/types'
import { AdminApiError, fetchHead, readFiles } from '../api/content'

/**
 * Состояние репозитория, которое видит админка: sha ветки, дерево файлов,
 * releases.json и site.json. Загружается из GitHub через функцию, один раз
 * на сессию (reload — по кнопке или после коммита). sha — та база, поверх
 * которой строятся коммиты: если ветка ушла вперёд, функция откажет.
 */
export const RELEASES_PATH = 'src/content/releases.json'
export const SITE_PATH = 'src/content/site.json'

const state = reactive({
    loading: false,
    error: '',
    sha: '',
    files: [] as { path: string; size: number }[],
    releases: null as Releases | null,
    site: null as SiteSettings | null
})

let inflight: Promise<void> | null = null
/** Последний свой коммит в этой вкладке. */
let lastCommit: { sha: string; prev: string } | null = null
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * after — только что сделанный коммит: sha (новая вершина) и prev (база,
 * поверх которой он сделан). Сразу после коммита GitHub иногда ещё отдаёт
 * прошлую вершину; раньше она затирала уже известный новый sha, и следующее
 * сохранение падало с «данные изменились» без всякой чужой правки.
 */
async function doLoad(after?: { sha: string; prev: string }) {
    state.loading = true
    state.error = ''
    try {
        let head = await fetchHead()
        for (let i = 0; after && head.sha === after.prev && i < 4; i++) {
            await sleep(500 * (i + 1))
            head = await fetchHead()
        }
        // GitHub так и не отдал новую вершину (или это загрузка, начатая ещё
        // до коммита) — оставляем свой sha и прежние данные, а не
        // откатываемся на устаревшие.
        if (lastCommit && head.sha === lastCommit.prev) return
        const files = await readFiles(head.sha, [RELEASES_PATH, SITE_PATH])
        if (!files[RELEASES_PATH]) throw new AdminApiError('missing', 404, `В репозитории нет ${RELEASES_PATH}`)
        state.releases = JSON.parse(files[RELEASES_PATH]!) as Releases
        state.site = files[SITE_PATH] ? (JSON.parse(files[SITE_PATH]!) as SiteSettings) : null
        state.files = head.files
        state.sha = head.sha
    } catch (e) {
        state.error = e instanceof AdminApiError ? e.message : `Не удалось загрузить данные репозитория: ${(e as Error).message}`
    } finally {
        state.loading = false
    }
}

function load(force = false, after?: { sha: string; prev: string }): Promise<void> {
    if (inflight && !after) return inflight
    if (state.releases && !force) return Promise.resolve()
    // Загрузка после своего коммита ждёт текущую, а не переиспользует её:
    // та могла начаться до коммита и вернуть прошлую вершину.
    const p: Promise<void> = (inflight ?? Promise.resolve()).then(() => doLoad(after)).finally(() => {
        if (inflight === p) inflight = null
    })
    inflight = p
    return p
}

/**
 * После своего коммита: новая база для следующих правок известна сразу,
 * остальное (дерево, JSON) обновляется в фоне.
 */
function afterCommit(sha: string) {
    const prev = state.sha
    lastCommit = { sha, prev }
    state.sha = sha
    load(true, lastCommit)
}

export function useRepo() {
    return { state, load, reload: () => load(true), afterCommit }
}
