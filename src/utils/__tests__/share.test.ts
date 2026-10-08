import { describe, it, expect } from 'vitest'
import { releaseSharePath, releaseShareUrl, siteRoot, trackSharePath, trackShareUrl } from '../share'
import { getTrackSlug } from '../slug'
import { fixtureReleases } from '../../../tests/fixtures/catalog'

describe('ссылки «Поделиться» и «Скопировать ссылку»', () => {
    const releases = fixtureReleases()
    const track = releases['most-venture-poopsicks'].tracks[0]

    it('пути страниц-превью: r/<релиз>/ и t/<релиз>/<слаг>/', () => {
        expect(releaseSharePath('most-venture-poopsicks')).toBe('r/most-venture-poopsicks/')
        expect(trackSharePath('most-venture-poopsicks', 'poopsicks')).toBe('t/most-venture-poopsicks/poopsicks/')
        expect(trackSharePath('a b', 'ы/з')).toBe('t/a%20b/%D1%8B%2F%D0%B7/')
    })

    it('ссылка на трек ведёт на страницу превью, а не на «#/track/…»', () => {
        const url = trackShareUrl('most-venture-poopsicks', track, 'https://frnkness.ru/')
        expect(url).toBe(`https://frnkness.ru/t/most-venture-poopsicks/${getTrackSlug(track)}/`)
        expect(url).not.toContain('#')
        expect(releaseShareUrl('most-venture-poopsicks', 'https://frnkness.ru/')).toBe('https://frnkness.ru/r/most-venture-poopsicks/')
    })

    it('корень сайта учитывает подпапку и не тянет за собой «#/…» и index.html', () => {
        expect(siteRoot({ origin: 'https://frnkness.ru', pathname: '/' })).toBe('https://frnkness.ru/')
        expect(siteRoot({ origin: 'https://frnkness.ru', pathname: '/index.html' })).toBe('https://frnkness.ru/')
        expect(siteRoot({ origin: 'https://user.github.io', pathname: '/frnkness/' })).toBe('https://user.github.io/frnkness/')
        expect(trackShareUrl('x', { num: 1, lyricsFile: '01-y.txt' }, siteRoot({ origin: 'https://user.github.io', pathname: '/frnkness/' }))).toBe('https://user.github.io/frnkness/t/x/y/')
    })
})
