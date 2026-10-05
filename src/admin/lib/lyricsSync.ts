import { isSectionLabel, normalizeLine } from '@/utils/trackNotes'
import type { LrcLine } from './lrc'

/**
 * Подсветка звучащей строки в «Текстах»: строки .lrc сопоставляются со
 * строками текста по тексту — без учёта регистра и знаков по краям, как
 * разборы (normalizeLine). Время берётся из .lrc, место — из текста,
 * поэтому подсветка не ломается, пока текст правят.
 */

/** Строки песни по порядку — без пустых строк и меток секций (как строки layoutLyrics). */
export function songLines(text: string): string[] {
    return text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !isSectionLabel(l))
}

export interface SyncPoint {
    /** Секунды из .lrc. */
    time: number
    /** Индекс в songLines(text). */
    line: number
}

/**
 * Точки синхронизации, по времени. Повторы (припев) сопоставляются по
 * порядку: каждая строка .lrc ищется после предыдущей найденной, а если
 * дальше её нет — с начала текста. Не найденные строки пропускаются.
 */
export function syncPoints(lines: string[], lrc: LrcLine[]): SyncPoint[] {
    const keys = lines.map(normalizeLine)
    const points: SyncPoint[] = []
    let from = 0
    for (const l of lrc) {
        if (l.time === null) continue
        const key = normalizeLine(l.text)
        if (!key) continue
        let at = keys.indexOf(key, from)
        if (at < 0) at = keys.indexOf(key)
        else from = at + 1
        if (at >= 0) points.push({ time: l.time, line: at })
    }
    return points.sort((a, b) => a.time - b.time)
}

/** Строка, которая звучит в момент t: последняя точка, чьё время наступило; до первой — нет (-1). */
export function activeLine(points: SyncPoint[], t: number): number {
    let line = -1
    for (const p of points) {
        if (p.time > t) break
        line = p.line
    }
    return line
}

/** Время строки текста — первая точка с этой строкой; null — в .lrc её нет. */
export function lineTime(points: SyncPoint[], line: number): number | null {
    return points.find((p) => p.line === line)?.time ?? null
}
