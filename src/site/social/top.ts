import type { Releases } from '@/types'
import { statsKeyToTrackId } from '@/utils/trackIds'
import type { TopRow } from './api'

/**
 * «Мой топ»: база отдаёт число прослушиваний по ключам статистики
 * («<releaseId>-<индекс>», как общий счётчик), сайт переводит их в id
 * треков. Треки, которых нет в каталоге, отбрасываются; ключи одного
 * трека (старый и новый формат) складываются.
 */
export interface TopItem {
    trackId: string
    plays: number
}

export const TOP_LIMIT = 10

export function buildTop(rows: readonly TopRow[], releases: Releases, limit = TOP_LIMIT): TopItem[] {
    const plays = new Map<string, number>()
    for (const row of rows) {
        const id = statsKeyToTrackId(releases, row.track_key)
        const n = Number(row.plays)
        if (!id || !Number.isFinite(n) || n <= 0) continue
        plays.set(id, (plays.get(id) ?? 0) + n)
    }
    return [...plays.entries()]
        .map(([trackId, n]) => ({ trackId, plays: n }))
        .sort((a, b) => b.plays - a.plays || a.trackId.localeCompare(b.trackId))
        .slice(0, limit)
}

export type TopPeriod = 7 | 30 | null

export const TOP_PERIODS: { days: TopPeriod; label: string }[] = [
    { days: 7, label: '7 дней' },
    { days: 30, label: '30 дней' },
    { days: null, label: 'Всё время' }
]
