import { describe, it, expect } from 'vitest'
import type { Releases, SiteSettings } from '@/types'
import { serializeReleases, serializeSite } from '../content'
import { fixtureText } from '../../../../tests/fixtures/catalog'

describe('сериализация src/content', () => {
    it('site.json и releases.json в формате репозитория — байт в байт', () => {
        const site = fixtureText('src/content/site.json')!
        expect(serializeSite(JSON.parse(site) as SiteSettings)).toBe(site)
        const releases = fixtureText('src/content/releases.json')!
        expect(serializeReleases(JSON.parse(releases) as Releases)).toBe(releases)
    })

    it('site.json содержит только promo.enabled и promo.releaseId', () => {
        const extra = { promo: { enabled: false, releaseId: 'faaa', junk: 1 }, other: true } as unknown as SiteSettings
        expect(serializeSite(extra)).toBe('{\n    "promo": {\n        "enabled": false,\n        "releaseId": "faaa"\n    }\n}\n')
    })
})

describe('site.json с анонсом', () => {
    it('анонс — после promo, пустые text/url не пишутся', () => {
        const out = serializeSite({
            promo: { enabled: true, releaseId: 'faaa' },
            announce: { enabled: true, title: ' Скоро ', cover: 'images/a.jpg', releaseAt: '2026-11-01T18:00:00+03:00', text: '  ', url: '' }
        })
        expect(JSON.parse(out)).toEqual({
            promo: { enabled: true, releaseId: 'faaa' },
            announce: { enabled: true, title: 'Скоро', cover: 'images/a.jpg', releaseAt: '2026-11-01T18:00:00+03:00' }
        })
        expect(Object.keys(JSON.parse(out))).toEqual(['promo', 'announce'])
    })

    it('анонс без даты — поля releaseAt нет', () => {
        const out = serializeSite({
            promo: { enabled: true, releaseId: 'faaa' },
            announce: { enabled: true, title: 'Скоро', cover: 'images/a.jpg', releaseAt: '' }
        })
        expect(JSON.parse(out).announce).toEqual({ enabled: true, title: 'Скоро', cover: 'images/a.jpg' })
    })
})
