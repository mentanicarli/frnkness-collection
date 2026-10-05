import { normalizeLine, validateTrackNotes, type TrackAnnotation, type TrackNotes } from '@/utils/trackNotes'

/**
 * Правка .notes.json: разборы привязаны к строке через normalizeLine —
 * тем же правилом, что и на сайте. На сайте при повторе одной строки в
 * annotations побеждает последняя запись, здесь при правке дубли
 * схлопываются в одну.
 */

export function normalizeNewlines(text: string): string {
    return text.replace(/\r\n?/g, '\n')
}

export function parseNotes(text: string | null): { notes: TrackNotes; error: string | null } {
    if (text === null || !text.trim()) return { notes: {}, error: null }
    let value: unknown
    try {
        value = JSON.parse(text)
    } catch (e) {
        return { notes: {}, error: `Файл разборов повреждён: ${(e as Error).message}` }
    }
    const errors = validateTrackNotes(value)
    if (errors.length) return { notes: {}, error: `Файл разборов некорректен: ${errors.join('; ')}` }
    return { notes: value as TrackNotes, error: null }
}

/** Формат как у существующих файлов: 2 пробела, перевод строки в конце. */
export function serializeNotes(notes: TrackNotes): string {
    const out: TrackNotes = {}
    const about = normalizeNewlines(notes.about ?? '').trim()
    if (about) out.about = about
    const annotations = (notes.annotations ?? [])
        .map((a) => ({ line: a.line.trim(), note: normalizeNewlines(a.note).trim() }))
        .filter((a) => a.line && a.note)
    if (annotations.length) out.annotations = annotations
    return JSON.stringify(out, null, 2) + '\n'
}

export function isNotesEmpty(notes: TrackNotes): boolean {
    return !(notes.about ?? '').trim() && !(notes.annotations ?? []).some((a) => a.line.trim() && a.note.trim())
}

/** Текст разбора для строки (как на сайте: последняя запись с этим ключом). */
export function noteFor(list: TrackAnnotation[], line: string): string | null {
    const key = normalizeLine(line)
    let found: string | null = null
    for (const a of list) if (normalizeLine(a.line) === key && a.note) found = a.note
    return found
}

/**
 * Ставит, меняет или (пустой note) удаляет разбор строки. Записи с тем же
 * ключом схлопываются в одну на месте первой.
 */
export function setNote(list: TrackAnnotation[], line: string, note: string): TrackAnnotation[] {
    const key = normalizeLine(line)
    const text = normalizeNewlines(note).trim()
    const out: TrackAnnotation[] = []
    let placed = false
    for (const a of list) {
        if (normalizeLine(a.line) !== key) {
            out.push(a)
            continue
        }
        if (!placed && text) out.push({ line: a.line, note: text })
        placed = true
    }
    if (!placed && text) out.push({ line: line.trim(), note: text })
    return out
}

export function removeNote(list: TrackAnnotation[], line: string): TrackAnnotation[] {
    return setNote(list, line, '')
}

/**
 * Привязать разбор строки from к строке to на том же месте в списке (порядок
 * в .notes.json не прыгает). Прежний разбор строки to, если был, заменяется.
 */
export function moveNote(list: TrackAnnotation[], from: string, to: string): TrackAnnotation[] {
    const fromKey = normalizeLine(from)
    const toKey = normalizeLine(to)
    if (fromKey === toKey) return list
    return list.flatMap((a) => {
        const key = normalizeLine(a.line)
        if (key === fromKey) return [{ ...a, line: to.trim() }]
        if (key === toKey) return []
        return [a]
    })
}
