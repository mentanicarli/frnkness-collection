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

/**
 * Готовый .lrc, вставленный в синхронизатор (из другой программы или с
 * сайта). Принимает [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx], [mm:ss:xx]
 * и несколько меток на строке (повтор припева). Метаданные ([ar:…], [ti:…])
 * и строки без метки или без текста пропускаются — их число в skipped.
 * Время округляется до сотых, строки идут по времени.
 */
export function parsePastedLrc(text: string): { lines: { text: string; time: number }[]; skipped: number } {
    const out: { text: string; time: number; order: number }[] = []
    let skipped = 0
    const stamp = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
    text.replace(/\r\n?/g, '\n')
        .split('\n')
        .forEach((raw) => {
            const line = raw.trim()
            if (!line) return
            if (/^\[[a-z#]+:.*\]$/i.test(line)) return // метаданные
            const times: number[] = []
            let rest = line
            stamp.lastIndex = 0
            let m: RegExpExecArray | null
            while ((m = stamp.exec(rest)) && m.index === 0) {
                // В целых миллисекундах: 2.345 с в плавающей точке округлилось бы вниз.
                const ms = (Number(m[1]) * 60 + Number(m[2])) * 1000 + (m[3] ? Number(m[3].padEnd(3, '0')) : 0)
                times.push(Math.round(ms / 10) / 100)
                rest = rest.slice(m[0].length)
                stamp.lastIndex = 0
            }
            const body = cleanLrcText(rest)
            if (!times.length || !body) {
                skipped++
                return
            }
            for (const time of times) out.push({ text: body, time, order: out.length })
        })
    out.sort((a, b) => a.time - b.time || a.order - b.order)
    return { lines: out.map(({ text, time }) => ({ text, time })), skipped }
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

/**
 * Сдвиг всех отмеченных строк на одно и то же время. Назад сдвиг
 * ограничивается так, чтобы самая ранняя строка встала ровно на 0.00:
 * все строки сдвигаются на одинаковую величину, промежутки между ними не
 * ломаются, и обратный сдвиг возвращает всё как было. `applied` — сколько
 * сдвинули на самом деле (0, если самая ранняя строка уже на 0.00).
 * Считаем в сотых долях целыми числами, чтобы не копить ошибку округления.
 */
export function shiftAll(lines: LrcLine[], delta: number): { lines: LrcLine[]; applied: number } {
    const times = lines.flatMap((l) => (l.time === null ? [] : [Math.round(l.time * 100)]))
    if (!times.length) return { lines, applied: 0 }
    const want = Math.round(delta * 100)
    const cs = Math.max(want, -Math.min(...times))
    if (cs === 0) return { lines, applied: 0 }
    return {
        lines: lines.map((l) => (l.time === null ? l : { ...l, time: (Math.round(l.time * 100) + cs) / 100 })),
        applied: cs / 100
    }
}

/** Самое раннее время среди отмеченных строк (null — отмеченных нет). */
export function earliestTime(lines: LrcLine[]): number | null {
    const times = lines.flatMap((l) => (l.time === null ? [] : [l.time]))
    return times.length ? Math.min(...times) : null
}

/** «+0.3 с», «−0.1 с», «0.0 с» — для подписи накопленного сдвига. */
export function formatShift(seconds: number): string {
    const cs = Math.round(seconds * 100)
    if (cs === 0) return '0.0 с'
    const abs = Math.abs(cs) / 100
    const s = cs % 10 === 0 ? abs.toFixed(1) : abs.toFixed(2)
    return `${cs > 0 ? '+' : '−'}${s} с`
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
