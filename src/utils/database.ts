import type { Release, ChartTrack, PlayCountItem } from '@/types'
import { parseTrackKey } from './lyrics'

/**
 * Возвращает суммарные прослушивания альбома.
 * Результат кэшируется по releaseId.
 */
export async function getReleasePlayCount(
    releaseId: string,
    release: Release,
    dbClient: any,
    cache: Record<string, number>
): Promise<number> {
    if (release.type !== 'album') return 0
    if (cache[releaseId] !== undefined) return cache[releaseId]
    if (!dbClient) return 0

    try {
        const { data, error } = await dbClient.from('play_counts').select('track_key, plays')
        if (error) throw error

        let total = 0
            ; (data || []).forEach((item: PlayCountItem) => {
                const parsed = parseTrackKey(item.track_key)
                if (!parsed || parsed.releaseId !== releaseId) return
                total += Number(item.plays) || 0
            })

        cache[releaseId] = total
        return total
    } catch (e) {
        console.warn('Release play count load failed:', e)
        return 0
    }
}

/**
 * Инкрементирует счетчик прослушиваний трека через RPC Supabase.
 */
export async function incrementPlayCount(
    trackKey: string,
    _releaseId: string,
    dbClient: any,
    onSuccess?: () => void
): Promise<boolean> {
    if (!dbClient) return false

    try {
        const { error } = await dbClient.rpc('increment_play_count', {
            track_key_input: trackKey
        })

        if (error) throw error
        onSuccess?.()
        return true
    } catch (e) {
        console.warn('Play count update failed:', e)
        return false
    }
}

/**
 * Загружает чарт треков и агрегирует дубликаты ключей.
 */
export async function getChartData(
    releases: Record<string, Release>,
    dbClient: any
): Promise<ChartTrack[]> {
    if (!dbClient) return []

    try {
        const { data, error } = await dbClient
            .from('play_counts')
            .select('track_key, plays')
            .order('plays', { ascending: false })
            .limit(50)

        if (error) throw error

        const tracksMap = new Map<string, ChartTrack>()

            ; (data || []).forEach((item: any) => {
                const parsed = parseTrackKey(item.track_key)
                if (!parsed) return

                const release = releases[parsed.releaseId]
                const track = release?.tracks[parsed.trackIndex]
                if (!track) return

                const aggregateKey = `${parsed.releaseId}::${parsed.trackIndex}`
                const existing = tracksMap.get(aggregateKey)
                const plays = Number(item.plays) || 0

                if (existing) {
                    existing.plays += plays
                } else {
                    tracksMap.set(aggregateKey, {
                        title: track.title,
                        cover: release.cover,
                        plays,
                        releaseId: parsed.releaseId,
                        trackIndex: parsed.trackIndex
                    })
                }
            })

        return Array.from(tracksMap.values())
            .sort((a, b) => b.plays - a.plays)
            .slice(0, 50)
    } catch (e) {
        console.warn('Chart data load failed:', e)
        return []
    }
}
