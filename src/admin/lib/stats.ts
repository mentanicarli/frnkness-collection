import type { Releases } from '@/types'
import { parseTrackKey } from '@/utils/lyrics'
import { addDays, diffDays, eachDay, moscowDateOf, parseRuDate, type IsoDate } from './dates'

/**
 * Чистая логика дашборда: сопоставление ключей статистики с треками,
 * периоды и окна «первых дней после релиза». Всё, что зависит от
 * реестра релизов, считается здесь, а не в базе: реестр живёт в git.
 */

export interface KeyPlays {
    track_key: string
    plays: number
}

export interface DayPlays {
    day: IsoDate
    plays: number
}

export interface DayKeyPlays {
    day: IsoDate
    track_key: string
    plays: number
}

export interface TrackStat {
    releaseId: string
    trackIndex: number
    title: string
    releaseTitle: string
    plays: number
}

export interface ReleaseStat {
    releaseId: string
    title: string
    type: 'album' | 'single'
    cover: string
    plays: number
}

export interface Aggregated {
    tracks: TrackStat[]
    releases: ReleaseStat[]
    /** Ключи, которым нет трека в реестре (удалённые треки, мусор). */
    unknown: KeyPlays[]
    total: number
}

/**
 * Сводит строки «ключ — прослушивания» к трекам и релизам.
 * Старый формат «<id>--<N>» (1-based) и новый «<id>-<i>» складываются
 * в один трек — так же, как на сайте.
 */
export function aggregatePlays(rows: KeyPlays[], releases: Releases): Aggregated {
    const tracks = new Map<string, TrackStat>()
    const releaseTotals = new Map<string, number>()
    const unknown = new Map<string, number>()
    let total = 0

    for (const row of rows) {
        const plays = Number(row.plays) || 0
        if (!plays) continue
        total += plays
        const ref = parseTrackKey(row.track_key)
        const release = ref ? releases[ref.releaseId] : undefined
        const track = ref && release ? release.tracks[ref.trackIndex] : undefined
        if (!ref || !release || !track) {
            unknown.set(row.track_key, (unknown.get(row.track_key) || 0) + plays)
            continue
        }
        const id = `${ref.releaseId}\u0000${ref.trackIndex}`
        const existing = tracks.get(id)
        if (existing) existing.plays += plays
        else
            tracks.set(id, {
                releaseId: ref.releaseId,
                trackIndex: ref.trackIndex,
                title: track.title,
                releaseTitle: release.title,
                plays
            })
        releaseTotals.set(ref.releaseId, (releaseTotals.get(ref.releaseId) || 0) + plays)
    }

    const byPlays = <T extends { plays: number }>(a: T, b: T) => b.plays - a.plays
    return {
        tracks: [...tracks.values()].sort((a, b) => byPlays(a, b) || a.releaseId.localeCompare(b.releaseId) || a.trackIndex - b.trackIndex),
        releases: [...releaseTotals.entries()]
            .map(([releaseId, plays]) => ({
                releaseId,
                title: releases[releaseId].title,
                type: releases[releaseId].type,
                cover: releases[releaseId].cover,
                plays
            }))
            .sort(byPlays),
        unknown: [...unknown.entries()].map(([track_key, plays]) => ({ track_key, plays })).sort(byPlays),
        total
    }
}

/** Прослушивания по каждому треку релиза (нули тоже). */
export function releaseTrackPlays(rows: KeyPlays[], releases: Releases, releaseId: string): number[] {
    const release = releases[releaseId]
    if (!release) return []
    const out = release.tracks.map(() => 0)
    for (const row of rows) {
        const ref = parseTrackKey(row.track_key)
        if (!ref || ref.releaseId !== releaseId || ref.trackIndex >= out.length) continue
        out[ref.trackIndex] += Number(row.plays) || 0
    }
    return out
}

/** Дневной ряд от from до to с нулями в пустых днях. */
export function fillDays(rows: DayPlays[], from: IsoDate, to: IsoDate): DayPlays[] {
    const map = new Map<IsoDate, number>()
    for (const r of rows) map.set(r.day, (map.get(r.day) || 0) + (Number(r.plays) || 0))
    return eachDay(from, to).map((day) => ({ day, plays: map.get(day) || 0 }))
}

/** Дневной ряд одного релиза из строк «день — ключ — прослушивания». */
export function releaseDailySeries(rows: DayKeyPlays[], releaseId: string, from: IsoDate, to: IsoDate): DayPlays[] {
    const own = rows.filter((r) => parseTrackKey(r.track_key)?.releaseId === releaseId)
    return fillDays(own.map((r) => ({ day: r.day, plays: r.plays })), from, to)
}

// ── Периоды ──────────────────────────────────────────────────────────

export type PeriodPreset = '7d' | '30d' | '90d' | 'since' | 'custom'

export interface Period {
    from: IsoDate
    to: IsoDate
}

export interface ResolvedPeriod extends Period {
    /** Часть периода раньше запуска журнала — по дням там данных нет. */
    clippedBefore: IsoDate | null
}

/**
 * Период для графика и топов. Даты раньше запуска журнала отрезаются:
 * событий тогда не писали, и нули на графике были бы враньём.
 */
export function resolvePeriod(
    preset: PeriodPreset,
    today: IsoDate,
    trackingSince: string | null,
    custom?: Period
): ResolvedPeriod | null {
    if (!trackingSince) return null
    const start = moscowDateOf(trackingSince)
    let from: IsoDate
    let to: IsoDate = today
    if (preset === '7d') from = addDays(today, -6)
    else if (preset === '30d') from = addDays(today, -29)
    else if (preset === '90d') from = addDays(today, -89)
    else if (preset === 'since') from = start
    else {
        if (!custom) return null
        from = custom.from
        to = custom.to > today ? today : custom.to
    }
    if (to < start) return { from: start, to: start, clippedBefore: from }
    const clippedBefore = from < start ? from : null
    return { from: clippedBefore ? start : from, to, clippedBefore }
}

// ── Первые дни после релиза ───────────────────────────────────────────

export type ReleaseWindowStatus = 'ok' | 'partial' | 'before-tracking' | 'future' | 'no-date' | 'no-tracking'

export interface ReleaseWindow {
    status: ReleaseWindowStatus
    releaseDate: IsoDate | null
    /** Полное окно: день релиза и следующие days−1 дней. */
    from: IsoDate | null
    to: IsoDate | null
    /** Часть окна, за которую есть данные (для запроса). */
    queryFrom: IsoDate | null
    queryTo: IsoDate | null
}

export function releaseWindow(
    releaseDateRu: string | undefined,
    days: number,
    trackingSince: string | null,
    today: IsoDate
): ReleaseWindow {
    const releaseDate = parseRuDate(releaseDateRu)
    const empty = { releaseDate, from: null, to: null, queryFrom: null, queryTo: null }
    if (!releaseDate) return { status: 'no-date', ...empty }
    const from = releaseDate
    const to = addDays(releaseDate, days - 1)
    if (from > today) return { status: 'future', ...empty, from, to }
    if (!trackingSince) return { status: 'no-tracking', ...empty, from, to }
    const start = moscowDateOf(trackingSince)
    const lastKnown = to > today ? today : to
    if (lastKnown < start) return { status: 'before-tracking', releaseDate, from, to, queryFrom: null, queryTo: null }
    const queryFrom = from < start ? start : from
    return { status: queryFrom === from ? 'ok' : 'partial', releaseDate, from, to, queryFrom, queryTo: lastKnown }
}

/** Номер дня после релиза (1 — день релиза). */
export function dayNumber(releaseDate: IsoDate, day: IsoDate): number {
    return diffDays(releaseDate, day) + 1
}

// ── Дослушивают или пропускают ───────────────────────────────────────

export interface ListenRow {
    track_key: string
    sessions: number
    completed: number
    avg_share: number
}

export interface TrackListen {
    releaseId: string
    trackIndex: number
    title: string
    releaseTitle: string
    sessions: number
    /** Доля дослушанных, 0..1. */
    completedShare: number
    /** Средняя доля прослушанного, 0..1. */
    avgShare: number
}

/**
 * Сводит строки по ключам к трекам. Оба формата ключа складываются;
 * средняя доля — взвешенная по числу сессий.
 */
export function aggregateListen(rows: ListenRow[], releases: Releases): TrackListen[] {
    const acc = new Map<string, { releaseId: string; trackIndex: number; sessions: number; completed: number; shareSum: number }>()
    for (const r of rows) {
        const ref = parseTrackKey(r.track_key)
        if (!ref || !releases[ref.releaseId]?.tracks[ref.trackIndex] || !r.sessions) continue
        const id = `${ref.releaseId}\u0000${ref.trackIndex}`
        const a = acc.get(id) ?? { releaseId: ref.releaseId, trackIndex: ref.trackIndex, sessions: 0, completed: 0, shareSum: 0 }
        a.sessions += r.sessions
        a.completed += r.completed
        a.shareSum += r.avg_share * r.sessions
        acc.set(id, a)
    }
    return [...acc.values()]
        .map((a) => ({
            releaseId: a.releaseId,
            trackIndex: a.trackIndex,
            title: releases[a.releaseId].tracks[a.trackIndex].title,
            releaseTitle: releases[a.releaseId].title,
            sessions: a.sessions,
            completedShare: a.completed / a.sessions,
            avgShare: a.shareSum / a.sessions
        }))
        .sort((x, y) => y.sessions - x.sessions || x.releaseId.localeCompare(y.releaseId) || x.trackIndex - y.trackIndex)
}

/** Удержание в процентах на каждой 5-й секунде. */
export function retentionPercents(rows: { second: number; listeners: number; sessions: number }[]): { second: number; percent: number }[] {
    return rows.map((r) => ({ second: r.second, percent: r.sessions ? Math.round((r.listeners / r.sessions) * 100) : 0 }))
}

/** Период для данных сессий: не раньше начала их сбора. */
export function clipToStart(period: Period, startedAt: string | null): Period | null {
    if (!startedAt) return null
    const start = moscowDateOf(startedAt)
    if (period.to < start) return null
    return { from: period.from < start ? start : period.from, to: period.to }
}

/** 0.873 → «87%». */
export function percent(share: number): string {
    return `${Math.round(share * 100)}%`
}

/** 125 → «2:05». */
export function formatSeconds(total: number): string {
    const m = Math.floor(total / 60)
    const s = Math.round(total % 60)
    return `${m}:${String(s).padStart(2, '0')}`
}
