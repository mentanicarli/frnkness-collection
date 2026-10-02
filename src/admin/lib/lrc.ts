import { parseLRC } from '@/utils/lyrics'
import { isSectionLabel } from '@/utils/trackNotes'

/**
 * LRC для караоке: формат строк — «[mm:ss.xx]текст», как в существующих
 * файлах. Строки берутся из .txt без пустых строк и меток секций и
 * переносятся дословно — ничего не срезается.
 *
 * Раньше здесь убирались знаки в конце строки, потому что .txt тогда
 * заканчивались запятыми и точками, а .lrc — нет. Теперь по правилу
 * оформления текстов знаков в конце строки нет и в .txt, так что любая
 * обрезка только разводила бы .lrc с текстом.
 */

export interface LrcLine {
    text: string
    /** Секунды; null — строка ещё не отмечена. */
    time: number | null
}

/** Только схлопывание пробелов: текст строки идёт в .lrc как в .txt. */
export function cleanLrcText(line: string): string {
    return line.replace(/\s+/g, ' ').trim()
}

export function linesFromTxt(txt: string): string[] {
    return txt
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !isSectionLabel(l))
        .map(cleanLrcText)
        .filter(Boolean)
}

export function formatLrcTime(seconds: number): string {
    const total = Math.max(0, Math.round(seconds * 100))
    const mm = Math.floor(total / 6000)
    const ss = Math.floor(total / 100) % 60
    const cs = total % 100
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** Только строки с отметкой; по возрастанию времени, перевод строки в конце. */
export function buildLrc(lines: LrcLine[]): string {
    const timed = lines.filter((l): l is { text: string; time: number } => l.time !== null)
    if (!timed.length) return ''
    return timed.map((l) => `[${formatLrcTime(l.time)}]${l.text}`).join('\n') + '\n'
}

export function linesFromLrc(lrc: string): LrcLine[] {
    return parseLRC(lrc.replace(/\r\n?/g, '\n')).map((l) => ({ text: l.text, time: l.time }))
}

// ── Синхронизация ────────────────────────────────────────────────────

/** Индекс первой строки без отметки (куда пойдёт следующий Пробел). */
export function nextUnstamped(lines: LrcLine[]): number {
    const i = lines.findIndex((l) => l.time === null)
    return i < 0 ? lines.length : i
}

/** Отметить следующую строку текущим временем. */
export function stamp(lines: LrcLine[], time: number): LrcLine[] {
    const i = nextUnstamped(lines)
    if (i >= lines.length) return lines
    return lines.map((l, j) => (j === i ? { ...l, time: Math.max(0, round2(time)) } : l))
}

/** Отменить последнюю отметку (Backspace). */
export function undoStamp(lines: LrcLine[]): LrcLine[] {
    const i = nextUnstamped(lines) - 1
    if (i < 0) return lines
    return lines.map((l, j) => (j === i ? { ...l, time: null } : l))
}

export function nudge(lines: LrcLine[], index: number, delta: number): LrcLine[] {
    return lines.map((l, j) => (j === index && l.time !== null ? { ...l, time: Math.max(0, round2(l.time + delta)) } : l))
}

export function clearTimes(lines: LrcLine[]): LrcLine[] {
    return lines.map((l) => ({ ...l, time: null }))
}

function round2(v: number) {
    return Math.round(v * 100) / 100
}

/** Индексы строк, время которых меньше, чем у предыдущей. */
export function outOfOrder(lines: LrcLine[]): number[] {
    const bad: number[] = []
    let prev = -Infinity
    lines.forEach((l, i) => {
        if (l.time === null) return
        if (l.time < prev) bad.push(i)
        prev = Math.max(prev, l.time)
    })
    return bad
}

/**
 * Активная строка караоке — как на сайте: последняя строка, чьё время
 * уже наступило; до первой строки — первая.
 */
export function activeIndex(lines: LrcLine[], currentTime: number): number {
    let idx = 0
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].time
        if (t !== null && currentTime >= t) idx = i
    }
    return idx
}

/**
 * Совмещает строки текста с готовым .lrc: если тексты совпадают по
 * порядку, время переносится; иначе берётся .lrc как есть.
 */
export function mergeWithExisting(textLines: string[], lrc: LrcLine[]): { lines: LrcLine[]; matched: boolean } {
    if (lrc.length === textLines.length && lrc.every((l, i) => l.text === textLines[i])) return { lines: lrc, matched: true }
    return { lines: lrc, matched: false }
}
