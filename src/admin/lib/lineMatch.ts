import { normalizeLine } from '@/utils/trackNotes'
import type { TrackAnnotation } from '@/utils/trackNotes'

/**
 * «Та же строка» до и после правки текста — чтобы разбор переезжал вместе
 * со строкой, а .lrc обновлялся построчно.
 *
 * 1. Якоря: строки, не изменившиеся по смыслу (без учёта регистра и знаков
 *    по краям), сопоставляются по наибольшей общей подпоследовательности —
 *    так повторяющийся припев остаётся на своих местах.
 * 2. Переставленные строки: точное совпадение среди оставшихся, если оно
 *    однозначно.
 * 3. Изменённые строки: только внутри «окна» между соседними якорями
 *    (позиция) и только при заметной похожести (опечатка, знак, слово).
 *    Удалённую или переписанную до неузнаваемости строку не угадываем.
 */

/** Порог похожести изменённой строки: ниже — считаем, что строку переписали. */
export const SIMILARITY_THRESHOLD = 0.6

function levenshtein(a: string, b: string): number {
    if (a === b) return 0
    if (!a.length) return b.length
    if (!b.length) return a.length
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
        const cur = [i]
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
        }
        prev = cur
    }
    return prev[b.length]
}

const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * Похожесть строк от 0 до 1 без учёта регистра и знаков: лучшее из
 * посимвольной (опечатки) и пословной (замена слова) оценки.
 */
export function lineSimilarity(a: string, b: string): number {
    const x = normalizeLine(a).replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
    const y = normalizeLine(b).replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
    if (!x || !y) return x === y ? 1 : 0
    const chars = 1 - levenshtein(x, y) / Math.max(x.length, y.length)
    const wa = words(x)
    const wb = words(y)
    const pool = [...wb]
    let common = 0
    for (const w of wa) {
        const i = pool.indexOf(w)
        if (i >= 0) {
            common++
            pool.splice(i, 1)
        }
    }
    const byWords = common / Math.max(wa.length, wb.length)
    return Math.max(chars, byWords)
}

/**
 * Сопоставление строк: для каждой старой строки — индекс новой или null
 * (строку удалили или переписали). Каждая новая строка — не больше чем
 * одной старой.
 */
export function matchLines(oldLines: string[], newLines: string[]): (number | null)[] {
    const a = oldLines.map(normalizeLine)
    const b = newLines.map(normalizeLine)
    const map: (number | null)[] = a.map(() => null)
    const taken = new Set<number>()

    // 1. Якоря — LCS по ключам строк.
    const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
        }
    }
    for (let i = 0, j = 0; i < a.length && j < b.length; ) {
        if (a[i] === b[j]) {
            map[i] = j
            taken.add(j)
            i++
            j++
        } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++
        else j++
    }

    // 2. Переставленные строки: тот же ключ, единственный свободный кандидат.
    a.forEach((key, i) => {
        if (map[i] !== null) return
        const free = b.flatMap((k, j) => (k === key && !taken.has(j) ? [j] : []))
        const sameOld = a.filter((k, x) => k === key && map[x] === null).length
        if (free.length === 1 && sameOld === 1) {
            map[i] = free[0]
            taken.add(free[0])
        }
    })

    // 3. Изменённые строки — в окне между соседними сопоставленными строками.
    for (let i = 0; i < a.length; i++) {
        if (map[i] !== null) continue
        let lo = -1
        for (let k = i - 1; k >= 0; k--) {
            if (map[k] !== null) {
                lo = map[k]!
                break
            }
        }
        let hi = b.length
        for (let k = i + 1; k < a.length; k++) {
            if (map[k] !== null) {
                hi = map[k]!
                break
            }
        }
        // Окно задаёт позиция; переставленная строка могла сдвинуть границы — тогда окно пустое.
        let best: { j: number; score: number } | null = null
        for (let j = lo + 1; j < hi; j++) {
            if (taken.has(j)) continue
            const score = lineSimilarity(oldLines[i], newLines[j])
            if (score < SIMILARITY_THRESHOLD) continue
            if (!best || score > best.score) best = { j, score }
        }
        if (best) {
            map[i] = best.j
            taken.add(best.j)
        }
    }
    return map
}

/**
 * Переносит разборы на изменённые строки. oldLines/newLines — строки песни
 * до и после правки (songLines). Разбор строки переезжает, если его строка
 * исчезла из текста, а сопоставленная новая строка похожа на исходную
 * (origin — текст, к которому разбор был привязан изначально: так разбор не
 * «уползает» на совсем другую строку через цепочку мелких правок) и ещё
 * не занята другим разбором.
 */
export function relinkAnnotations(
    oldLines: string[],
    newLines: string[],
    annotations: TrackAnnotation[],
    originOf: (line: string) => string = (line) => line
): { annotations: TrackAnnotation[]; moved: { from: string; to: string }[] } {
    const newKeys = new Set(newLines.map(normalizeLine))
    const oldKeys = oldLines.map(normalizeLine)
    const used = new Set(annotations.map((x) => normalizeLine(x.line)))
    let map: (number | null)[] | null = null
    const moved: { from: string; to: string }[] = []
    const out = annotations.map((ann) => {
        const key = normalizeLine(ann.line)
        if (newKeys.has(key)) return ann
        // Разбор достаётся первому вхождению строки (как на сайте).
        const at = oldKeys.indexOf(key)
        if (at < 0) return ann
        map ??= matchLines(oldLines, newLines)
        const j = map[at]
        if (j === null) return ann
        const target = newLines[j]
        const targetKey = normalizeLine(target)
        if (used.has(targetKey)) return ann
        if (lineSimilarity(originOf(ann.line), target) < SIMILARITY_THRESHOLD) return ann
        used.delete(key)
        used.add(targetKey)
        moved.push({ from: ann.line, to: target })
        return { ...ann, line: target }
    })
    return { annotations: moved.length ? out : annotations, moved }
}
