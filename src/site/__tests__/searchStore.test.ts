import { describe, it, expect, vi, beforeEach } from 'vitest'

// Каталог — фикстура; индекса текстов нет (fetch отвечает 404), ищутся названия.
vi.mock('@/config', async () => {
    const { fixtureReleases } = await import('../../../tests/fixtures/catalog')
    return { releases: fixtureReleases(), SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }
})

const { search, runSearch, setSearchOpen, toggleSearch } = await import('../stores/search')

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    setSearchOpen(false)
})

describe('поиск в шапке', () => {
    it('находит релиз и трек по началу слова', () => {
        setSearchOpen(true)
        search.input = 'злая'
        runSearch(search.input)
        expect(search.query).toBe('злая')
        expect(search.results.map((r) => [r.type, r.releaseId])).toContainEqual(['release', 'zlaya-nostalgia'])

        runSearch('маканоч')
        expect(search.results.find((r) => r.type === 'track')).toMatchObject({ releaseId: 'zlaya-nostalgia', trackIndex: 0, trackTitle: 'Маканочки' })
    })

    it('пустой запрос — пустая выдача', () => {
        runSearch('   ')
        expect(search.query).toBe('')
        expect(search.results).toEqual([])
    })

    it('закрытие очищает поле и выдачу', () => {
        toggleSearch()
        expect(search.open).toBe(true)
        search.input = 'злая'
        runSearch(search.input)
        toggleSearch()
        expect(search.open).toBe(false)
        expect(search.input).toBe('')
        expect(search.results).toEqual([])
    })
})
