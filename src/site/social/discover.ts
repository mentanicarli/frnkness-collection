import { reactive } from 'vue'
import { api, errorText, type DiscoverPage, type Profile, type Relation } from './api'

/**
 * Список пользователей на странице «Друзья»: все активные аккаунты, поиск по
 * нику на лету и подгрузка частями. Состояние отдельно от страницы, чтобы
 * проверять его без браузера: устаревшие ответы (человек уже ввёл другой
 * запрос) отбрасываются, одного пользователя дважды в списке не бывает.
 */
export type DiscoverUser = Profile & { relation: Relation }

export const DISCOVER_PAGE_SIZE = 30

export interface DiscoverState {
    users: DiscoverUser[]
    query: string
    loading: boolean
    /** Хотя бы одна страница по текущему запросу загружена. */
    loaded: boolean
    hasMore: boolean
    error: string
}

export function createDiscover(fetchPage: (query: string, after: string | null, limit: number) => Promise<DiscoverPage> = api.discoverUsers, pageSize = DISCOVER_PAGE_SIZE) {
    const state = reactive<DiscoverState>({ users: [], query: '', loading: false, loaded: false, hasMore: true, error: '' })
    let next: string | null = null
    let seq = 0

    async function loadMore(): Promise<void> {
        if (state.loading || !state.hasMore) return
        const my = seq
        state.loading = true
        state.error = ''
        try {
            const page = await fetchPage(state.query, next, pageSize)
            if (my !== seq) return
            const seen = new Set(state.users.map((u) => u.id))
            state.users.push(...page.users.filter((u) => !seen.has(u.id)))
            next = page.next
            state.hasMore = page.has_more && page.next !== null
            state.loaded = true
        } catch (e) {
            if (my !== seq) return
            state.error = errorText(e)
            // Повторить можно прокруткой или кнопкой: hasMore остаётся.
        } finally {
            if (my === seq) state.loading = false
        }
    }

    /** Новый запрос: список начинается заново. Пустой запрос — все пользователи. */
    function search(query: string): Promise<void> {
        seq++
        state.query = query.trim()
        state.users = []
        state.loaded = false
        state.hasMore = true
        state.loading = false
        state.error = ''
        next = null
        return loadMore()
    }

    function setRelation(id: string, relation: Relation): void {
        const u = state.users.find((x) => x.id === id)
        if (u) u.relation = relation
    }

    function reset(): void {
        seq++
        state.users = []
        state.query = ''
        state.loaded = false
        state.hasMore = true
        state.loading = false
        state.error = ''
        next = null
    }

    return { state, loadMore, search, setRelation, reset }
}
