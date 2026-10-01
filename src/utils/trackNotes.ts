import { escapeHtml } from './helpers'

/**
 * Описание трека и разборы строк — содержимое <имя текста>.notes.json.
 * Общий код страницы трека на сайте и предпросмотра в админке: если
 * правила сопоставления разойдутся, предпросмотр начнёт врать.
 */

export interface TrackAnnotation {
    line: string
    note: string
}

export interface TrackNotes {
    about?: string
    annotations?: TrackAnnotation[]
}

// Строки сравниваем без учёта регистра, лишних пробелов и знаков по
// краям. Иначе разбор отваливался бы из-за запятой в конце строки,
// которую легко не скопировать при написании комментария.
const EDGE_PUNCTUATION = /^[\s"'«»(\[]+|[\s"'«»)\],.!?;:—–-]+$/g

export function normalizeLine(value: unknown): string {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(EDGE_PUNCTUATION, '')
        .toLowerCase()
}

// [Припев], [Куплет 2] и прочие метки секций — не строки песни,
// поэтому они и не подсвечиваются, и не принимают разборы.
export function isSectionLabel(line: string): boolean {
    return /^\[.+\]$/.test(line.trim())
}

export function buildNoteMap(entry: TrackNotes | null | undefined): Map<string, string> {
    const map = new Map<string, string>()
    const list = entry && Array.isArray(entry.annotations) ? entry.annotations : []
    list.forEach((item) => {
        if (!item || !item.line || !item.note) return
        map.set(normalizeLine(item.line), String(item.note))
    })
    return map
}

export type LyricRow =
    | { kind: 'blank' }
    | { kind: 'section'; text: string }
    | { kind: 'line'; text: string; key: string; note: string | null }

/**
 * Раскладывает текст песни по строкам и вешает разборы.
 * Разбор достаётся только первому вхождению строки: иначе припев,
 * повторённый пять раз, подчёркивал бы полтекста одним и тем же
 * комментарием.
 */
export function layoutLyrics(text: string, noteMap: Map<string, string>): LyricRow[] {
    const used = new Set<string>()
    return text.split('\n').map((rawLine): LyricRow => {
        const line = rawLine.trim()
        if (!line) return { kind: 'blank' }
        if (isSectionLabel(line)) return { kind: 'section', text: line }
        const key = normalizeLine(line)
        const note = used.has(key) ? null : noteMap.get(key) ?? null
        if (note) used.add(key)
        return { kind: 'line', text: line, key, note }
    })
}

/**
 * Разборы, строка которых не нашлась в тексте (например, после правки
 * текста), — на сайте они просто не покажутся.
 */
export function findDanglingAnnotations(text: string, entry: TrackNotes | null | undefined): TrackAnnotation[] {
    const keys = new Set(
        layoutLyrics(text, new Map())
            .filter((row): row is Extract<LyricRow, { kind: 'line' }> => row.kind === 'line')
            .map((row) => row.key)
    )
    const list = entry && Array.isArray(entry.annotations) ? entry.annotations : []
    return list.filter((item) => item && item.line && item.note && !keys.has(normalizeLine(item.line)))
}

export function renderLyricsHtml(text: string, noteMap: Map<string, string>): { html: string; annotated: number } {
    if (!text) {
        return { html: '<p class="track-lyrics-empty">Текст будет позже...</p>', annotated: 0 }
    }

    let noteIndex = 0
    const html = layoutLyrics(text, noteMap)
        .map((row) => {
            if (row.kind === 'blank') return '<p class="lyric-line is-blank">&nbsp;</p>'
            if (row.kind === 'section') return `<p class="lyric-section">${escapeHtml(row.text)}</p>`
            if (!row.note) return `<p class="lyric-line">${escapeHtml(row.text)}</p>`

            const id = `lyric-note-${noteIndex++}`
            return `
                    <p class="lyric-line has-note" role="button" tabindex="0"
                       aria-expanded="false" aria-controls="${id}"
                       data-note-target="${id}">${escapeHtml(row.text)}</p>
                    <div class="lyric-note" id="${id}" hidden>${escapeHtml(row.note)}</div>
                `
        })
        .join('')
    return { html, annotated: noteIndex }
}

export function renderAboutHtml(entry: TrackNotes | null | undefined): string {
    const about = entry && typeof entry.about === 'string' ? entry.about.trim() : ''
    if (!about) return ''
    const paragraphs = about
        .split(/\n{2,}/)
        .map((block) => `<p>${escapeHtml(block.trim())}</p>`)
        .join('')
    return `
            <section class="track-section">
                <h2 class="track-section-title">О треке</h2>
                <div class="track-about">${paragraphs}</div>
            </section>
        `
}

// Проверка структуры .notes.json — общая с Edge Function, поэтому живёт рядом с ней.
export { validateTrackNotes } from '../../supabase/functions/_shared/rules.ts'
