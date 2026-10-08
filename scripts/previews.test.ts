// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
    DEFAULT_IMAGE_PATH,
    DEFAULT_SITE_URL,
    buildPreviewPages,
    escapeHtml,
    homeMetaTags,
    normalizeSiteUrl,
    previewCsp,
    redirectScript,
    resolveImage,
    scriptHash
} from './previews'
import { fixtureReleases, fixtureTree } from '../tests/fixtures/catalog'
import { getTrackSlug } from '../src/utils/slug'

// Разбор HTML без зависимостей: достаточно для проверки тегов превью.
function parse(html: string) {
    const metas: Record<string, string[]> = {}
    for (const m of html.matchAll(/<meta\s+([^>]*?)>/g)) {
        const attrs: Record<string, string> = {}
        for (const a of m[1].matchAll(/([a-z:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
        const key = attrs.property ?? attrs.name ?? attrs['http-equiv']
        if (key) (metas[key] ??= []).push(attrs.content)
    }
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    return {
        metas,
        title: html.match(/<title>([\s\S]*?)<\/title>/)?.[1],
        canonical: html.match(/<link rel="canonical" href="([^"]*)"/)?.[1],
        link: html.match(/<body>\s*<p><a href="([^"]*)"/)?.[1],
        scripts
    }
}
const unescape = (v: string) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

const tree = new Set(fixtureTree().map((f) => f.path))
const fileExists = (rel: string) => tree.has(rel) || rel === DEFAULT_IMAGE_PATH
const SITE = 'https://frnkness.ru'

describe('страницы превью (на фикстуре каталога)', () => {
    const releases = fixtureReleases()
    const pages = buildPreviewPages(releases, { siteUrl: SITE, fileExists })
    const byFile = new Map(pages.map((p) => [p.file, p.html]))

    it('по странице на каждый релиз и каждый трек, пути /r/<id>/ и /t/<id>/<slug>/', () => {
        const expected = new Set<string>()
        for (const [id, r] of Object.entries(releases)) {
            expected.add(`r/${id}/index.html`)
            for (const t of r.tracks) expected.add(`t/${id}/${getTrackSlug(t)}/index.html`)
        }
        expect(new Set(byFile.keys())).toEqual(expected)
        expect(pages).toHaveLength(expected.size)
    })

    it('в каждой странице: og:title/description/image/url/type, twitter:card, canonical', () => {
        for (const p of pages) {
            const d = parse(p.html)
            for (const key of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'twitter:card', 'description']) {
                expect(d.metas[key], `${p.file} ${key}`).toHaveLength(1)
                expect(d.metas[key][0].length, `${p.file} ${key}`).toBeGreaterThan(0)
            }
            expect(d.metas['twitter:card'][0]).toBe('summary_large_image')
            expect(d.metas['og:image'][0]).toMatch(/^https:\/\/frnkness\.ru\/[^\s"]+$/)
            expect(d.metas['twitter:image'][0]).toBe(d.metas['og:image'][0])
            expect(d.metas['og:url'][0]).toBe(`${SITE}/${p.file.replace(/index\.html$/, '')}`)
            expect(d.canonical).toBe(d.metas['og:url'][0])
            expect(d.title).toBe(d.metas['og:title'][0])
        }
    })

    it('трек: заголовок «трек — frnk ness», обложка релиза, ссылка и скрипт ведут на #/track/…', () => {
        const html = byFile.get('t/most-venture-poopsicks/poopsicks/index.html')!
        const d = parse(html)
        expect(d.metas['og:title'][0]).toBe('POOPSICKS — frnk ness')
        expect(d.metas['og:image'][0]).toBe(`${SITE}/images/album1-cover.jpg`)
        expect(d.metas['og:type'][0]).toBe('music.song')
        expect(d.link).toBe('../../../#/track/most-venture-poopsicks/poopsicks')
        expect(d.scripts).toEqual([`location.replace("../../../#/track/most-venture-poopsicks/poopsicks");`])
    })

    it('релиз: ведёт на #/release/<id>, считает треки', () => {
        const d = parse(byFile.get('r/zlaya-nostalgia/index.html')!)
        expect(d.metas['og:type'][0]).toBe('music.album')
        expect(d.metas['og:description'][0]).toContain('7 треков')
        expect(d.link).toBe('../../#/release/zlaya-nostalgia')
        expect(d.scripts).toEqual([`location.replace("../../#/release/zlaya-nostalgia");`])
        const single = parse(byFile.get('r/disinvolto/index.html')!)
        expect(single.metas['og:description'][0]).toMatch(/^Сингл • .*1 трек\./)
    })

    it('CSP страницы: хеш равен хешу встроенного скрипта, чужим скриптам нельзя — редирект не ломается', () => {
        for (const p of pages) {
            const d = parse(p.html)
            expect(d.scripts).toHaveLength(1)
            const csp = unescape(d.metas['Content-Security-Policy'][0])
            expect(csp).toContain(`script-src ${scriptHash(d.scripts[0])}`)
            expect(csp).toContain("default-src 'none'")
            expect(csp).not.toContain('unsafe-inline')
            expect(csp).not.toContain('unsafe-eval')
            // Нет refresh-тега: краулер, идущий по нему, взял бы общие теги главной.
            expect(d.metas['refresh']).toBeUndefined()
        }
        expect(previewCsp('x')).toBe(`default-src 'none'; script-src ${scriptHash('x')}; base-uri 'none'; form-action 'none'`)
    })

    it('обложки: у релиза без файла обложки — общая картинка сайта', () => {
        const broken = fixtureReleases()
        broken['faaa'].cover = 'images/net-takogo-fajla.jpg'
        const p = buildPreviewPages(broken, { siteUrl: SITE, fileExists })
        const html = p.find((x) => x.file.startsWith('t/faaa/'))!.html
        expect(parse(html).metas['og:image'][0]).toBe(`${SITE}/${DEFAULT_IMAGE_PATH}`)
        expect(parse(p.find((x) => x.file === 'r/faaa/index.html')!.html).metas['og:image'][0]).toBe(`${SITE}/${DEFAULT_IMAGE_PATH}`)
    })

    it('обложки: своя обложка трека важнее обложки релиза; нет своей — релиза; нет и её — общая', () => {
        const withTrackCover = fixtureReleases()
        ;(withTrackCover['faaa'].tracks[0] as any).cover = 'images/single1-cover.jpg'
        const t = buildPreviewPages(withTrackCover, { siteUrl: SITE, fileExists }).find((x) => x.file.startsWith('t/faaa/'))!
        expect(parse(t.html).metas['og:image'][0]).toBe(`${SITE}/images/single1-cover.jpg`)

        ;(withTrackCover['faaa'].tracks[0] as any).cover = 'images/missing-track-cover.jpg'
        const t2 = buildPreviewPages(withTrackCover, { siteUrl: SITE, fileExists }).find((x) => x.file.startsWith('t/faaa/'))!
        expect(parse(t2.html).metas['og:image'][0]).toBe(`${SITE}/images/single6-cover.jpg`)

        expect(resolveImage(SITE, [undefined, ''], fileExists)).toBe(`${SITE}/${DEFAULT_IMAGE_PATH}`)
        // Чужой адрес вместо пути каталога не подставляется.
        expect(resolveImage(SITE, ['https://evil.example/x.jpg'], () => true)).toBe(`${SITE}/${DEFAULT_IMAGE_PATH}`)
    })

    it('пути с пробелами и кириллицей кодируются в URL', () => {
        expect(resolveImage(SITE, ['images/моя обложка.jpg'], () => true)).toBe(`${SITE}/images/%D0%BC%D0%BE%D1%8F%20%D0%BE%D0%B1%D0%BB%D0%BE%D0%B6%D0%BA%D0%B0.jpg`)
    })

    it('новый релиз в реестре сразу получает страницы', () => {
        const next = fixtureReleases()
        next['new-single'] = { type: 'single', title: 'New', year: '2026', cover: 'images/none.jpg', audioPath: 'audio/s/', lyricsPath: 'lyrics/s/', tracks: [{ num: 1, title: 'New', file: 'new.mp3', lyricsFile: '01-new.txt', id: 'new-single/new' }] }
        const files = buildPreviewPages(next, { siteUrl: SITE, fileExists }).map((p) => p.file)
        expect(files).toContain('r/new-single/index.html')
        expect(files).toContain('t/new-single/new/index.html')
    })

    it('тексты экранируются: разметка в названиях не попадает в страницу как есть', () => {
        const evil = fixtureReleases()
        evil['faaa'].title = `</title><script>alert(1)</script>"><img src=x onerror=alert(2)>`
        evil['faaa'].tracks[0].title = `"><svg onload=alert(3)> & '`
        const html = buildPreviewPages(evil, { siteUrl: SITE, fileExists }).filter((p) => p.file.includes('faaa')).map((p) => p.html).join('\n')
        expect(html).not.toContain('<script>alert')
        expect(html).not.toContain('<img src=x')
        expect(html).not.toContain('<svg onload')
        expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)')
        expect(html).toContain('&quot;&gt;&lt;svg onload=alert(3)&gt; &amp; &#39;')
        // Скрипт на странице по-прежнему один — собственный.
        for (const p of buildPreviewPages(evil, { siteUrl: SITE, fileExists })) expect(parse(p.html).scripts).toHaveLength(1)
    })

    it('идентификатор в скрипте не может закрыть тег <script>', () => {
        expect(redirectScript('../#/x</script><b>')).not.toContain('</script>')
        expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
    })
})

describe('главная и адрес сайта', () => {
    it('общие og-теги: абсолютные адреса, общая картинка', () => {
        const d = parse(`<head>${homeMetaTags(SITE)}</head>`)
        expect(d.metas['og:title'][0]).toBe('frnk ness collection')
        expect(d.metas['og:image'][0]).toBe(`${SITE}/og-default.png`)
        expect(d.metas['og:url'][0]).toBe(`${SITE}/`)
        expect(d.metas['twitter:card'][0]).toBe('summary_large_image')
    })

    it('адрес сайта: по умолчанию frnkness.ru, слэши и мусор убираются', () => {
        expect(normalizeSiteUrl(undefined)).toBe(DEFAULT_SITE_URL)
        expect(normalizeSiteUrl('')).toBe(DEFAULT_SITE_URL)
        expect(normalizeSiteUrl('javascript:alert(1)')).toBe(DEFAULT_SITE_URL)
        expect(normalizeSiteUrl('https://example.org//')).toBe('https://example.org')
        expect(DEFAULT_SITE_URL).toBe('https://frnkness.ru')
    })
})
