// «Мой топ-4»: места, пропавшие треки, правка черновика, поиск по каталогу.
import { describe, it, expect } from 'vitest'
import type { Releases } from '@/types'
import { TOP4_SIZE, addToDraft, canAdd, draftFromRows, moveInDraft, removeFromDraft, sameDraft, searchTracks, top4Slots } from '../social/top4'

const track = (rel: string, slug: string, num: number, title = slug) => ({ id: `${rel}/${slug}`, num, title, file: `${slug}.mp3`, lyricsFile: `${slug}.txt` })
const RELEASES = {
    alpha: { type: 'album', title: 'Альфа', year: '2026', cover: 'a.jpg', audioPath: 'a/', lyricsPath: 'l/', tracks: [track('alpha', 'one', 1, 'Первый'), track('alpha', 'two', 2, 'Второй'), track('alpha', 'three', 3, 'Яна и ночь')] },
    beta: { type: 'single', title: 'Бета', year: '2026', cover: 'b.jpg', audioPath: 'b/', lyricsPath: 'l/', tracks: [track('beta', 'solo', 1, 'Соло')] },
    soon: { type: 'single', title: 'Скоро', year: '2027', cover: 's.jpg', audioPath: 's/', lyricsPath: 'l/', upcoming: true, tracks: [track('soon', 'later', 1, 'Скоро-трек')] }
} as unknown as Releases

describe('топ-4: места для показа', () => {
    it('четыре места по position; пустые остаются пустыми', () => {
        expect(top4Slots([], RELEASES)).toEqual([null, null, null, null])
        expect(top4Slots(null, RELEASES)).toEqual([null, null, null, null])
        expect(top4Slots([{ position: 1, track_id: 'beta/solo' }, { position: 2, track_id: 'alpha/one' }], RELEASES)).toEqual(['beta/solo', 'alpha/one', null, null])
        expect(TOP4_SIZE).toBe(4)
    })

    it('трек пропал из каталога — место пустое, остальные не сдвигаются, ошибки нет', () => {
        const rows = [
            { position: 1, track_id: 'alpha/one' },
            { position: 2, track_id: 'gone/track' },
            { position: 3, track_id: 'alpha/two' },
            { position: 4, track_id: 'beta/solo' }
        ]
        expect(top4Slots(rows, RELEASES)).toEqual(['alpha/one', null, 'alpha/two', 'beta/solo'])
        // Трек вернулся в каталог — место снова занято, в базе ничего менять не нужно.
        const back = { ...RELEASES, gone: { ...RELEASES.beta, tracks: [track('gone', 'track', 1)] } } as Releases
        expect(top4Slots(rows, back)[1]).toBe('gone/track')
    })

    it('кривые строки из базы игнорируются', () => {
        const rows = [
            { position: 0, track_id: 'alpha/one' },
            { position: 5, track_id: 'alpha/one' },
            { position: 1.5, track_id: 'alpha/one' },
            { position: 2, track_id: 7 as unknown as string },
            null as never
        ]
        expect(top4Slots(rows, RELEASES)).toEqual([null, null, null, null])
    })
})

describe('топ-4: черновик редактора', () => {
    it('собирается по порядку position, не больше четырёх; пропавшие остаются (их можно убрать)', () => {
        expect(draftFromRows([{ position: 3, track_id: 'c/c' }, { position: 1, track_id: 'a/a' }, { position: 2, track_id: 'gone/b' }])).toEqual(['a/a', 'gone/b', 'c/c'])
        expect(draftFromRows(undefined)).toEqual([])
        expect(draftFromRows(Array.from({ length: 6 }, (_, i) => ({ position: i + 1, track_id: `x/t${i}` })))).toHaveLength(4)
    })

    it('добавление: до четырёх, без повторов', () => {
        let d: string[] = []
        for (const id of ['alpha/one', 'alpha/one', 'alpha/two', 'beta/solo', 'alpha/three', 'x/extra']) d = addToDraft(d, id)
        expect(d).toEqual(['alpha/one', 'alpha/two', 'beta/solo', 'alpha/three'])
        expect(canAdd(d, 'x/extra')).toBe(false)
        expect(canAdd(['alpha/one'], 'alpha/one')).toBe(false)
        expect(canAdd(['alpha/one'], 'alpha/two')).toBe(true)
    })

    it('перестановка и удаление не меняют исходный массив', () => {
        const d = ['a/a', 'b/b', 'c/c', 'd/d']
        expect(moveInDraft(d, 0, 2)).toEqual(['b/b', 'c/c', 'a/a', 'd/d'])
        expect(moveInDraft(d, 3, 0)).toEqual(['d/d', 'a/a', 'b/b', 'c/c'])
        expect(moveInDraft(d, 1, 1)).toEqual(d)
        expect(moveInDraft(d, -1, 2)).toEqual(d)
        expect(moveInDraft(d, 0, 4)).toEqual(d)
        expect(removeFromDraft(d, 1)).toEqual(['a/a', 'c/c', 'd/d'])
        expect(removeFromDraft(d, 9)).toEqual(d)
        expect(d).toEqual(['a/a', 'b/b', 'c/c', 'd/d'])
        expect(sameDraft(d, [...d])).toBe(true)
        expect(sameDraft(d, ['a/a', 'b/b'])).toBe(false)
        expect(sameDraft(['a/a', 'b/b'], ['b/b', 'a/a'])).toBe(false)
    })
})

describe('топ-4: поиск трека по каталогу', () => {
    it('находит по названию трека и релиза с начала слова; трек важнее релиза', () => {
        expect(searchTracks(RELEASES, 'яна').map((h) => h.trackId)).toEqual(['alpha/three'])
        expect(searchTracks(RELEASES, 'ян').map((h) => h.trackId)).toEqual(['alpha/three'])
        expect(searchTracks(RELEASES, 'ночь')).toHaveLength(1)
        // По названию релиза — все его треки.
        expect(searchTracks(RELEASES, 'альфа').map((h) => h.trackId)).toEqual(['alpha/one', 'alpha/two', 'alpha/three'])
        const hit = searchTracks(RELEASES, 'соло')[0]
        expect(hit).toEqual({ trackId: 'beta/solo', title: 'Соло', releaseTitle: 'Бета', cover: 'b.jpg' })
    })

    it('«не с начала слова», пустой запрос и релизы «скоро» ничего не дают', () => {
        expect(searchTracks(RELEASES, 'ана')).toEqual([])
        expect(searchTracks(RELEASES, '')).toEqual([])
        expect(searchTracks(RELEASES, '   ')).toEqual([])
        expect(searchTracks(RELEASES, 'скоро')).toEqual([])
    })

    it('предел выдачи и регистр/«ё» не мешают', () => {
        expect(searchTracks(RELEASES, 'альфа', 2)).toHaveLength(2)
        expect(searchTracks(RELEASES, 'ПЕРВЫЙ').map((h) => h.trackId)).toEqual(['alpha/one'])
        expect(searchTracks(RELEASES, 'второи')).toEqual([])
    })
})
