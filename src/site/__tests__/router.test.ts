import { describe, it, expect, vi, afterEach } from 'vitest'
import { fixtureReleases } from '../../../tests/fixtures/catalog'

// Каталог — фикстура, а не настоящий src/content/releases.json.
vi.mock('@/config', async () => {
    const { fixtureReleases: load } = await import('../../../tests/fixtures/catalog')
    return { releases: load(), SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }
})

const { router, normalizeInitialHash, nextTarget } = await import('../router')
const { __setSessionForTests } = await import('../session')

const USER = { id: 'u1', nick: 'Ян', role: 'user' as const, avatar: 'initials:0', bio: '', createdAt: '2026-10-01T00:00:00Z' }
__setSessionForTests(USER)

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

    it('у всех релизов фикстуры есть страница', async () => {
        const releases = fixtureReleases()
        for (const releaseId of Object.keys(releases)) {
            expect((await open(`#/release/${releaseId}`)).name).toBe('release')
        }
    })
})

describe('стена: без входа — только заставка и экраны входа', () => {
    afterEach(() => __setSessionForTests(USER))

    it('гость с глубокой ссылки попадает на заставку, адрес запоминается', async () => {
        __setSessionForTests(null)
        const r = await open('#/track/zlaya-nostalgia/makanochki')
        expect(r.name).toBe('welcome')
        expect(router.currentRoute.value.query.next).toBe('/track/zlaya-nostalgia/makanochki')
    })

    it('гость с главной — на заставку без next', async () => {
        __setSessionForTests(null)
        expect(await open('#/')).toEqual({ name: 'welcome', hash: '#/welcome' })
    })

    it.each(['chart', 'me'])('гость не открывает #/%s', async (path) => {
        __setSessionForTests(null)
        expect((await open(`#/${path}`)).name).toBe('welcome')
    })

    it.each(['welcome', 'login', 'register', 'forgot', 'privacy'])('гостю доступно #/%s', async (path) => {
        __setSessionForTests(null)
        expect((await open(`#/${path}`)).name).toBe(path)
    })

    it('вошедшего с экрана входа уводит на запомненный адрес', async () => {
        expect((await open('#/login?next=/release/zlaya-nostalgia')).name).toBe('release')
        expect((await open('#/welcome')).name).toBe('home')
        expect((await open('#/register?next=//evil.example')).name).toBe('home')
    })

    it('после сброса пароля — только смена пароля, адрес запоминается', async () => {
        __setSessionForTests(USER, { mustChangePassword: true })
        const r = await open('#/release/zlaya-nostalgia')
        expect(r.name).toBe('change-password')
        expect(router.currentRoute.value.query.next).toBe('/release/zlaya-nostalgia')
        expect((await open('#/privacy')).name).toBe('privacy')
    })
})

describe('редирект после входа', () => {
    it('только существующие внутренние адреса', () => {
        expect(nextTarget('/track/zlaya-nostalgia/makanochki')).toBe('/track/zlaya-nostalgia/makanochki')
        expect(nextTarget('/chart')).toBe('/chart')
        expect(nextTarget('/no/such/page')).toBeNull()
        expect(nextTarget('https://evil.example')).toBeNull()
        expect(nextTarget('//evil.example')).toBeNull()
        expect(nextTarget(['/chart'])).toBe('/chart')
        expect(nextTarget(undefined)).toBeNull()
    })
})
