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

async function doLoad() {
    state.loading = true
    state.error = ''
    try {
        const head = await fetchHead()
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

function load(force = false): Promise<void> {
    if (inflight) return inflight
    if (state.releases && !force) return Promise.resolve()
    inflight = doLoad().finally(() => {
        inflight = null
    })
    return inflight
}

export function useRepo() {
    return { state, load, reload: () => load(true) }
}
