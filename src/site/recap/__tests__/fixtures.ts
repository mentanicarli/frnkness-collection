import type { Releases } from '@/types'
import { catalogFromReleases } from '../catalog'
import type { Recap } from '../types'

const track = (rel: string, slug: string, num: number, title: string) => ({ id: `${rel}/${slug}`, num, title, file: `${slug}.mp3`, lyricsFile: `${slug}.txt` })

// Синтетический каталог: только для этих тестов (живой каталог не читаем).
export const RELEASES = {
    alpha: { type: 'album', title: 'Альфа', year: '2025', cover: 'images/alpha.jpg', audioPath: 'a/', lyricsPath: 'l/', tracks: [track('alpha', 'one', 1, 'Первый'), track('alpha', 'two', 2, 'Второй')] },
    beta: { type: 'single', title: 'Бета с очень длинным названием релиза которое не помещается в одну строку на картинке', year: '2025', cover: 'images/beta.jpg', audioPath: 'b/', lyricsPath: 'l/', tracks: [track('beta', 'solo', 1, 'Соло')] }
} as unknown as Releases

export const CATALOG = catalogFromReleases(RELEASES)

export function makeRecap(patch: Partial<Recap> = {}): Recap {
    return {
        year: 2025,
        user: { id: 'u1', nick: 'Яна', avatar: 'initials:2' },
        period: { from: '2025-03-10T09:00:00Z', to: '2025-12-31T20:59:59Z' },
        final: true,
        sparse: false,
        plays: 120,
        minutes: 640,
        top_tracks: [
            { track_key: 'alpha-0', plays: 40, minutes: 200 },
            { track_key: 'beta-0', plays: 30, minutes: 150 },
            { track_key: 'alpha-1', plays: 20, minutes: 90 },
            { track_key: 'gone-3', plays: 10, minutes: 40 }
        ],
        top_release: { release_id: 'alpha', plays: 60, minutes: 290 },
        first_track: { track_key: 'beta-0', at: '2025-03-11T05:00:00Z' },
        best_day: { date: '2025-05-05', minutes: 95 },
        day_parts: { morning: 5, day: 10, evening: 80, night: 25 },
        rooms: { count: 3, with: [{ user_id: 'u2', nick: 'Второй', avatar: 'initials:0', rooms: 3, minutes: 50 }] },
        favorites_added: 7,
        ...patch
    }
}
