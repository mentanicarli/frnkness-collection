import type { Releases } from '@/types'
import { findDanglingAnnotations } from '@/utils/trackNotes'
import { parseNotes } from './notesEdit'
import { audioPath, lrcPath, notesPath, txtPath } from './paths'

/**
 * Отчёт о каталоге: что есть и чего не хватает у каждого трека и релиза,
 * и какие файлы в audio/, images/, lyrics/ ни на что не ссылаются.
 * Наличие файлов — из дерева репозитория; число разборов и «висящие»
 * разборы — из содержимого .notes.json и .txt.
 */

export type ProblemAction = 'lyrics' | 'lrc' | null
export type Severity = 'error' | 'warn' | 'info'

export interface Problem {
    severity: Severity
    text: string
    action: ProblemAction
}

export interface TrackReport {
    releaseId: string
    trackIndex: number
    num: number
    title: string
    audio: boolean
    txt: 'missing' | 'empty' | 'ok'
    lrc: boolean
    notes: 'missing' | 'broken' | 'ok'
    annotations: number
    dangling: number
    problems: Problem[]
}

export interface ReleaseReport {
    releaseId: string
    title: string
    cover: boolean
    /** null — PDF у релиза не указан. */
    pdf: boolean | null
    problems: Problem[]
    tracks: TrackReport[]
}

export interface CatalogReport {
    releases: ReleaseReport[]
    orphans: { path: string; size: number }[]
    counts: Record<Severity, number>
}

const ORPHAN_DIRS = ['audio/', 'images/', 'lyrics/']

/** Пути, содержимое которых нужно для подсчёта разборов. */
export function contentPathsNeeded(releases: Releases, files: { path: string }[]): string[] {
    const have = new Set(files.map((f) => f.path))
    const out: string[] = []
    for (const r of Object.values(releases)) {
        for (const t of r.tracks) {
            if (!have.has(notesPath(r, t))) continue
            out.push(notesPath(r, t))
            if (have.has(txtPath(r, t))) out.push(txtPath(r, t))
        }
    }
    return out
}

export function computeCatalogReport(
    releases: Releases,
    files: { path: string; size: number }[],
    contents: Record<string, string | null> = {}
): CatalogReport {
    const size = new Map(files.map((f) => [f.path, f.size]))
    const has = (p: string) => size.has(p)
    const referenced = new Set<string>()
    const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 }
    const add = (list: Problem[], p: Problem) => {
        list.push(p)
        counts[p.severity]++
    }

    const report: ReleaseReport[] = Object.entries(releases).map(([releaseId, r]) => {
        const problems: Problem[] = []
        referenced.add(r.cover)
        const cover = has(r.cover)
        if (!cover) add(problems, { severity: 'error', text: `нет обложки ${r.cover}`, action: null })
        let pdf: boolean | null = null
        if (r.lyricsBookPath) {
            referenced.add(r.lyricsBookPath)
            pdf = has(r.lyricsBookPath)
            if (!pdf) add(problems, { severity: 'error', text: `нет PDF ${r.lyricsBookPath}`, action: null })
        }

        const tracks = r.tracks.map((t, trackIndex): TrackReport => {
            const tp: Problem[] = []
            const paths = { audio: audioPath(r, t), txt: txtPath(r, t), lrc: lrcPath(r, t), notes: notesPath(r, t) }
            Object.values(paths).forEach((p) => referenced.add(p))
            const audio = has(paths.audio)
            const txt = !has(paths.txt) ? 'missing' : (size.get(paths.txt) || 0) === 0 ? 'empty' : 'ok'
            const lrc = has(paths.lrc)
            let notes: TrackReport['notes'] = has(paths.notes) ? 'ok' : 'missing'
            let annotations = 0
            let dangling = 0
            if (notes === 'ok' && paths.notes in contents) {
                const parsed = parseNotes(contents[paths.notes])
                if (parsed.error) notes = 'broken'
                else {
                    annotations = (parsed.notes.annotations ?? []).filter((a) => a.line && a.note).length
                    const text = contents[paths.txt] ?? ''
                    dangling = findDanglingAnnotations(text.replace(/\r\n?/g, '\n'), parsed.notes).length
                }
            }

            if (!audio) add(tp, { severity: 'error', text: `нет mp3 ${paths.audio}`, action: null })
            if (txt === 'missing') add(tp, { severity: 'error', text: `нет файла текста ${paths.txt}`, action: 'lyrics' })
            else if (txt === 'empty') add(tp, { severity: 'warn', text: 'текст пустой — на сайте «Текст будет позже...»', action: 'lyrics' })
            if (txt === 'ok' && !lrc) add(tp, { severity: 'warn', text: 'нет караоке (.lrc)', action: 'lrc' })
            if (notes === 'broken') add(tp, { severity: 'error', text: 'файл разборов повреждён', action: 'lyrics' })
            if (dangling) add(tp, { severity: 'warn', text: `${dangling} разбор(ов) не находят строку в тексте`, action: 'lyrics' })
            if (txt === 'ok' && notes === 'missing') add(tp, { severity: 'info', text: 'нет описания и разборов', action: 'lyrics' })

            return {
                releaseId,
                trackIndex,
                num: t.num,
                title: t.title,
                audio,
                txt,
                lrc,
                notes,
                annotations,
                dangling,
                problems: tp
            }
        })
        return { releaseId, title: r.title, cover, pdf, problems, tracks }
    })

    const orphans = files
        .filter((f) => ORPHAN_DIRS.some((d) => f.path.startsWith(d)) && !referenced.has(f.path))
        .sort((a, b) => a.path.localeCompare(b.path))

    return { releases: report, orphans, counts }
}
