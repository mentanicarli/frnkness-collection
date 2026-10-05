import { reactive } from 'vue'
import { releases } from '@/config'
import { normalizeForSearch } from '@/utils/search'
import { ensureLyricsIndex, isLyricsIndexLoading, isLyricsIndexReady, searchCatalog, type SearchHit } from '../services/searchIndex'

/**
 * Поиск в шапке: открыт ли он, что введено и что найдено. Названия ищутся
 * сразу, строки текстов — после загрузки индекса (тогда выдача обновляется
 * для того, что в поле сейчас).
 */
export const search = reactive({
    open: false,
    /** Что сейчас в поле ввода. */
    input: '',
    /** Нормализованный запрос, для которого показана выдача ('' — выдачи нет). */
    query: '',
    results: [] as SearchHit[]
})

function show(query: string) {
    search.query = query
    search.results = query ? searchCatalog(releases, query) : []
}

export function runSearch(value: string): void {
    const query = normalizeForSearch(value)
    show(query)
    if (!query || isLyricsIndexReady() || isLyricsIndexLoading()) return
    void ensureLyricsIndex(releases).then(() => {
        const fresh = normalizeForSearch(search.input)
        if (fresh) show(fresh)
    })
}

export function setSearchOpen(open: boolean): void {
    search.open = open
    if (open) {
        runSearch(search.input)
    } else {
        search.input = ''
        show('')
    }
}

export function toggleSearch(): void {
    setSearchOpen(!search.open)
}
