import { describe, it, expect } from 'vitest'
import { findTrackById, statsKeyToTrackId, trackIdAt, trackIdToStatsKey } from '../trackIds'
import type { Releases, Track } from '@/types'

const track = (id: string, num: number, lyricsFile: string): Track => ({
    id,
    num,
    title: id,
    file: `${lyricsFile.replace(/\.txt$/, '')}.mp3`,
    lyricsFile
})

const releases: Releases = {
    'album-2': {
        type: 'album',
        title: 'Альбом',
        year: '2026',
        cover: 'images/album2-cover.jpg',
        audioPath: 'audio/album2/',
        lyricsPath: 'lyrics/album2/',
        tracks: [track('album-2/first', 1, '01-first.txt'), track('album-2/second', 2, '02-second.txt')]
    },
    single: {
        type: 'single',
        title: 'Сингл',
        year: '2026',
        cover: 'images/single1-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        // id не обязан совпадать с нынешним именем файла: он заморожен.
        tracks: [track('single/old-name', 1, 'new-name.txt')]
    }
}

describe('statsKeyToTrackId', () => {
    it('нынешний формат «<релиз>-<индекс с 0>»', () => {
        expect(statsKeyToTrackId(releases, 'album-2-0')).toBe('album-2/first')
        expect(statsKeyToTrackId(releases, 'album-2-1')).toBe('album-2/second')
        expect(statsKeyToTrackId(releases, 'single-0')).toBe('single/old-name')
    })

    it('старый формат «<релиз>--<номер с 1>»', () => {
        expect(statsKeyToTrackId(releases, 'album-2--1')).toBe('album-2/first')
        expect(statsKeyToTrackId(releases, 'album-2--2')).toBe('album-2/second')
    })

    it('неизвестный релиз, трек вне диапазона и мусор — null', () => {
        expect(statsKeyToTrackId(releases, 'nope-0')).toBeNull()
        expect(statsKeyToTrackId(releases, 'album-2-2')).toBeNull()
        expect(statsKeyToTrackId(releases, 'album-2--0')).toBeNull()
        expect(statsKeyToTrackId(releases, 'album-2')).toBeNull()
        expect(statsKeyToTrackId(releases, '')).toBeNull()
    })
})

describe('trackIdToStatsKey', () => {
    it('id → ключ в нынешнем формате', () => {
        expect(trackIdToStatsKey(releases, 'album-2/first')).toBe('album-2-0')
        expect(trackIdToStatsKey(releases, 'album-2/second')).toBe('album-2-1')
        expect(trackIdToStatsKey(releases, 'single/old-name')).toBe('single-0')
    })

    it('неизвестный id — null', () => {
        expect(trackIdToStatsKey(releases, 'album-2/third')).toBeNull()
        expect(trackIdToStatsKey(releases, 'nope/first')).toBeNull()
        expect(trackIdToStatsKey(releases, 'first')).toBeNull()
    })

    it('туда и обратно — тот же трек для каждого трека каталога', () => {
        for (const [releaseId, release] of Object.entries(releases)) {
            release.tracks.forEach((t, i) => {
                const key = trackIdToStatsKey(releases, t.id)!
                expect(key).toBe(`${releaseId}-${i}`)
                expect(statsKeyToTrackId(releases, key)).toBe(t.id)
            })
        }
    })
})

describe('findTrackById / trackIdAt', () => {
    it('находит релиз и индекс', () => {
        expect(findTrackById(releases, 'album-2/second')).toEqual({ releaseId: 'album-2', trackIndex: 1 })
        expect(trackIdAt(releases, 'album-2', 1)).toBe('album-2/second')
        expect(trackIdAt(releases, 'album-2', 5)).toBeNull()
    })
})
