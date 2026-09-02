import type { Releases } from '@/types'

// Центральный конфиг приложения:
// env-переменные, feature flags и реестр релизов.
const DEFAULT_SUPABASE_URL = 'https://momcakikuivtvxkmgjhx.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_ept_0dlTFn9cWLM0wIK2JA_a7xNSx-I'

// Fallback-значения нужны для локального запуска, если env не задан.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY

// Промо-блок на главной: показывать ли его и какой релиз в нём.
// Значения по умолчанию берутся из кода, env-переменные позволяют
// переопределить их на сборке без правки исходников.
export const SHOW_NEW_RELEASE_PROMO = import.meta.env.VITE_SHOW_NEW_RELEASE_PROMO !== 'false'
export const PROMO_RELEASE_ID = import.meta.env.VITE_NEW_RELEASE_PROMO_ID || 'zlaya-nostalgia'

// Единый источник данных по дискографии, трекам и путям к медиа/текстам.
export const releases: Releases = {
    'most-venture-poopsicks': {
        type: 'album',
        title: 'Most Venture Poopsicks / Last Over V',
        year: '2025',
        releaseDate: '14 ноября 2025',
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
        releaseDate: '20 ноября 2025',
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
        releaseDate: '30 ноября 2025',
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
        releaseDate: '31 декабря 2025',
        cover: 'images/single2-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        tracks: [{ num: 1, title: 'nypupsoids', file: 'nypupsoids.mp3', lyricsFile: 'nypupsoids.txt' }]
    },
    thermoland: {
        type: 'single',
        title: 'thermoland',
        year: '2026',
        releaseDate: '3 февраля 2026',
        cover: 'images/single3-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        tracks: [{ num: 1, title: 'thermoland', file: 'thermoland.mp3', lyricsFile: 'thermoland.txt' }]
    },
    boxik: {
        type: 'single',
        title: 'какой тебе боксик?',
        year: '2026',
        releaseDate: '11 апреля 2026',
        cover: 'images/single4-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        tracks: [{ num: 1, title: 'какой тебе боксик?', file: 'boxik.mp3', lyricsFile: 'boxik.txt' }]
    },
    'p-team': {
        type: 'single',
        title: 'P-Team',
        year: '2026',
        releaseDate: '13 апреля 2026',
        cover: 'images/single5-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        tracks: [{ num: 1, title: 'P-Team', file: 'p-team.mp3', lyricsFile: 'p-team.txt' }]
    },
    faaa: {
        type: 'single',
        title: 'FAAA',
        year: '2026',
        releaseDate: '24 апреля 2026',
        cover: 'images/single6-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        tracks: [{ num: 1, title: 'FAAA', file: 'faaa.mp3', lyricsFile: 'faaa.txt' }]
    },
    'born-to-be-deluxe': {
        type: 'album',
        title: 'Born to be Deluxe',
        year: '2026',
        releaseDate: '21 мая 2026',
        cover: 'images/album3-cover.jpg',
        audioPath: 'audio/album 3/',
        lyricsPath: 'lyrics/album3/',
        tracks: [
            { num: 1, title: 'ZAL', file: 'ZAL.mp3', lyricsFile: '01-zal.txt' },
            { num: 2, title: 'Última Historia', file: 'Última historia.mp3', lyricsFile: '02-ultima-historia.txt' },
            { num: 3, title: 'COMЁ N TEAM', file: 'come n team.mp3', lyricsFile: '03-come-n-team.txt' },
            { num: 4, title: 'nikanora', file: 'NIKANORA.mp3', lyricsFile: '04-nikanora.txt' },
            { num: 5, title: 'damurr', file: 'damurr.mp3', lyricsFile: '05-damurr.txt' },
            { num: 6, title: 'Otiva', file: 'Otiva.mp3', lyricsFile: '06-otiva.txt' },
            { num: 7, title: '22_00', file: '2200.mp3', lyricsFile: '07-22-00.txt' },
            { num: 8, title: 'Международный Соннетклауд', file: 'Международный Соннет Клауд.mp3', lyricsFile: '08-mezhdunarodny.txt' },
            { num: 9, title: 'Борода, потом Марат', file: 'Boroda,marat.mp3', lyricsFile: '09-boroda-potom-marat.txt' }
        ]
    },
    'zlaya-nostalgia': {
        type: 'album',
        title: 'Злая Ностальгия',
        year: '2026',
        releaseDate: '26 августа 2026',
        cover: 'images/album4-cover.jpg',
        audioPath: 'audio/album4/',
        lyricsPath: 'lyrics/album4/',
        tracks: [
            { num: 1, title: 'Маканочки', file: 'Маканочки.mp3', lyricsFile: '01-makanochki.txt' },
            { num: 2, title: 'Общество Могнутых Аналитиков', file: 'Общество Могнутых Аналитиков.mp3', lyricsFile: '02-obshchestvo-mognutyh-analitikov.txt' },
            { num: 3, title: 'ПУПСАСТИЯ', file: 'Пупсастия.mp3', lyricsFile: '03-pupsastiya.txt' },
            { num: 4, title: 'Случайно взяли топ один', file: 'Случайно взяли топ 1.mp3', lyricsFile: '04-sluchayno-vzyali-top-odin.txt' },
            { num: 5, title: 'Где же наш первый курс', file: 'Где же наш первый курс.mp3', lyricsFile: '05-gde-zhe-nash-perviy-kurs.txt' },
            { num: 6, title: 'Бильярд', file: 'Бильярд.mp3', lyricsFile: '06-bilyard.txt' },
            { num: 7, title: 'ГОУТЫ', file: 'ГОУТЫ.mp3', lyricsFile: '07-gouty.txt' }
        ]
    }
}
