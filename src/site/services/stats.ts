import { ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, releases } from '@/config'
import { parseTrackKey } from '@/utils/lyrics'
import type { ChartTrack } from '@/types'

/**
 * Счётчики прослушиваний и чарт (таблица play_counts в Supabase).
 *
 * Ключ трека в статистике — «<releaseId>-<индекс трека>» (в самых старых
 * записях «<releaseId>--<номер с 1>»), см. src/utils/trackIds.ts.
 */

// Supabase-клиент нужен только чарту и счётчикам, а весит заметно больше
// остального кода. Поэтому он не входит в основной бандл: чанк подтягивается
// при первом реальном обращении к статистике.
let client: SupabaseClient | null = null
let clientPromise: Promise<SupabaseClient | null> | null = null
let clientUnavailable = false

// Промис кэшируется, чтобы параллельные вызовы не создали два клиента;
// после неудачи повторные попытки не делаются — иначе таймер плеера
// дёргал бы загрузку чанка на каждом тике.
export function getDb(): Promise<SupabaseClient | null> {
    if (client) return Promise.resolve(client)
    if (clientUnavailable || !SUPABASE_URL || !SUPABASE_ANON_KEY) return Promise.resolve(null)
    if (!clientPromise) {
        clientPromise = import('@supabase/supabase-js')
            .then(({ createClient }) => {
                client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
                return client
            })
            .catch((e) => {
                console.warn('Supabase init failed:', e)
                clientUnavailable = true
                return null
            })
    }
    return clientPromise
}

/**
 * Растёт после каждого засчитанного прослушивания: открытые экраны (чарт,
 * счётчики на странице релиза) по нему перечитывают цифры.
 */
export const statsVersion = ref(0)
/** Релиз, которому засчитали последнее прослушивание. */
export let lastChangedReleaseId: string | null = null

export function markStatsChanged(releaseId: string): void {
    delete releasePlaysCache[releaseId]
    lastChangedReleaseId = releaseId
    statsVersion.value += 1
}

interface ReleasePlays {
    total: number
    byTrack: Record<number, number>
}

// Один запрос на релиз отдаёт и сумму по релизу, и разбивку по трекам,
// поэтому странице трека не нужен отдельный поход в базу.
const releasePlaysCache: Record<string, ReleasePlays> = {}

export async function loadReleasePlays(releaseId: string): Promise<ReleasePlays> {
    if (!releases[releaseId]) return { total: 0, byTrack: {} }
    if (releasePlaysCache[releaseId]) return releasePlaysCache[releaseId]
    const db = await getDb()
    if (!db) return { total: 0, byTrack: {} }
    try {
        // Ключи трека начинаются с releaseId, поэтому префиксный фильтр
        // отдаёт только нужные строки вместо всей таблицы.
        const { data, error } = await db
            .from('play_counts')
            .select('track_key, plays')
            .like('track_key', `${releaseId}-%`)
        if (error) throw error
        let total = 0
        const byTrack: Record<number, number> = {}
        ;(data || []).forEach((item: { track_key: string; plays: number }) => {
            const parsed = parseTrackKey(item.track_key)
            if (!parsed || parsed.releaseId !== releaseId) return
            const plays = Number(item.plays) || 0
            total += plays
            // Старый и новый формат ключа могут указывать на один трек,
            // поэтому складываем, а не перезаписываем.
            byTrack[parsed.trackIndex] = (byTrack[parsed.trackIndex] || 0) + plays
        })
        releasePlaysCache[releaseId] = { total, byTrack }
        return releasePlaysCache[releaseId]
    } catch (e) {
        console.warn('Release play count load failed:', e)
        return { total: 0, byTrack: {} }
    }
}

export async function getReleasePlayCount(releaseId: string): Promise<number> {
    return (await loadReleasePlays(releaseId)).total
}

export async function getTrackPlayCount(releaseId: string, trackIndex: number): Promise<number> {
    return (await loadReleasePlays(releaseId)).byTrack[trackIndex] || 0
}

/**
 * Засчитывает прослушивание трека. true — засчитано (кэш релиза сброшен),
 * false — базы нет или запрос не прошёл.
 */
export async function incrementPlayCount(releaseId: string, trackIndex: number): Promise<boolean> {
    const release = releases[releaseId]
    // Защита от мусорных ключей: «release--1» база прочитала бы как
    // старый 1-based формат и засчитала бы первому треку релиза.
    if (!release || !Number.isInteger(trackIndex) || trackIndex < 0 || !release.tracks[trackIndex]) return false
    try {
        const db = await getDb()
        if (!db) return false
        const { error } = await db.rpc('increment_play_count', { track_key_input: `${releaseId}-${trackIndex}` })
        if (error) throw error
        markStatsChanged(releaseId)
        return true
    } catch (e) {
        console.warn('Play count update failed:', e)
        return false
    }
}

export type ChartResult = { ok: true; tracks: ChartTrack[] } | { ok: false; reason: 'no-db' | 'error' }

/** Топ-50 треков по прослушиваниям. */
export async function loadChart(): Promise<ChartResult> {
    const db = await getDb()
    if (!db) return { ok: false, reason: 'no-db' }
    const { data, error } = await db
        .from('play_counts').select('track_key, plays')
        .order('plays', { ascending: false }).limit(50)
    if (error) return { ok: false, reason: 'error' }
    const tracksMap = new Map<string, ChartTrack>()
    ;(data || []).forEach((item: { track_key: string; plays: number }) => {
        const parsed = parseTrackKey(item.track_key)
        if (!parsed) return
        const release = releases[parsed.releaseId]
        const track = release && release.tracks[parsed.trackIndex]
        if (!track) return
        const key = `${parsed.releaseId}::${parsed.trackIndex}`
        const plays = Number(item.plays) || 0
        const existing = tracksMap.get(key)
        if (existing) existing.plays += plays
        else tracksMap.set(key, { title: track.title, cover: release.cover, plays, releaseId: parsed.releaseId, trackIndex: parsed.trackIndex })
    })
    const tracks = Array.from(tracksMap.values()).sort((a, b) => b.plays - a.plays).slice(0, 50)
    return { ok: true, tracks }
}
