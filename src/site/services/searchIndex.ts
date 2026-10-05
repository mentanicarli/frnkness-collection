import type { Release, Releases, Track } from '@/types'
import { parseLRC } from '@/utils/lyrics'
import { createMatcher, normalizeForSearch } from '@/utils/search'
import { fetchTrackLrc, fetchTrackTxt, lrcKey, txtKey } from './lyricsFiles'

/**
 * Поиск по каталогу: названия релизов и треков сразу, строки текстов — после
 * загрузки индекса (один собранный при сборке lyrics-index.json, а если его
 * нет — обход файлов по одному).
 */

export type SearchResultType = 'release' | 'track' | 'lyric'

export interface SearchHit {
    type: SearchResultType
    releaseId: string
    title: string
    trackTitle?: string
    trackIndex: number
    line: string
    /** Время строки в .lrc; -1 — строка из .txt (трек без караоке). */
    time: number
    rank: number
}

interface IndexEntry {
    releaseId: string
    releaseTitle: string
    trackIndex: number
    trackTitle: string
    line: string
    normalized: string
    time: number
}

const LYRICS_INDEX_URL = `${import.meta.env.BASE_URL}lyrics-index.json`

let lyricsIndex: IndexEntry[] = []
let lyricsIndexReady = false
let lyricsIndexPromise: Promise<void> | null = null
const searchCache = new Map<string, SearchHit[]>()

export function isLyricsIndexReady(): boolean {
    return lyricsIndexReady
}

export function isLyricsIndexLoading(): boolean {
    return lyricsIndexPromise !== null
}

function pushLine(entries: IndexEntry[], releaseId: string, release: Release, trackIndex: number, track: Track, line: string, time: number) {
    entries.push({
        releaseId, releaseTitle: release.title, trackIndex,
        trackTitle: track.title, line,
        normalized: normalizeForSearch(line), time
    })
}

// Строки из .lrc — со временем: клик по ним открывает караоке.
function collectLrcLines(entries: IndexEntry[], releaseId: string, release: Release, trackIndex: number, track: Track, lrc: string) {
    parseLRC(lrc).forEach((item) => {
        const clean = (item.text || '').trim()
        if (clean) pushLine(entries, releaseId, release, trackIndex, track, clean, item.time)
    })
}

// Строки из .txt (трек без караоке) — без времени: клик ведёт на страницу
// трека. Пустые строки и метки вида [Припев] не ищутся.
function collectTxtLines(entries: IndexEntry[], releaseId: string, release: Release, trackIndex: number, track: Track, txt: string) {
    String(txt).split('\n').forEach((raw) => {
        const clean = raw.trim()
        if (!clean || /^\[.+\]$/.test(clean)) return
        pushLine(entries, releaseId, release, trackIndex, track, clean, -1)
    })
}

// Индекс, собранный на этапе сборки: один файл вместо запроса на трек.
// Если его нет (или он битый), возвращаем null и уходим на обход по файлам.
async function fetchPrebuiltIndex(): Promise<Record<string, string> | null> {
    try {
        // no-cache: свежий индекс сразу после публикации из админки.
        const res = await fetch(LYRICS_INDEX_URL, { cache: 'no-cache' })
        if (!res.ok) return null
        const data = await res.json()
        return data && typeof data === 'object' && !Array.isArray(data) ? data : null
    } catch {
        return null
    }
}

export async function ensureLyricsIndex(releases: Releases): Promise<void> {
    if (lyricsIndexReady) return
    if (lyricsIndexPromise) return lyricsIndexPromise

    lyricsIndexPromise = (async () => {
        const entries: IndexEntry[] = []
        const prebuilt = await fetchPrebuiltIndex()
        const tasks: (() => Promise<void>)[] = []

        Object.entries(releases).forEach(([releaseId, release]) => {
            release.tracks.forEach((track, trackIndex) => {
                if (prebuilt) {
                    const lrc = prebuilt[lrcKey(release, track)]
                    const txt = prebuilt[txtKey(release, track)]
                    if (lrc) collectLrcLines(entries, releaseId, release, trackIndex, track, lrc)
                    else if (txt) collectTxtLines(entries, releaseId, release, trackIndex, track, txt)
                    return
                }
                tasks.push(async () => {
                    const lrc = await fetchTrackLrc(release, track)
                    if (lrc) {
                        collectLrcLines(entries, releaseId, release, trackIndex, track, lrc)
                        return
                    }
                    // Запасной путь без собранного индекса: .lrc, а если его нет — .txt.
                    const txt = await fetchTrackTxt(release, track)
                    if (txt) collectTxtLines(entries, releaseId, release, trackIndex, track, txt)
                })
            })
        })

        if (tasks.length) {
            const concurrency = 4
            let pointer = 0
            const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
                while (pointer < tasks.length) {
                    const taskIndex = pointer; pointer += 1
                    await tasks[taskIndex]()
                }
            })
            await Promise.all(workers)
        }

        lyricsIndex = entries
        lyricsIndexReady = true
        searchCache.clear()
    })()

    try { await lyricsIndexPromise } finally { lyricsIndexPromise = null }
}

// Совпадение только с начала слова (см. utils/search.ts). Сначала
// результаты, где слово совпало целиком, потом — по началу слова;
// внутри одного ранга порядок прежний: релизы, треки, строки.
export function searchCatalog(releases: Releases, query: string): SearchHit[] {
    const normalized = normalizeForSearch(query)
    if (!normalized) return []

    const cacheKey = `${normalized}|${lyricsIndexReady ? 1 : 0}|${lyricsIndex.length}`
    const cached = searchCache.get(cacheKey)
    if (cached) return cached

    const match = createMatcher(normalized)
    const results: SearchHit[] = []

    Object.entries(releases).forEach(([releaseId, release]) => {
        const releaseRank = match(release.title)
        if (releaseRank) {
            results.push({ type: 'release', releaseId, title: release.title, trackIndex: -1, line: '', time: -1, rank: releaseRank })
        }
        release.tracks.forEach((track, trackIndex) => {
            const trackRank = match(track.title)
            if (trackRank) {
                results.push({ type: 'track', releaseId, title: release.title, trackTitle: track.title, trackIndex, line: '', time: -1, rank: trackRank })
            }
        })
    })

    if (lyricsIndexReady) {
        const seen = new Set<string>()
        lyricsIndex.forEach((item) => {
            const rank = match(item.normalized)
            if (!rank) return
            const dedupeKey = `${item.releaseId}|${item.trackIndex}|${item.normalized}`
            if (seen.has(dedupeKey)) return
            seen.add(dedupeKey)
            results.push({ type: 'lyric', releaseId: item.releaseId, title: item.releaseTitle, trackTitle: item.trackTitle, trackIndex: item.trackIndex, line: item.line, time: item.time, rank })
        })
    }

    // sort стабильный: внутри ранга сохраняется исходный порядок.
    results.sort((a, b) => b.rank - a.rank)
    const output = results.slice(0, 28)
    searchCache.set(cacheKey, output)
    if (searchCache.size > 45) searchCache.delete(searchCache.keys().next().value!)
    return output
}
