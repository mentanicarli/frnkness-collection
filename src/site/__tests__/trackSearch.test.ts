import { describe, it, expect, vi } from 'vitest'

// Каталог — фикстура: тест не зависит от настоящего содержимого.
vi.mock('@/config', async () => {
    const { fixtureReleases } = await import('../../../tests/fixtures/catalog')
    return { releases: fixtureReleases(), SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }
})

const { searchTracks } = await import('../social/trackSearch')

describe('поиск треков для выбора из каталога', () => {
    it('без запроса — весь каталог, каждый трек один раз', () => {
        const all = searchTracks('')
        expect(all.length).toBeGreaterThan(10)
        expect(new Set(all.map((t) => t.trackId)).size).toBe(all.length)
        expect(all.every((t) => t.available)).toBe(true)
    })

    it('ищет по названию трека без учёта регистра и ё', () => {
        expect(searchTracks('БИЛЬЯРД').map((t) => t.trackId)).toEqual(['zlaya-nostalgia/bilyard'])
        expect(searchTracks('  faaa ').map((t) => t.trackId)).toEqual(['faaa/faaa'])
    })

    it('название релиза находит все его треки', () => {
        expect(searchTracks('six senses').map((t) => t.trackId)).toEqual(['six-senses-pupsiks/still-ballin', 'six-senses-pupsiks/hulks-reflections'])
    })

    it('limit обрезает выдачу; ничего не нашлось — пусто', () => {
        expect(searchTracks('', 3)).toHaveLength(3)
        expect(searchTracks('zzzzzzzz')).toEqual([])
    })
})
