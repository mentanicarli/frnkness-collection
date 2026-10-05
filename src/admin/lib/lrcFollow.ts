import { cleanLrcText, linesFromTxt } from './lrc'

/**
 * .lrc совпадает с .txt построчно (правило проекта). Когда в «Текстах»
 * меняют текст строки, ту же строку .lrc можно обновить, не трогая её
 * таймкод. Если строк стало больше или меньше — автоматически не трогаем:
 * нужна разметка в синхронизаторе.
 */
export type LrcFollow =
    /** .lrc нет или строки песни не менялись. */
    | { kind: 'none' }
    /** Изменился только текст строк — .lrc можно обновить. */
    | { kind: 'update'; changes: { index: number; from: string; to: string }[]; content: string }
    /** Число строк изменилось — только синхронизатор. */
    | { kind: 'structure'; before: number; after: number }
    /** .lrc и до правки не совпадал с текстом построчно. */
    | { kind: 'mismatch' }

const TIMED = /^(\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])(.*)$/

export function followLrc(originalTxt: string, newTxt: string, lrcRaw: string | null): LrcFollow {
    if (lrcRaw === null) return { kind: 'none' }
    const before = linesFromTxt(originalTxt)
    const after = linesFromTxt(newTxt)
    if (before.length === after.length && before.every((l, i) => l === after[i])) return { kind: 'none' }
    if (before.length !== after.length) return { kind: 'structure', before: before.length, after: after.length }

    const raw = lrcRaw.replace(/\r\n?/g, '\n').split('\n')
    const timed = raw.flatMap((l, i) => {
        const m = l.match(TIMED)
        return m && cleanLrcText(m[2]) ? [{ i, stamp: m[1], text: cleanLrcText(m[2]) }] : []
    })
    if (timed.length !== before.length || timed.some((t, k) => t.text !== before[k])) return { kind: 'mismatch' }

    const changes: { index: number; from: string; to: string }[] = []
    const out = [...raw]
    before.forEach((from, k) => {
        const to = after[k]
        if (from === to) return
        changes.push({ index: k, from, to })
        out[timed[k].i] = `${timed[k].stamp}${to}`
    })
    return { kind: 'update', changes, content: out.join('\n') }
}
