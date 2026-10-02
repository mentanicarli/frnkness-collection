import { describe, it, expect } from 'vitest'
import {
    checkPath,
    checkRegistryChange,
    validateNewRelease,
    validateSiteSettings,
    checkDeletions,
    type Registry,
    type RegistryRelease
} from '../../../../supabase/functions/_shared/rules.ts'
import releasesJson from '@/content/releases.json'
import siteJson from '@/content/site.json'

const current = releasesJson as unknown as Registry
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('checkPath — белый список', () => {
    it.each([
        ['lyrics/album1/01-poopsicks.txt', 'text'],
        ['lyrics/album1/01-poopsicks.lrc', 'text'],
        ['lyrics/album1/01-poopsicks.notes.json', 'text'],
        ['audio/album5/makanochki.mp3', 'binary'],
        ['audio/album 3/Última historia.mp3', 'binary'],
        ['images/album5-cover.jpg', 'binary'],
        ['images/single7-cover.PNG', 'binary'],
        ['lyrics-books/novyy-albom.pdf', 'binary'],
        ['src/content/releases.json', 'text'],
        ['src/content/site.json', 'text']
    ])('разрешает %s', (path, kind) => {
        const res = checkPath(path)
        expect(res.ok).toBe(true)
        if (res.ok) expect(res.rule.kind).toBe(kind)
    })

    it.each([
        '',
        '.github/workflows/deploy-pages.yml',
        'src/config.ts',
        'src/content/nested/x.json',
        'src/main.ts',
        'index.html',
        'package.json',
        'lyrics/../src/config.ts',
        'lyrics/./a.txt',
        '/lyrics/a.txt',
        'lyrics//a.txt',
        'lyrics\\a.txt',
        'lyrics/a.exe',
        'lyrics/a.json',
        'lyrics/.hidden/a.txt',
        'lyrics/a.txt\u0000.mp3',
        'audio/a.mp3.js',
        'audio/a.txt',
        'images/a.svg',
        'lyrics-books/a.html',
        'lyrics/.txt',
        'lyrics',
        'audio/ a.mp3'
    ])('отклоняет «%s»', (path) => {
        expect(checkPath(path).ok).toBe(false)
    })

    it('ограничивает размеры', () => {
        const mp3 = checkPath('audio/x/a.mp3')
        const txt = checkPath('lyrics/x/a.txt')
        expect(mp3.ok && mp3.rule.maxBytes).toBe(30 * 1024 * 1024)
        expect(txt.ok && txt.rule.maxBytes).toBe(512 * 1024)
    })
})

const newAlbum = (): RegistryRelease => ({
    type: 'album',
    title: 'Новый альбом',
    year: '2026',
    releaseDate: '1 октября 2026',
    cover: 'images/album5-cover.jpg',
    audioPath: 'audio/album5/',
    lyricsPath: 'lyrics/album5/',
    tracks: [
        { num: 1, title: 'Первый', file: 'pervyy.mp3', lyricsFile: '01-pervyy.txt' },
        { num: 2, title: 'Второй', file: 'vtoroy.mp3', lyricsFile: '02-vtoroy.txt' }
    ]
})

const newSingle = (): RegistryRelease => ({
    type: 'single',
    title: 'Сингл',
    year: '2026',
    releaseDate: '2 октября 2026',
    cover: 'images/single7-cover.jpg',
    audioPath: 'audio/singles/',
    lyricsPath: 'lyrics/singles/',
    videoUrl: 'https://www.youtube.com/embed/vI_8FLsAn50',
    tracks: [{ num: 1, title: 'Сингл', file: 'singl.mp3', lyricsFile: 'singl.txt' }]
})

describe('checkRegistryChange — защита статистики', () => {
    it('пропускает реестр без изменений', () => {
        expect(checkRegistryChange(current, clone(current))).toEqual([])
    })

    it('разрешает добавить альбом и сингл в конец', () => {
        const next = { ...clone(current), 'novyy-albom': newAlbum(), singl: newSingle() }
        expect(checkRegistryChange(current, next)).toEqual([])
    })

    it('запрещает удалить релиз', () => {
        const next = clone(current)
        delete next.disinvolto
        expect(checkRegistryChange(current, next).join()).toContain('«disinvolto» нельзя удалить')
    })

    it('запрещает переименовать id релиза', () => {
        const next: Registry = {}
        for (const [id, r] of Object.entries(clone(current))) next[id === 'boxik' ? 'boxik-2' : id] = r
        const errors = checkRegistryChange(current, next)
        expect(errors.join()).toContain('«boxik» нельзя удалить или переименовать')
    })

    it('запрещает переставить треки', () => {
        const next = clone(current)
        const t = next['most-venture-poopsicks'].tracks
        ;[t[0], t[1]] = [t[1], t[0]]
        expect(checkRegistryChange(current, next).join()).toContain('трек 1 нельзя менять или переставлять')
    })

    it('запрещает удалить или добавить трек в существующий релиз', () => {
        const removed = clone(current)
        removed['zlaya-nostalgia'].tracks.pop()
        expect(checkRegistryChange(current, removed).join()).toContain('нельзя добавлять или удалять треки')

        const added = clone(current)
        added['zlaya-nostalgia'].tracks.push({ num: 8, title: 'x', file: 'x.mp3', lyricsFile: '08-x.txt' })
        expect(checkRegistryChange(current, added).join()).toContain('нельзя добавлять или удалять треки')
    })

    it('запрещает менять треки и служебные поля релиза', () => {
        const track = clone(current)
        track.faaa.tracks[0].title = 'FAAA!'
        expect(checkRegistryChange(current, track)).toHaveLength(1)

        for (const [key, value] of [
            ['type', 'album'],
            ['audioPath', 'audio/other/'],
            ['lyricsPath', 'lyrics/other/'],
            ['upcoming', true]
        ] as const) {
            const next = clone(current)
            ;(next.faaa as unknown as Record<string, unknown>)[key] = value
            expect(checkRegistryChange(current, next), key).toEqual([`релиз «faaa»: поле «${key}» менять нельзя`])
        }
    })

    it('разрешает менять название, дату, обложку, видео и PDF существующего релиза', () => {
        const next = clone(current)
        Object.assign(next['zlaya-nostalgia'], {
            title: 'Злая Ностальгия (Deluxe)',
            releaseDate: '1 сентября 2026',
            cover: 'images/album4-cover-20261002.jpg',
            videoUrl: 'https://www.youtube.com/embed/vI_8FLsAn50',
            lyricsBookPath: 'lyrics-books/zlaya-nostalgia-20261002.pdf'
        })
        expect(checkRegistryChange(current, next)).toEqual([])

        // Год меняется вместе с датой.
        const moved = clone(current)
        Object.assign(moved.faaa, { releaseDate: '3 января 2027', year: '2027' })
        expect(checkRegistryChange(current, moved)).toEqual([])

        // PDF и видео можно убрать.
        const removed = clone(current)
        delete removed.disinvolto.lyricsBookPath
        delete removed.disinvolto.videoUrl
        expect(checkRegistryChange(current, removed)).toEqual([])
    })

    it('проверяет значения редактируемых полей', () => {
        const next = clone(current)
        Object.assign(next.faaa, { title: ' ', releaseDate: '1 января 2030', cover: 'images/Обложка.jpg', videoUrl: 'https://evil.example/x' })
        expect(checkRegistryChange(current, next)).toEqual([
            'релиз «faaa»: пустое название',
            'релиз «faaa»: год в дате не совпадает с полем year',
            'релиз «faaa»: обложка должна лежать в images/ и называться латиницей',
            'релиз «faaa»: ссылка на видео должна быть вида https://www.youtube.com/embed/<id>'
        ])
    })

    it('старые имена файлов допустимы, если их не трогали', () => {
        // У «Born to be Deluxe» папка аудио с пробелом — правка названия её не задевает.
        const next = clone(current)
        next['born-to-be-deluxe'].title = 'Born to be Deluxe!'
        expect(checkRegistryChange(current, next)).toEqual([])
    })

    it('новая обложка не может занять файл другого релиза', () => {
        const next = clone(current)
        next.faaa.cover = 'images/album4-cover.jpg'
        expect(checkRegistryChange(current, next)).toEqual(['релиз «faaa»: файл images/album4-cover.jpg уже занят релизом «zlaya-nostalgia»'])
    })

    it('id и треки по-прежнему защищены при правке остальных полей', () => {
        const next: Registry = {}
        for (const [id, r] of Object.entries(clone(current))) next[id === 'faaa' ? 'faaa-new' : id] = { ...r, title: r.title + '!' }
        expect(checkRegistryChange(current, next).join()).toContain('«faaa» нельзя удалить или переименовать')

        const reordered = clone(current)
        reordered['zlaya-nostalgia'].title = 'Другое'
        reordered['zlaya-nostalgia'].tracks.reverse()
        expect(checkRegistryChange(current, reordered).join()).toContain('нельзя менять или переставлять')
    })

    it('не реагирует на порядок полей внутри объекта', () => {
        const next = clone(current)
        const { tracks, ...rest } = next.faaa
        next.faaa = { tracks, ...rest }
        expect(checkRegistryChange(current, next)).toEqual([])
    })

    it('запрещает переставлять существующие релизы', () => {
        const entries = Object.entries(clone(current))
        ;[entries[0], entries[1]] = [entries[1], entries[0]]
        expect(checkRegistryChange(current, Object.fromEntries(entries))).toEqual(['нельзя менять порядок существующих релизов'])
    })

    it('не даёт новому релизу занять чужие файлы и папки', () => {
        const single = newSingle()
        single.tracks[0] = { num: 1, title: 'x', file: 'boxik.mp3', lyricsFile: 'boxik.txt' }
        const errors = checkRegistryChange(current, { ...clone(current), x: single })
        expect(errors).toContain('файл audio/singles/boxik.mp3 уже занят релизом «boxik»')
        expect(errors).toContain('файл lyrics/singles/boxik.txt уже занят релизом «boxik»')

        const album = { ...newAlbum(), lyricsPath: 'lyrics/album4/', cover: 'images/album4-cover.jpg' }
        const albumErrors = checkRegistryChange(current, { ...clone(current), y: album })
        expect(albumErrors).toContain('папка lyrics/album4/ уже занята релизом «zlaya-nostalgia»')
        expect(albumErrors).toContain('файл images/album4-cover.jpg уже занят релизом «zlaya-nostalgia»')
    })

    it('проверяет структуру нового релиза', () => {
        const bad = { ...newAlbum(), audioPath: 'audio/album 5/' }
        expect(checkRegistryChange(current, { ...clone(current), 'Bad Id': bad }).length).toBeGreaterThanOrEqual(2)
    })

    it('отклоняет мусор вместо объекта', () => {
        expect(checkRegistryChange(current, [])).toEqual(['releases.json должен быть объектом'])
    })
})

describe('validateNewRelease', () => {
    it('принимает корректные альбом и сингл', () => {
        expect(validateNewRelease('novyy-albom', newAlbum())).toEqual([])
        expect(validateNewRelease('singl', newSingle())).toEqual([])
    })

    it('требует соглашения о файлах', () => {
        const album = newAlbum()
        album.tracks[1].lyricsFile = '03-vtoroy.txt'
        album.tracks[0].file = 'Первый.mp3'
        const errors = validateNewRelease('a', album)
        expect(errors).toContain('релиз «a», трек 2: номер в имени файла текста должен быть 02')
        expect(errors).toContain('релиз «a», трек 1: mp3 должен называться <slug>.mp3 латиницей')

        const single = newSingle()
        single.tracks[0].lyricsFile = '01-singl.txt'
        single.audioPath = 'audio/album6/'
        const sErrors = validateNewRelease('s', single)
        expect(sErrors).toContain('релиз «s», трек 1: файл текста — slug.txt')
        expect(sErrors).toContain('релиз «s»: аудио сингла лежит в audio/singles/')
    })

    it('ловит повтор slug и неверную нумерацию', () => {
        const album = newAlbum()
        album.tracks[1] = { num: 3, title: 'Дубль', file: 'dubl.mp3', lyricsFile: '02-pervyy.txt' }
        const errors = validateNewRelease('a', album)
        expect(errors).toContain('релиз «a», трек 2: номер должен быть 2')
        expect(errors).toContain('релиз «a», трек 2: slug «pervyy» уже есть в релизе')
    })

    it('проверяет дату и год', () => {
        expect(validateNewRelease('a', { ...newAlbum(), releaseDate: '1 октября 2025' })).toContain('релиз «a»: год в дате не совпадает с полем year')
        expect(validateNewRelease('a', { ...newAlbum(), releaseDate: '01.10.2026' })).toContain('релиз «a»: дата должна быть вида «26 августа 2026»')
    })

    it('проверяет ссылку на видео', () => {
        expect(validateNewRelease('s', { ...newSingle(), videoUrl: 'https://evil.example/embed/x' }).join()).toContain('youtube.com/embed')
    })
})

describe('validateSiteSettings', () => {
    it('принимает текущий site.json', () => {
        expect(validateSiteSettings(siteJson, current)).toEqual([])
    })

    it('требует существующий релиз и булев флаг', () => {
        expect(validateSiteSettings({ promo: { enabled: 'yes', releaseId: 'nope' } }, current)).toEqual([
            'site.json: promo.enabled должно быть true/false',
            'site.json: promo.releaseId должен быть id существующего релиза'
        ])
        expect(validateSiteSettings({ promo: { enabled: true, releaseId: 'faaa' }, extra: 1 }, current)).toEqual([
            'site.json: лишнее поле «extra»'
        ])
    })
})

describe('checkDeletions — удалять можно только заменяемое', () => {
    const site = siteJson as unknown

    it('старая обложка и PDF после замены — можно', () => {
        const next = clone(current)
        next['most-venture-poopsicks'].cover = 'images/album1-cover-20261002.jpg'
        next['most-venture-poopsicks'].lyricsBookPath = 'lyrics-books/most-venture-poopsicks-20261002.pdf'
        expect(
            checkDeletions(['images/album1-cover.jpg', 'lyrics-books/most-venture-poopsicks.pdf'], { registry: current, site }, { registry: next, site })
        ).toEqual([])
    })

    it('убранный PDF — можно', () => {
        const next = clone(current)
        delete next.disinvolto.lyricsBookPath
        expect(checkDeletions(['lyrics-books/disinvolto.pdf'], { registry: current, site }, { registry: next, site })).toEqual([])
    })

    it('обложку, которая ещё используется, — нельзя', () => {
        expect(checkDeletions(['images/album1-cover.jpg'], { registry: current, site }, { registry: current, site })).toEqual([
            'файл ещё используется, удалять нельзя: images/album1-cover.jpg'
        ])
    })

    it('mp3, тексты и чужие файлы — нельзя', () => {
        expect(
            checkDeletions(['audio/album1/poopsicks.mp3', 'lyrics/album1/01-poopsicks.txt', 'images/unrelated.jpg'], { registry: current, site }, { registry: current, site })
        ).toEqual([
            'удалять можно только заменяемую обложку или PDF: audio/album1/poopsicks.mp3',
            'удалять можно только заменяемую обложку или PDF: lyrics/album1/01-poopsicks.txt',
            'удалять можно только заменяемую обложку или PDF: images/unrelated.jpg'
        ])
    })
})

describe('site.json: анонс', () => {
    const announce = {
        enabled: true,
        title: 'Новый альбом',
        cover: 'images/announce-novyy-albom-20261002.jpg',
        releaseAt: '2026-11-01T18:00:00+03:00',
        text: 'Пресейв открыт',
        url: 'https://example.com/presave'
    }

    it('старый формат без анонса и полный анонс — валидны', () => {
        expect(validateSiteSettings({ promo: { enabled: true, releaseId: 'faaa' } }, current)).toEqual([])
        expect(validateSiteSettings({ promo: { enabled: true, releaseId: 'faaa' }, announce }, current)).toEqual([])
        const { text: _t, url: _u, ...minimal } = announce
        expect(validateSiteSettings({ promo: { enabled: false, releaseId: 'faaa' }, announce: minimal }, current)).toEqual([])
    })

    it('проверяет поля анонса', () => {
        const bad = { enabled: 'да', title: '', cover: 'images/Обложка.jpg', releaseAt: '2026-11-01 18:00', url: 'http://x', extra: 1 }
        expect(validateSiteSettings({ promo: { enabled: true, releaseId: 'faaa' }, announce: bad }, current)).toEqual([
            'site.json: announce: лишнее поле «extra»',
            'site.json: announce.enabled должно быть true/false',
            'site.json: announce.title — от 1 до 120 символов',
            'site.json: announce.cover должна лежать в images/ и называться латиницей',
            'site.json: announce.releaseAt — дата и время по Москве вида 2026-11-01T18:00:00+03:00',
            'site.json: announce.url — ссылка https://…'
        ])
    })

    it('время только по Москве (+03:00)', () => {
        const utc = { ...announce, releaseAt: '2026-11-01T15:00:00Z' }
        expect(validateSiteSettings({ promo: { enabled: true, releaseId: 'faaa' }, announce: utc }, current)).toHaveLength(1)
    })

    it('обложку анонса можно удалить при замене', () => {
        const before = { promo: { enabled: true, releaseId: 'faaa' }, announce }
        const after = { promo: { enabled: true, releaseId: 'faaa' }, announce: { ...announce, cover: 'images/announce-novyy-albom-20261003.jpg' } }
        expect(checkDeletions([announce.cover], { registry: current, site: before }, { registry: current, site: after })).toEqual([])
        expect(checkDeletions([announce.cover], { registry: current, site: before }, { registry: current, site: before })).toHaveLength(1)
        // Анонс убран целиком — обложка больше не нужна.
        expect(checkDeletions([announce.cover], { registry: current, site: before }, { registry: current, site: { promo: before.promo } })).toEqual([])
    })
})
