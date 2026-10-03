import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { checkContent } from '../checkContent'
import { FIXTURE_ROOT, copyFixture } from '../../../tests/fixtures/catalog'

const dirs: string[] = []
afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function catalog() {
    const root = copyFixture()
    dirs.push(root)
    const file = (rel: string) => path.join(root, rel)
    const json = (rel: string) => JSON.parse(fs.readFileSync(file(rel), 'utf8'))
    const write = (rel: string, data: string | object) => {
        fs.mkdirSync(path.dirname(file(rel)), { recursive: true })
        fs.writeFileSync(file(rel), typeof data === 'string' ? data : JSON.stringify(data, null, 4) + '\n')
    }
    return { root, file, json, write, check: () => checkContent(root).errors }
}

describe('checkContent: корректный каталог', () => {
    it('фикстура проходит без ошибок', () => {
        const report = checkContent(FIXTURE_ROOT)
        expect(report.errors).toEqual([])
        expect(report.stats).toEqual({ releases: 7, tracks: 18, notes: 17, lrc: 8 })
    })

    it('пустой текст трека допустим', () => {
        const c = catalog()
        c.write('lyrics/album3/03-come-n-team.txt', '')
        expect(c.check()).toEqual([])
    })

    it('у анонсированного релиза файлов треков может не быть', () => {
        const c = catalog()
        const reg = c.json('src/content/releases.json')
        reg.soon = { ...reg.faaa, title: 'Скоро', upcoming: true, tracks: [{ num: 1, title: 'Скоро', file: 'soon.mp3', lyricsFile: 'soon.txt' }] }
        c.write('src/content/releases.json', reg)
        expect(c.check()).toEqual([])
    })
})

describe('checkContent: ошибки', () => {
    it('битый releases.json', () => {
        const c = catalog()
        c.write('src/content/releases.json', '{ "faaa": ')
        expect(c.check()[0]).toMatch(/^src\/content\/releases\.json: битый JSON/)
    })

    it('схема реестра', () => {
        const c = catalog()
        const reg = c.json('src/content/releases.json')
        reg.faaa.type = 'ep'
        reg.faaa.extra = 1
        reg.boxik.audioPath = 'audio/album9/'
        reg.boxik.releaseDate = '11 апреля 2025'
        reg['six-senses-pupsiks'].tracks[1].num = 5
        reg['six-senses-pupsiks'].tracks[1].lyricsFile = '01-still-ballin.txt'
        c.write('src/content/releases.json', reg)
        const errors = c.check()
        expect(errors).toContain('src/content/releases.json: релиз «faaa»: type должен быть album или single')
        expect(errors).toContain('src/content/releases.json: релиз «faaa»: лишнее поле «extra»')
        expect(errors).toContain('src/content/releases.json: релиз «boxik»: аудио сингла лежит в audio/singles/')
        expect(errors).toContain('src/content/releases.json: релиз «boxik»: год в releaseDate не совпадает с year')
        expect(errors).toContain('src/content/releases.json: релиз «six-senses-pupsiks», трек 2: num должен быть 2')
        expect(errors).toContain('src/content/releases.json: релиз «six-senses-pupsiks», трек 2: адрес трека «still-ballin» уже занят в этом релизе')
    })

    it('нет mp3, обложки, PDF; регистр в имени файла важен', () => {
        const c = catalog()
        fs.rmSync(c.file('audio/singles/faaa.mp3'))
        fs.rmSync(c.file('images/single4-cover.jpg'))
        fs.rmSync(c.file('lyrics-books/disinvolto.pdf'))
        fs.renameSync(c.file('audio/album 3/ZAL.mp3'), c.file('audio/album 3/zal.mp3'))
        expect(c.check()).toEqual([
            'релиз «disinvolto»: PDF: нет файла lyrics-books/disinvolto.pdf',
            'релиз «boxik»: обложка: нет файла images/single4-cover.jpg',
            'релиз «faaa», трек 1: mp3: нет файла audio/singles/faaa.mp3',
            'релиз «born-to-be-deluxe», трек 1: mp3: нет файла audio/album 3/ZAL.mp3'
        ])
    })

    it('нет файла текста трека; пустой mp3', () => {
        const c = catalog()
        fs.rmSync(c.file('lyrics/album3/03-come-n-team.txt'))
        c.write('audio/singles/boxik.mp3', '')
        expect(c.check()).toEqual([
            'релиз «boxik», трек 1: mp3: пустой файл audio/singles/boxik.mp3',
            'релиз «born-to-be-deluxe», трек 3: текст: нет файла lyrics/album3/03-come-n-team.txt'
        ])
    })

    it('site.json: промо на несуществующий релиз, анонс без обложки', () => {
        const c = catalog()
        c.write('src/content/site.json', {
            promo: { enabled: true, releaseId: 'nope' },
            announce: { enabled: true, title: 'Скоро', cover: 'images/announce-x.jpg', releaseAt: '2026-11-01T18:00:00+03:00' }
        })
        expect(c.check()).toEqual([
            'src/content/site.json: promo.releaseId должен быть id существующего релиза',
            'site.json: обложка анонса: нет файла images/announce-x.jpg'
        ])
    })

    it('разборы: битый JSON, схема, висящий разбор, разбор без текста', () => {
        const c = catalog()
        c.write('lyrics/singles/faaa.notes.json', '{oops')
        c.write('lyrics/singles/boxik.notes.json', { annotations: [{ line: '', note: 'x' }] })
        c.write('lyrics/album3/01-zal.notes.json', { annotations: [{ line: 'Такой строки в тексте нет', note: 'x' }] })
        c.write('lyrics/album3/09-lost.notes.json', { about: 'x' })
        const errors = c.check()
        expect(errors.find((e) => e.startsWith('lyrics/singles/faaa.notes.json: битый JSON'))).toBeTruthy()
        expect(errors).toContain('lyrics/singles/boxik.notes.json: разбор #1: пустая строка')
        expect(errors).toContain('lyrics/album3/01-zal.notes.json: висящий разбор — строки «Такой строки в тексте нет» нет в тексте')
        expect(errors).toContain('lyrics/album3/09-lost.notes.json: нет файла текста lyrics/album3/09-lost.txt')
        expect(errors).toHaveLength(4)
    })

    it('.lrc: строка без времени, пустой файл, .lrc без текста', () => {
        const c = catalog()
        c.write('lyrics/singles/faaa.lrc', '[00:01.00]Раз\nДва без времени\n')
        c.write('lyrics/singles/boxik.lrc', '\n')
        c.write('lyrics/album3/09-lost.lrc', '[00:01.00]Раз\n')
        expect(c.check()).toEqual([
            'lyrics/album3/09-lost.lrc: нет файла текста lyrics/album3/09-lost.txt',
            'lyrics/singles/boxik.lrc: пустой .lrc',
            'lyrics/singles/faaa.lrc: строка 2 без метки времени [mm:ss.xx]: «Два без времени»'
        ])
    })
})
