import { releases } from '@/config'
import { normalizeForSearch } from '@/utils/search'
import { trackInfo, type TrackInfo } from './tracks'

/**
 * Поиск треков по названию трека или релиза — для выбора из каталога
 * (добавить в плейлист, включить в комнате). Без запроса — весь каталог
 * в порядке релизов. Каждый трек — один раз.
 */
export function searchTracks(query: string, limit = Infinity): TrackInfo[] {
    const q = normalizeForSearch(query)
    const out: TrackInfo[] = []
    for (const release of Object.values(releases)) {
        const releaseHit = q !== '' && normalizeForSearch(release.title).includes(q)
        for (const track of release.tracks) {
            if (q && !releaseHit && !normalizeForSearch(track.title).includes(q)) continue
            out.push(trackInfo(track.id))
            if (out.length >= limit) return out
        }
    }
    return out
}
