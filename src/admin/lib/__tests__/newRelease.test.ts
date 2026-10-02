import { describe, it, expect } from 'vitest'
import type { Releases } from '@/types'
import releasesJson from '@/content/releases.json'
import { getTrackSlug } from '@/utils/slug'
import {
    appendRelease,
    nextNumber,
    planRelease,
    slugify,
    transliterate,
    uniqueId,
    validateDraft,
    youtubeEmbed,
    type ReleaseDraft
} from '../newRelease'
import { checkRegistryChange, type Registry } from '../../../../supabase/functions/_shared/rules.ts'

const releases = releasesJson as unknown as Releases
const files = Object.values(releases).flatMap((r) => [
    { path: r.cover },
    ...r.tracks.flatMap((t) => [{ path: r.audioPath + t.file }, { path: r.lyricsPath + t.lyricsFile }])
])

describe('транслитерация и slug', () => {
    it('совпадает с существующими slug', () => {
        expect(slugify('Маканочки')).toBe('makanochki')
        expect(slugify('Общество Могнутых Аналитиков')).toBe('obshchestvo-mognutyh-analitikov')
        expect(slugify('ПУПСАСТИЯ')).toBe('pupsastiya')
        expect(slugify('Случайно взяли топ один')).toBe('sluchayno-vzyali-top-odin')
        expect(slugify('Бильярд')).toBe('bilyard')
        expect(slugify('ГОУТЫ')).toBe('gouty')
        expect(slugify('Международный')).toBe('mezhdunarodny')
        expect(slugify('Борода, потом Марат')).toBe('boroda-potom-marat')
        expect(slugify('Última Historia')).toBe('ultima-historia')
        expect(slugify('22_00')).toBe('22-00')
        expect(slugify("still ballin'")).toBe('still-ballin')
    })

    it('ё, й, ъ, ь, щ', () => {
        expect(transliterate('ёжик йод объезд щука')).toBe('ezhik yod obezd shchuka')
        expect(slugify('  —  ')).toBe('')
        expect(slugify('a'.repeat(80)).length).toBe(60)
    })

    it('уникальный id', () => {
        expect(uniqueId('faaa', new Set(Object.keys(releases)))).toBe('faaa-2')
        expect(uniqueId('new', new Set(['new', 'new-2']))).toBe('new-3')
        expect(uniqueId('', new Set())).toBe('release')
    })
})

describe('соглашения о папках', () => {
    it('следующий номер альбома и сингла', () => {
        // album 3 (с пробелом), album3, album4 → 5; single1..6 → 7.
        expect(nextNumber('album', releases, files)).toBe(5)
        expect(nextNumber('single', releases, files)).toBe(7)
        expect(nextNumber('album', releases, [...files, { path: 'audio/album9/x.mp3' }])).toBe(10)
    })

    it('ссылка YouTube в embed', () => {
        expect(youtubeEmbed('https://www.youtube.com/watch?v=vI_8FLsAn50&t=3s')).toBe('https://www.youtube.com/embed/vI_8FLsAn50')
        expect(youtubeEmbed('https://youtu.be/vI_8FLsAn50')).toBe('https://www.youtube.com/embed/vI_8FLsAn50')
        expect(youtubeEmbed('https://www.youtube.com/embed/vI_8FLsAn50')).toBe('https://www.youtube.com/embed/vI_8FLsAn50')
        expect(youtubeEmbed('https://evil.example/watch?v=vI_8FLsAn50')).toBeNull()
        expect(youtubeEmbed('')).toBeNull()
    })
})

const album = (): ReleaseDraft => ({
    type: 'album',
    title: 'Новый альбом',
    id: 'novyy-albom',
    date: '2026-10-15',
    cover: { name: 'c.jpg', size: 300_000, width: 1254, height: 1254 },
    youtube: '',
    pdf: { name: 'book.pdf', size: 100_000 },
    tracks: [
        { title: 'Первый трек', slug: 'pervy-trek', audio: { name: 'a.mp3', size: 8_000_000 } },
        { title: 'Второй', slug: 'vtoroy', audio: { name: 'b.mp3', size: 9_000_000 } }
    ]
})

const single = (): ReleaseDraft => ({
    type: 'single',
    title: 'Сингл',
    id: 'singl',
    date: '2026-10-20',
    cover: { name: 'c.jpg', size: 200_000, width: 1024, height: 1024 },
    youtube: 'https://youtu.be/vI_8FLsAn50',
    pdf: null,
    tracks: [{ title: 'Сингл', slug: 'singl', audio: { name: 's.mp3', size: 5_000_000 } }]
})

describe('planRelease', () => {
    it('альбом: albumN, NN-slug.txt, дата в формате реестра', () => {
        const plan = planRelease(album(), releases, files)
        expect(plan.release).toEqual({
            type: 'album',
            title: 'Новый альбом',
            year: '2026',
            releaseDate: '15 октября 2026',
            cover: 'images/album5-cover.jpg',
            audioPath: 'audio/album5/',
            lyricsPath: 'lyrics/album5/',
            lyricsBookPath: 'lyrics-books/novyy-albom.pdf',
            tracks: [
                { num: 1, title: 'Первый трек', file: 'pervy-trek.mp3', lyricsFile: '01-pervy-trek.txt' },
                { num: 2, title: 'Второй', file: 'vtoroy.mp3', lyricsFile: '02-vtoroy.txt' }
            ]
        })
        // Порядок полей как у существующих записей.
        expect(Object.keys(plan.release)).toEqual(Object.keys(releases['most-venture-poopsicks']))
        expect(plan.paths.tracks[1]).toEqual({ audio: 'audio/album5/vtoroy.mp3', txt: 'lyrics/album5/02-vtoroy.txt' })
        // slug в URL трека — тот, что ввели.
        expect(plan.release.tracks.map((t) => getTrackSlug(t))).toEqual(['pervy-trek', 'vtoroy'])
    })

    it('сингл: общие папки singles, slug.txt без номера, embed-ссылка', () => {
        const plan = planRelease(single(), releases, files)
        expect(plan.release).toMatchObject({
            cover: 'images/single7-cover.jpg',
            audioPath: 'audio/singles/',
            lyricsPath: 'lyrics/singles/',
            videoUrl: 'https://www.youtube.com/embed/vI_8FLsAn50',
            tracks: [{ num: 1, title: 'Сингл', file: 'singl.mp3', lyricsFile: 'singl.txt' }]
        })
        expect(plan.release.lyricsBookPath).toBeUndefined()
    })
})

describe('validateDraft', () => {
    it('корректные альбом и сингл проходят ту же проверку, что функция', () => {
        expect(validateDraft(album(), releases, files)).toEqual([])
        expect(validateDraft(single(), releases, files)).toEqual([])
    })

    it('существующие релизы не меняются: новый реестр отличается только новым ключом в конце', () => {
        const plan = planRelease(album(), releases, files)
        const next = appendRelease(releases, plan)
        expect(Object.keys(next)).toEqual([...Object.keys(releases), 'novyy-albom'])
        for (const id of Object.keys(releases)) expect(next[id]).toBe(releases[id])
        expect(checkRegistryChange(releases as unknown as Registry, next as unknown as Registry)).toEqual([])
    })

    it('занятый id, повтор slug, неквадратная обложка', () => {
        const d = album()
        d.id = 'faaa'
        d.tracks[1].slug = 'pervy-trek'
        d.cover = { name: 'c.jpg', size: 100, width: 737, height: 810 }
        expect(validateDraft(d, releases, files)).toEqual([
            'Релиз с ID «faaa» уже есть',
            'Обложка должна быть квадратной (сейчас 737×810)',
            'Трек 2: slug «pervy-trek» уже у трека 1'
        ])
    })

    it('сингл не может занять файлы другого сингла', () => {
        const d = single()
        d.tracks[0].slug = 'boxik'
        expect(validateDraft(d, releases, files)).toContain('Файл audio/singles/boxik.mp3 уже есть в репозитории — поменяй slug')
    })

    it('без обложки, mp3 и названий', () => {
        const d = single()
        d.title = ' '
        d.cover = null
        d.tracks = [{ title: '', slug: 'x', audio: null }]
        expect(validateDraft(d, releases, files)).toEqual(['Укажи название релиза', 'Добавь обложку (jpg)', 'Трек 1: нет названия', 'Трек 1: нет mp3'])
    })

    it('маленькая обложка и сингл из двух треков', () => {
        const d = single()
        d.cover = { name: 'c.jpg', size: 1, width: 500, height: 500 }
        d.tracks.push({ title: 'Ещё', slug: 'eshche', audio: { name: 'x.mp3', size: 1 } })
        expect(validateDraft(d, releases, files)).toEqual(['Обложка слишком маленькая: нужно от 600×600', 'У сингла ровно один трек'])
    })
})
