import { describe, it, expect } from 'vitest'
import { parseLRC, parseTrackKey, getAllTrackRefs, isSameTrackRef, pickRandomTrackRef } from '../lyrics'
import type { Releases } from '@/types'

describe('parseLRC', () => {
    it('parses standard LRC lines', () => {
        const input = '[00:12.34]Hello world\n[01:05.00]Second line'
        const result = parseLRC(input)
        expect(result).toHaveLength(2)
        expect(result[0].time).toBeCloseTo(12.34)
        expect(result[0].text).toBe('Hello world')
        expect(result[1].time).toBeCloseTo(65)
    })

    it('ignores lines without timestamps', () => {
        const input = 'Plain text line\n[00:01.00]Timed line'
        const result = parseLRC(input)
        expect(result).toHaveLength(1)
        expect(result[0].text).toBe('Timed line')
    })

    it('sorts by time', () => {
        const input = '[00:30.00]Later\n[00:10.00]Earlier'
        const result = parseLRC(input)
        expect(result[0].text).toBe('Earlier')
        expect(result[1].text).toBe('Later')
    })

    it('returns empty array for empty input', () => {
        expect(parseLRC('')).toEqual([])
    })
})

describe('parseTrackKey', () => {
    it('parses modern format (0-based)', () => {
        const result = parseTrackKey('my-release-2')
        expect(result).toEqual({ releaseId: 'my-release', trackIndex: 2 })
    })

    it('parses legacy format (1-based, double dash)', () => {
        const result = parseTrackKey('my-release--3')
        expect(result).toEqual({ releaseId: 'my-release', trackIndex: 2 })
    })

    it('returns null for invalid input', () => {
        expect(parseTrackKey('')).toBeNull()
        expect(parseTrackKey(null as any)).toBeNull()
    })
})

describe('getAllTrackRefs', () => {
    const releases: Releases = {
        'album-1': {
            type: 'album', title: 'Album 1', year: '2025',
            cover: '', audioPath: '', lyricsPath: '',
            tracks: [
                { num: 1, title: 'Track A', file: 'a.mp3', lyricsFile: 'a.txt' },
                { num: 2, title: 'Track B', file: 'b.mp3', lyricsFile: 'b.txt' }
            ]
        }
    }

    it('returns all track refs', () => {
        const refs = getAllTrackRefs(releases)
        expect(refs).toHaveLength(2)
        expect(refs[0]).toEqual({ releaseId: 'album-1', trackIndex: 0 })
        expect(refs[1]).toEqual({ releaseId: 'album-1', trackIndex: 1 })
    })
})

describe('isSameTrackRef', () => {
    it('returns true for equal refs', () => {
        expect(isSameTrackRef({ releaseId: 'a', trackIndex: 0 }, { releaseId: 'a', trackIndex: 0 })).toBe(true)
    })

    it('returns false for different refs', () => {
        expect(isSameTrackRef({ releaseId: 'a', trackIndex: 0 }, { releaseId: 'a', trackIndex: 1 })).toBe(false)
        expect(isSameTrackRef({ releaseId: 'a', trackIndex: 0 }, { releaseId: 'b', trackIndex: 0 })).toBe(false)
    })

    it('handles null inputs', () => {
        expect(isSameTrackRef(null, { releaseId: 'a', trackIndex: 0 })).toBe(false)
        expect(isSameTrackRef(null, null)).toBe(false)
    })
})

describe('pickRandomTrackRef', () => {
    const releases: Releases = {
        'r1': {
            type: 'single', title: 'Single', year: '2025',
            cover: '', audioPath: '', lyricsPath: '',
            tracks: [{ num: 1, title: 'T', file: 't.mp3', lyricsFile: 't.txt' }]
        }
    }

    it('returns a track ref', () => {
        const ref = pickRandomTrackRef(releases)
        expect(ref).toEqual({ releaseId: 'r1', trackIndex: 0 })
    })

    it('returns null when only current track exists and is excluded', () => {
        const ref = pickRandomTrackRef(releases, { releaseId: 'r1', trackIndex: 0 })
        expect(ref).toBeNull()
    })
})
