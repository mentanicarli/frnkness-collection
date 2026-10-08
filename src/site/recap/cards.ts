import { topDayPart } from './format'
import type { CatalogRelease, CatalogTrack, DayPartId, Recap, RecapCatalog, RecapCompanion } from './types'

/** Меньше стольких прослушиваний данных мало (совпадает с флагом sparse в базе). */
export const SPARSE_PLAYS = 10

export interface TopTrackItem extends CatalogTrack {
    trackKey: string
    plays: number
    minutes: number
}

export type RecapCard =
    | { kind: 'intro'; year: number; nick: string; final: boolean }
    | { kind: 'sparse' }
    | { kind: 'empty' }
    | { kind: 'minutes'; minutes: number; plays: number }
    | { kind: 'top'; tracks: TopTrackItem[] }
    | { kind: 'release'; release: CatalogRelease & { id: string }; plays: number; minutes: number }
    | { kind: 'first'; track: CatalogTrack; at: string }
    | { kind: 'day'; date: string; minutes: number }
    | { kind: 'daypart'; part: DayPartId; share: number; plays: number }
    | { kind: 'rooms'; count: number; with: RecapCompanion[] }
    | { kind: 'favorites'; count: number }
    | { kind: 'summary' }

/**
 * Какие карточки показать. Карточка без данных не показывается; если
 * данных почти нет, вместо цифр — дружелюбный текст.
 *   — ничего нет совсем → «пусто» без сводки и картинки;
 *   — меньше 10 прослушиваний → только то, что есть, без «любимого релиза»,
 *     «самого активного дня» и времени суток (по трём трекам они ничего не
 *     говорят), плюс короткая заметка.
 */
export function buildCards(recap: Recap, catalog: RecapCatalog): RecapCard[] {
    const nick = recap.user?.nick ?? ''
    const cards: RecapCard[] = [{ kind: 'intro', year: recap.year, nick, final: recap.final }]

    const hasAnything = recap.plays > 0 || recap.minutes > 0 || recap.rooms.count > 0 || recap.favorites_added > 0
    if (!hasAnything) {
        cards.push({ kind: 'empty' })
        return cards
    }
    const sparse = recap.plays < SPARSE_PLAYS
    if (sparse) cards.push({ kind: 'sparse' })

    if (recap.minutes > 0 || recap.plays > 0) cards.push({ kind: 'minutes', minutes: recap.minutes, plays: recap.plays })

    const top = recap.top_tracks.flatMap((t): TopTrackItem[] => {
        const info = catalog.track(t.track_key)
        return info ? [{ ...info, trackKey: t.track_key, plays: t.plays, minutes: t.minutes }] : []
    })
    if (top.length) cards.push({ kind: 'top', tracks: top })

    const release = recap.top_release && catalog.release(recap.top_release.release_id)
    if (!sparse && release && recap.top_release) {
        cards.push({ kind: 'release', release: { ...release, id: recap.top_release.release_id }, plays: recap.top_release.plays, minutes: recap.top_release.minutes })
    }

    const first = recap.first_track && catalog.track(recap.first_track.track_key)
    if (first && recap.first_track) cards.push({ kind: 'first', track: first, at: recap.first_track.at })

    if (!sparse && recap.best_day && recap.best_day.minutes > 0) cards.push({ kind: 'day', date: recap.best_day.date, minutes: recap.best_day.minutes })

    const part = sparse ? null : topDayPart(recap.day_parts)
    if (part) cards.push({ kind: 'daypart', part: part.id, share: part.share, plays: part.plays })

    if (recap.rooms.count > 0) cards.push({ kind: 'rooms', count: recap.rooms.count, with: recap.rooms.with })
    if (recap.favorites_added > 0) cards.push({ kind: 'favorites', count: recap.favorites_added })

    cards.push({ kind: 'summary' })
    return cards
}
