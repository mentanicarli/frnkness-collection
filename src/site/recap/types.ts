/**
 * «Итоги года»: ответ базы (year_recap, supabase/migrations/20261010120000_year_recap.sql)
 * и каталог, по которому ключи треков превращаются в названия и обложки.
 */

export interface RecapTrackRow {
    /** Ключ статистики «<releaseId>-<индекс трека>». */
    track_key: string
    plays: number
    minutes: number
}

export interface RecapCompanion {
    user_id: string
    nick: string
    avatar: string
    rooms: number
    minutes: number
}

export type DayPartId = 'morning' | 'day' | 'evening' | 'night'

export interface Recap {
    year: number
    user: { id: string; nick: string; avatar: string } | null
    period: { from: string; to: string }
    /** Год закончился: итоги зафиксированы и больше не меняются. */
    final: boolean
    /** Меньше 10 прослушиваний. */
    sparse: boolean
    plays: number
    minutes: number
    top_tracks: RecapTrackRow[]
    top_release: { release_id: string; plays: number; minutes: number } | null
    first_track: { track_key: string; at: string } | null
    best_day: { date: string; minutes: number } | null
    day_parts: Record<DayPartId, number>
    rooms: { count: number; with: RecapCompanion[] }
    favorites_added: number
}

export interface RecapState {
    /** Самый свежий открытый год. */
    year: number
    years: number[]
}

export interface CatalogTrack {
    title: string
    releaseId: string
    releaseTitle: string
    cover: string | null
}

export interface CatalogRelease {
    title: string
    cover: string | null
}

/** Что нужно знать о каталоге: сайт и админка берут его из своих реестров. */
export interface RecapCatalog {
    track(trackKey: string): CatalogTrack | null
    release(releaseId: string): CatalogRelease | null
}
