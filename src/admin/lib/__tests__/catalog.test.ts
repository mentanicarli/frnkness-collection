import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import type { Releases } from '@/types'
import { computeCatalogReport, contentPathsNeeded } from '../catalog'
import releasesJson from '@/content/releases.json'

const ROOT = path.resolve(__dirname, '../../../..')
const releases = releasesJson as unknown as Releases

const mini: Releases = {
    one: {
        type: 'album',
        title: 'Один',
        year: '2026',
        cover: 'images/one.jpg',
        audioPath: 'audio/one/',
        lyricsPath: 'lyrics/one/',
        lyricsBookPath: 'lyrics-books/one.pdf',
        tracks: [
            { num: 1, title: 'Полный', file: 'full.mp3', lyricsFile: '01-full.txt' },
            { num: 2, title: 'Пустой', file: 'empty.mp3', lyricsFile: '02-empty.txt' },
            { num: 3, title: 'Без файлов', file: 'none.mp3', lyricsFile: '03-none.txt' },
            { num: 4, title: 'Битые разборы', file: 'broken.mp3', lyricsFile: '04-broken.txt' }
        ]
    }
}

const files = [
    { path: 'images/one.jpg', size: 1000 },
    { path: 'audio/one/full.mp3', size: 5 },
    { path: 'audio/one/empty.mp3', size: 5 },
    { path: 'audio/one/broken.mp3', size: 5 },
    { path: 'lyrics/one/01-full.txt', size: 20 },
    { path: 'lyrics/one/01-full.lrc', size: 20 },
    { path: 'lyrics/one/01-full.notes.json', size: 20 },
    { path: 'lyrics/one/02-empty.txt', size: 0 },
    { path: 'lyrics/one/04-broken.txt', size: 3 },
    { path: 'lyrics/one/04-broken.notes.json', size: 3 },
    { path: 'audio/one/old-take.mp3', size: 7 },
    { path: 'lyrics/other/x.txt', size: 1 },
    { path: 'src/main.ts', size: 1 }
]

const contents = {
    'lyrics/one/01-full.txt': 'Первая строка,\nВторая\n',
    'lyrics/one/01-full.notes.json': JSON.stringify({ annotations: [{ line: 'первая строка', note: 'a' }, { line: 'Удалённая', note: 'b' }] }),
    'lyrics/one/04-broken.txt': 'abc',
    'lyrics/one/04-broken.notes.json': '{oops'
}

describe('отчёт о каталоге', () => {
    const report = computeCatalogReport(mini, files, contents)
    const [one] = report.releases

    it('по релизу: обложка и PDF', () => {
        expect(one.cover).toBe(true)
        expect(one.pdf).toBe(false)
        expect(one.problems.map((p) => p.text)).toEqual(['нет PDF lyrics-books/one.pdf'])
    })

    it('полный трек: разборы и висящие', () => {
        const t = one.tracks[0]
        expect(t).toMatchObject({ audio: true, txt: 'ok', lrc: true, notes: 'ok', annotations: 2, dangling: 1 })
        expect(t.problems).toEqual([{ severity: 'warn', text: '1 разбор(ов) не находят строку в тексте', action: 'lyrics' }])
    })

    it('пустой текст ведёт в редактор, а не в синхронизатор', () => {
        const t = one.tracks[1]
        expect(t.txt).toBe('empty')
        expect(t.problems.map((p) => p.action)).toEqual(['lyrics'])
    })

    it('нет mp3 и файла текста', () => {
        const t = one.tracks[2]
        expect(t.problems.map((p) => [p.severity, p.text])).toEqual([
            ['error', 'нет mp3 audio/one/none.mp3'],
            ['error', 'нет файла текста lyrics/one/03-none.txt']
        ])
    })

    it('битый .notes.json и нет караоке', () => {
        const t = one.tracks[3]
        expect(t.notes).toBe('broken')
        expect(t.problems.map((p) => [p.text, p.action])).toEqual([
            ['нет караоке (.lrc)', 'lrc'],
            ['файл разборов повреждён', 'lyrics']
        ])
    })

    it('файлы без ссылок только в audio/, images/, lyrics/', () => {
        expect(report.orphans.map((o) => o.path)).toEqual(['audio/one/old-take.mp3', 'lyrics/other/x.txt'])
    })

    it('счётчики по важности', () => {
        expect(report.counts).toEqual({ error: 4, warn: 3, info: 0 })
    })

    it('читает содержимое только там, где есть .notes.json', () => {
        expect(contentPathsNeeded(mini, files)).toEqual([
            'lyrics/one/01-full.notes.json',
            'lyrics/one/01-full.txt',
            'lyrics/one/04-broken.notes.json',
            'lyrics/one/04-broken.txt'
        ])
    })
})

describe('отчёт по настоящему репозиторию', () => {
    it('считается без ошибок и находит известные пробелы', () => {
        const tree = execSync('git -c core.quotepath=off ls-files', { cwd: ROOT, encoding: 'utf8' })
            .split('\n')
            .filter((p) => p && fs.existsSync(path.join(ROOT, p)))
            .map((p) => ({ path: p, size: fs.statSync(path.join(ROOT, p)).size }))
        const needed = contentPathsNeeded(releases, tree)
        const contents = Object.fromEntries(needed.map((p) => [p, fs.readFileSync(path.join(ROOT, p), 'utf8')]))
        const report = computeCatalogReport(releases, tree, contents)

        const all = report.releases.flatMap((r) => r.tracks)
        expect(all).toHaveLength(Object.values(releases).reduce((s, r) => s + r.tracks.length, 0))
        // Все mp3 и обложки на месте.
        expect(all.every((t) => t.audio)).toBe(true)
        expect(report.releases.every((r) => r.cover)).toBe(true)
        // Пустые тексты в репозитории — «Текст будет позже».
        const empty = all.filter((t) => t.txt === 'empty').map((t) => t.title)
        expect(empty).toEqual(expect.arrayContaining(['COMЁ N TEAM', 'ПУПСАСТИЯ']))
        // У POOPSICKS есть .lrc и разборы.
        expect(all[0]).toMatchObject({ title: 'POOPSICKS', lrc: true, notes: 'ok' })
        expect(all[0].annotations).toBeGreaterThan(0)
    })
})
