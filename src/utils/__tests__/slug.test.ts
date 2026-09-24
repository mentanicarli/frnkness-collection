import { describe, it, expect } from 'vitest'
import { getTrackSlug, findTrackRefBySlug, buildTrackHash } from '../slug'
import type { Releases, Track } from '@/types'

const track = (num: number, title: string, lyricsFile: string): Track => ({
    num,
    title,
    file: `${lyricsFile.replace(/\.txt$/, '')}.mp3`,
    lyricsFile
})

const releases: Releases = {
    'zlaya-nostalgia': {
        type: 'album',
        title: 'Злая Ностальгия',
        year: '2026',
        cover: 'images/album4-cover.jpg',
        audioPath: 'audio/album4/',
        lyricsPath: 'lyrics/album4/',
        tracks: [
            track(1, 'Маканочки', '01-makanochki.txt'),
            track(2, 'ГОУТЫ', '07-gouty.txt')
        ]
    },
    faaa: {
        type: 'single',
        title: 'FAAA',
        year: '2026',
        cover: 'images/single6-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        tracks: [track(1, 'FAAA', 'faaa.txt')]
    }
}

describe('getTrackSlug', () => {
    it('strips the leading track number', () => {
        expect(getTrackSlug(track(1, 'Маканочки', '01-makanochki.txt'))).toBe('makanochki')
    })

    it('keeps names that have no number prefix', () => {
        expect(getTrackSlug(track(1, 'FAAA', 'faaa.txt'))).toBe('faaa')
    })

    it('keeps digits that are part of the title', () => {
        expect(getTrackSlug(track(7, '22_00', '07-22-00.txt'))).toBe('22-00')
    })

    it('falls back to the track number when there is no lyrics file', () => {
        expect(getTrackSlug({ num: 3, title: 'x', file: 'x.mp3', lyricsFile: '' })).toBe('3')
    })
})

describe('findTrackRefBySlug', () => {
    it('finds a track inside a release', () => {
        expect(findTrackRefBySlug(releases, 'zlaya-nostalgia', 'gouty')).toEqual({
            releaseId: 'zlaya-nostalgia',
            trackIndex: 1
        })
    })

    it('returns null for an unknown slug', () => {
        expect(findTrackRefBySlug(releases, 'zlaya-nostalgia', 'нет-такого')).toBeNull()
    })

    it('returns null for an unknown release', () => {
        expect(findTrackRefBySlug(releases, 'no-such-release', 'makanochki')).toBeNull()
    })
})

describe('buildTrackHash', () => {
    it('builds a hash route for a track', () => {
        expect(buildTrackHash('zlaya-nostalgia', releases['zlaya-nostalgia'].tracks[0]))
            .toBe('#/track/zlaya-nostalgia/makanochki')
    })
})

describe('slug uniqueness', () => {
    it('produces a unique slug for every track of a release', () => {
        for (const [releaseId, release] of Object.entries(releases)) {
            const slugs = release.tracks.map(getTrackSlug)
            expect(new Set(slugs).size, `дубли слагов в ${releaseId}`).toBe(slugs.length)
        }
    })
})
