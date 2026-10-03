import { describe, it, expect } from 'vitest'
import { formFromRelease, orderReleaseFields, planEdit, versionedPath } from '../editRelease'
import { serializeReleases } from '../content'
import { fixtureReleases, fixtureTree } from '../../../../tests/fixtures/catalog'

const releases = fixtureReleases()
const files = fixtureTree()
const TODAY = '2026-10-02'

describe('versionedPath', () => {
    it('дата в имени рядом со старым файлом', () => {
        expect(versionedPath('images/album4-cover.jpg', 'jpg', TODAY, new Set(), 'x')).toBe('images/album4-cover-20261002.jpg')
        expect(versionedPath('images/album4-cover-20260101.jpg', 'png', TODAY, new Set(), 'x')).toBe('images/album4-cover-20261002.png')
    })

    it('повтор в тот же день — суффикс', () => {
        const taken = new Set(['images/album4-cover-20261002.jpg', 'images/album4-cover-20261002-2.jpg'])
        expect(versionedPath('images/album4-cover-20261002.jpg', 'jpg', TODAY, taken, 'x')).toBe('images/album4-cover-20261002-3.jpg')
    })

    it('имя не латиницей — запасная основа', () => {
        expect(versionedPath('images/Обложка.jpg', 'jpg', TODAY, new Set(), 'faaa-cover')).toBe('images/faaa-cover-20261002.jpg')
    })
})

describe('planEdit', () => {
    it('без изменений — пустой план', () => {
        const plan = planEdit(releases, 'faaa', formFromRelease(releases.faaa), files, TODAY)
        expect(plan.changes).toEqual([])
        expect(plan.errors).toEqual([])
        expect(serializeReleases(plan.next)).toBe(serializeReleases(releases))
    })

    it('название, дата, обложка, видео: новые имена, старая обложка удаляется, порядок полей прежний', () => {
        const form = { ...formFromRelease(releases['zlaya-nostalgia']), title: 'Злая Ностальгия (Deluxe)', date: '2026-09-01', newCover: { ext: 'jpg' as const }, youtube: 'https://youtu.be/vI_8FLsAn50' }
        const plan = planEdit(releases, 'zlaya-nostalgia', form, files, TODAY)
        expect(plan.errors).toEqual([])
        expect(plan.changes).toEqual(['название', 'дата', 'обложка', 'видео'])
        expect(plan.uploads).toEqual([{ kind: 'cover', path: 'images/album4-cover-20261002.jpg' }])
        expect(plan.deletes).toEqual(['images/album4-cover.jpg'])
        expect(plan.release).toMatchObject({ title: 'Злая Ностальгия (Deluxe)', year: '2026', releaseDate: '1 сентября 2026', videoUrl: 'https://www.youtube.com/embed/vI_8FLsAn50' })
        // Треки и служебные поля — те же объекты.
        expect(plan.release.tracks).toBe(releases['zlaya-nostalgia'].tracks)
        expect(Object.keys(plan.release)).toEqual(['type', 'title', 'year', 'releaseDate', 'cover', 'audioPath', 'lyricsPath', 'lyricsBookPath', 'videoUrl', 'tracks'])
        // Порядок релизов не меняется, остальные записи — без изменений.
        expect(Object.keys(plan.next)).toEqual(Object.keys(releases))
        for (const id of Object.keys(releases)) if (id !== 'zlaya-nostalgia') expect(plan.next[id]).toBe(releases[id])
    })

    it('год меняется вместе с датой', () => {
        const plan = planEdit(releases, 'faaa', { ...formFromRelease(releases.faaa), date: '2027-01-03' }, files, TODAY)
        expect(plan.release).toMatchObject({ year: '2027', releaseDate: '3 января 2027' })
        expect(plan.errors).toEqual([])
    })

    it('PDF: заменить, убрать, добавить', () => {
        const replace = planEdit(releases, 'disinvolto', { ...formFromRelease(releases.disinvolto), pdf: 'replace' }, files, TODAY)
        expect(replace.uploads).toEqual([{ kind: 'pdf', path: 'lyrics-books/disinvolto-20261002.pdf' }])
        expect(replace.deletes).toEqual(['lyrics-books/disinvolto.pdf'])

        const remove = planEdit(releases, 'disinvolto', { ...formFromRelease(releases.disinvolto), pdf: 'remove' }, files, TODAY)
        expect(remove.release.lyricsBookPath).toBeUndefined()
        expect(remove.deletes).toEqual(['lyrics-books/disinvolto.pdf'])
        expect(remove.changes).toEqual(['PDF убран'])

        const add = planEdit(releases, 'faaa', { ...formFromRelease(releases.faaa), pdf: 'replace' }, files, TODAY)
        expect(add.uploads).toEqual([{ kind: 'pdf', path: 'lyrics-books/faaa.pdf' }])
        expect(add.deletes).toEqual([])
        expect(Object.keys(add.release)).toEqual(['type', 'title', 'year', 'releaseDate', 'cover', 'audioPath', 'lyricsPath', 'lyricsBookPath', 'tracks'])
    })

    it('видео можно убрать', () => {
        const plan = planEdit(releases, 'disinvolto', { ...formFromRelease(releases.disinvolto), youtube: '' }, files, TODAY)
        expect(plan.release.videoUrl).toBeUndefined()
        expect(plan.changes).toEqual(['видео убрано'])
    })

    it('ошибки ввода', () => {
        const plan = planEdit(releases, 'faaa', { ...formFromRelease(releases.faaa), title: ' ', youtube: 'https://evil.example', date: '' }, files, TODAY)
        expect(plan.errors).toContain('Укажи дату релиза')
        expect(plan.errors).toContain('Не получилось распознать ссылку на YouTube')
        expect(plan.errors).toContain('релиз «faaa»: пустое название')
    })

    it('orderReleaseFields', () => {
        expect(Object.keys(orderReleaseFields({ tracks: [], title: 't', type: 'single', extra: 1 }))).toEqual(['type', 'title', 'tracks', 'extra'])
    })
})
