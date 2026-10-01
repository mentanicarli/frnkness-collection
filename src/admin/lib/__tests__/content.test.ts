import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Releases, SiteSettings } from '@/types'
import { serializeReleases, serializeSite } from '../content'

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../../content', rel), 'utf8').replace(/\r\n?/g, '\n')

describe('сериализация src/content', () => {
    it('site.json и releases.json — байт в байт как в репозитории', () => {
        const site = read('site.json')
        expect(serializeSite(JSON.parse(site) as SiteSettings)).toBe(site)
        const releases = read('releases.json')
        expect(serializeReleases(JSON.parse(releases) as Releases)).toBe(releases)
    })

    it('site.json содержит только promo.enabled и promo.releaseId', () => {
        const extra = { promo: { enabled: false, releaseId: 'faaa', junk: 1 }, other: true } as unknown as SiteSettings
        expect(serializeSite(extra)).toBe('{\n    "promo": {\n        "enabled": false,\n        "releaseId": "faaa"\n    }\n}\n')
    })
})
