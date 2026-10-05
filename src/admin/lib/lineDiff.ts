/**
 * Построчная разница двух версий файла — для конфликта при сохранении:
 * что сейчас в main и чем от этого отличается свой вариант. Тексты и .lrc
 * короткие (сотня строк), поэтому хватает простого LCS.
 */
export type DiffLine = { kind: 'same' | 'del' | 'add'; text: string } | { kind: 'gap'; count: number }

const MAX_CELLS = 4_000_000

export function lineDiff(before: string, after: string): DiffLine[] | null {
    const a = before.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
    const b = after.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
    if (a.length * b.length > MAX_CELLS) return null
    // lcs[i][j] — длина общей подпоследовательности хвостов a[i..], b[j..].
    const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
        }
    }
    const out: DiffLine[] = []
    let i = 0
    let j = 0
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            out.push({ kind: 'same', text: a[i++] })
            j++
        } else if (i < a.length && (j >= b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
            // При равенстве сначала удаление: «было → стало» читается сверху вниз.
            out.push({ kind: 'del', text: a[i++] })
        } else {
            out.push({ kind: 'add', text: b[j++] })
        }
    }
    return out
}

/** Только изменения и по context строк вокруг; остальное — «… N строк без изменений». */
export function compactDiff(lines: DiffLine[], context = 1): DiffLine[] {
    const keep = lines.map((l) => l.kind !== 'same')
    const near = lines.map((_, i) => {
        for (let d = -context; d <= context; d++) if (keep[i + d]) return true
        return false
    })
    const out: DiffLine[] = []
    let gap = 0
    lines.forEach((l, i) => {
        if (near[i]) {
            if (gap) out.push({ kind: 'gap', count: gap })
            gap = 0
            out.push(l)
        } else gap++
    })
    if (gap) out.push({ kind: 'gap', count: gap })
    return out
}

export const hasChanges = (lines: DiffLine[]) => lines.some((l) => l.kind === 'add' || l.kind === 'del')
