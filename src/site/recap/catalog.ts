import type { Releases } from '@/types'
import { parseTrackKey } from '@/utils/lyrics'
import type { RecapCatalog } from './types'

/** Каталог итогов поверх реестра релизов (сайт — releases.json, админка — репозиторий). */
export function catalogFromReleases(releases: Releases): RecapCatalog {
    return {
        track(key) {
            const ref = parseTrackKey(key)
            const release = ref && releases[ref.releaseId]
            const track = release?.tracks[ref!.trackIndex]
            if (!release || !track) return null
            return { title: track.title, releaseId: ref!.releaseId, releaseTitle: release.title, cover: release.cover || null }
        },
        release(id) {
            const release = releases[id]
            return release ? { title: release.title, cover: release.cover || null } : null
        }
    }
}
