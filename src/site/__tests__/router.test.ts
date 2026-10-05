import { describe, it, expect, vi } from 'vitest'
import { fixtureReleases } from '../../../tests/fixtures/catalog'

// Каталог — фикстура, а не настоящий src/content/releases.json.
vi.mock('@/config', async () => {
    const { fixtureReleases: load } = await import('../../../tests/fixtures/catalog')
    return { releases: load(), SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }
})

const { router, normalizeInitialHash } = await import('../router')

async function open(hash: string) {
    window.history.replaceState(null, '', '/' + hash)
    await router.replace(hash.replace(/^#/, '') || '/')
    // afterEach может дописать ещё один replace к каноническому виду.
    await new Promise((r) => setTimeout(r, 0))
    return { name: router.currentRoute.value.name, hash: window.location.hash }
}

describe('адреса сайта (hash-режим)', () => {
    it('главная, чарт, релиз и трек — те же адреса, что и раньше', async () => {
        expect(await open('#/')).toEqual({ name: 'home', hash: '#/' })
        expect(await open('#/chart')).toEqual({ name: 'chart', hash: '#/chart' })
        expect(await open('#/release/zlaya-nostalgia')).toEqual({ name: 'release', hash: '#/release/zlaya-nostalgia' })
        expect(await open('#/track/zlaya-nostalgia/makanochki')).toEqual({ name: 'track', hash: '#/track/zlaya-nostalgia/makanochki' })
    })

    it('мусор и лишние части адреса приводятся к рабочим', async () => {
        expect(await open('#/nonsense/x')).toEqual({ name: 'home', hash: '#/' })
        expect(await open('#/chart/extra')).toEqual({ name: 'chart', hash: '#/chart' })
        expect(await open('#/release/zlaya-nostalgia/extra')).toEqual({ name: 'release', hash: '#/release/zlaya-nostalgia' })
        expect(await open('#/track/zlaya-nostalgia/makanochki/extra')).toEqual({ name: 'track', hash: '#/track/zlaya-nostalgia/makanochki' })
    })

    it('неизвестный релиз — главная, неизвестный трек — его релиз', async () => {
        expect(await open('#/release/no-such')).toEqual({ name: 'home', hash: '#/' })
        expect(await open('#/track/zlaya-nostalgia/no-such')).toEqual({ name: 'release', hash: '#/release/zlaya-nostalgia' })
        expect(await open('#/track/no-such/x')).toEqual({ name: 'home', hash: '#/' })
    })

    it('переход между релизами тоже проверяется', async () => {
        await open('#/release/zlaya-nostalgia')
        await router.push('/release/no-such')
        expect(router.currentRoute.value.name).toBe('home')
    })

    it('адрес без «/» после «#» приводится к «#/…» до старта роутера', () => {
        window.history.replaceState(null, '', '/#chart')
        normalizeInitialHash()
        expect(window.location.hash).toBe('#/chart')
    })

    it('у всех треков фикстуры есть страница', async () => {
        const releases = fixtureReleases()
        for (const releaseId of Object.keys(releases)) {
            expect((await open(`#/release/${releaseId}`)).name).toBe('release')
        }
    })
})
