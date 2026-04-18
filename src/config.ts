import type { Releases } from '@/types'

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const SHOW_NEW_RELEASE_PROMO = import.meta.env.VITE_SHOW_NEW_RELEASE_PROMO === 'true'
export const NEW_RELEASE_PROMO_ID = import.meta.env.VITE_NEW_RELEASE_PROMO_ID || 'p-team'

export const releases: Releases = {
    'most-venture-poopsicks': {
        type: 'album',
        title: 'Most Venture Poopsicks / Last Over V',
        year: '2025',
        cover: 'images/album1-cover.jpg',
        audioPath: 'audio/album1/',
        lyricsPath: 'lyrics/album1/',
        lyricsBookPath: 'lyrics-books/album1-lyrics.pdf',
        tracks: [
            { num: 1, title: 'POOPSICKS', file: 'poopsicks.mp3', lyricsFile: '01-poopsicks.txt' },
            { num: 2, title: 'BACK TO POOPSICKS 2', file: 'back-to-poopsicks-2.mp3', lyricsFile: '02-back-to-poopsicks-2.txt' },
            { num: 3, title: 'Macan-Walker', file: 'macan-walker.mp3', lyricsFile: '03-macan-walker.txt' },
            { num: 4, title: 'BORDOVIY SALON', file: 'bordoviy-salon.mp3', lyricsFile: '04-bordoviy-salon.txt' },
            {
                num: 5,
                title: 'Classica Ryazanki / Lost Memory (ft. twizzyRRich)',
                file: 'classica-ryazanki.mp3',
                lyricsFile: '05-classica-ryazanki.txt'
            }
        ]
    },
    disinvolto: {
        type: 'single',
        title: 'Disinvolto: Danilovsky',
        year: '2025',
        cover: 'images/single1-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        lyricsBookPath: 'lyrics-books/disinvolto-lyrics.pdf',
        videoUrl: 'https://www.youtube.com/embed/vI_8FLsAn50',
        tracks: [{ num: 1, title: 'Disinvolto: Danilovsky', file: 'disinvolto.mp3', lyricsFile: 'disinvolto.txt' }]
    },
    'six-senses-pupsiks': {
        type: 'album',
        title: 'Six Senses of Pupsiks',
        year: '2025',
        cover: 'images/album2-cover.jpg',
        audioPath: 'audio/album2/',
        lyricsPath: 'lyrics/album2/',
        lyricsBookPath: 'lyrics-books/album2-lyrics.pdf',
        tracks: [
            { num: 1, title: "still ballin'", file: 'still-ballin.mp3', lyricsFile: '01-still-ballin.txt' },
            { num: 2, title: "Hulk's Reflections", file: 'hulks-reflections.mp3', lyricsFile: '02-hulks-reflections.txt' },
            { num: 3, title: 'World Most Monkey', file: 'world-most-monkey.mp3', lyricsFile: '03-world-most-monkey.txt' },
            { num: 4, title: 'Young, Fresh and Tatarin', file: 'young-fresh-tatarin.mp3', lyricsFile: '04-young-fresh-tatarin.txt' },
            { num: 5, title: 'ПАПА', file: 'papa.mp3', lyricsFile: '05-papa.txt' },
            { num: 6, title: 'monologue about the daily routine', file: 'monologue.mp3', lyricsFile: '06-monologue.txt' }
        ]
    },
    nypupsoids: {
        type: 'single',
        title: 'nypupsoids',
        year: '2025',
        cover: 'images/single2-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        tracks: [{ num: 1, title: 'nypupsoids', file: 'nypupsoids.mp3', lyricsFile: 'nypupsoids.txt' }]
    },
    thermoland: {
        type: 'single',
        title: 'thermoland',
        year: '2026',
        cover: 'images/single3-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        tracks: [{ num: 1, title: 'thermoland', file: 'thermoland.mp3', lyricsFile: 'thermoland.txt' }]
    },
    boxik: {
        type: 'single',
        title: 'какой тебе боксик?',
        year: '2026',
        cover: 'images/single4-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        tracks: [{ num: 1, title: 'какой тебе боксик?', file: 'boxik.mp3', lyricsFile: 'boxik.txt' }]
    },
    'p-team': {
        type: 'single',
        title: 'P-Team',
        year: '2026',
        cover: 'images/single5-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        tracks: [{ num: 1, title: 'P-Team', file: 'p-team.mp3', lyricsFile: 'p-team.txt' }]
    }
}
