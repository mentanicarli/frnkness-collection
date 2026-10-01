import type { Release, Releases } from '@/types'
import { checkDeletions, checkRegistryChange, type Registry } from '../../../supabase/functions/_shared/rules.ts'
import { formatRuDate, isValidIsoDate, parseRuDate, type IsoDate } from './dates'
import { youtubeEmbed } from './newRelease'

/**
 * Правка существующего релиза: меняются только название, дата (и год),
 * обложка, видео и PDF. id, тип, папки и треки не трогаются — от них
 * зависят ключи статистики.
 *
 * Новая обложка/PDF кладутся под новым именем (дата в имени): старый URL
 * долго живёт в кэше браузера и service worker. Старый файл удаляется
 * тем же коммитом.
 */

const ORDER = ['type', 'title', 'year', 'releaseDate', 'cover', 'audioPath', 'lyricsPath', 'lyricsBookPath', 'videoUrl', 'upcoming', 'tracks']

/** Поля в порядке существующих записей releases.json. */
export function orderReleaseFields(release: Record<string, unknown>): Release {
    const out: Record<string, unknown> = {}
    for (const key of ORDER) if (key in release) out[key] = release[key]
    for (const key of Object.keys(release)) if (!(key in out)) out[key] = release[key]
    return out as unknown as Release
}

/**
 * Новое имя файла рядом со старым: images/album4-cover.jpg →
 * images/album4-cover-20261002.jpg (при повторе в тот же день — -2, -3…).
 */
export function versionedPath(oldPath: string, ext: string, date: IsoDate, taken: Set<string>, fallbackBase: string): string {
    const slash = oldPath.lastIndexOf('/')
    const dir = oldPath.slice(0, slash + 1)
    let base = oldPath.slice(slash + 1).replace(/\.[^.]+$/, '').replace(/-\d{8}(?:-\d+)?$/, '')
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(base)) base = fallbackBase
    const stamp = date.replace(/-/g, '')
    const first = `${dir}${base}-${stamp}.${ext}`
    if (!taken.has(first)) return first
    for (let i = 2; ; i++) {
        const p = `${dir}${base}-${stamp}-${i}.${ext}`
        if (!taken.has(p)) return p
    }
}

export interface EditForm {
    title: string
    /** ISO-дата релиза. */
    date: IsoDate
    youtube: string
    /** Новая обложка (расширение файла) или null — оставить. */
    newCover: { ext: 'jpg' | 'png' } | null
    pdf: 'keep' | 'replace' | 'remove'
}

export function formFromRelease(release: Release): EditForm {
    return {
        title: release.title,
        date: parseRuDate(release.releaseDate) ?? `${release.year}-01-01`,
        youtube: release.videoUrl ?? '',
        newCover: null,
        pdf: 'keep'
    }
}

export interface EditPlan {
    next: Releases
    release: Release
    /** Новые файлы (медиа, загружаются при публикации). */
    uploads: { kind: 'cover' | 'pdf'; path: string }[]
    deletes: string[]
    /** Что поменялось — для сообщения коммита и подтверждения. */
    changes: string[]
    errors: string[]
}

export function planEdit(
    releases: Releases,
    id: string,
    form: EditForm,
    files: { path: string }[],
    today: IsoDate
): EditPlan {
    const old = releases[id]
    const edited: Record<string, unknown> = { ...old }
    const uploads: EditPlan['uploads'] = []
    const deletes: string[] = []
    const changes: string[] = []
    const errors: string[] = []
    const taken = new Set([...files.map((f) => f.path), ...Object.values(releases).flatMap((r) => [r.cover, r.lyricsBookPath ?? ''])])

    if (form.title.trim() !== old.title) {
        edited.title = form.title.trim()
        changes.push('название')
    }

    if (!isValidIsoDate(form.date)) errors.push('Укажи дату релиза')
    else {
        const ru = formatRuDate(form.date)
        if (ru !== old.releaseDate || form.date.slice(0, 4) !== old.year) {
            edited.releaseDate = ru
            edited.year = form.date.slice(0, 4)
            changes.push('дата')
        }
    }

    if (form.newCover) {
        const path = versionedPath(old.cover, form.newCover.ext, today, taken, `${id}-cover`)
        edited.cover = path
        uploads.push({ kind: 'cover', path })
        deletes.push(old.cover)
        changes.push('обложка')
    }

    const embed = form.youtube.trim() ? youtubeEmbed(form.youtube) : null
    if (form.youtube.trim() && !embed) errors.push('Не получилось распознать ссылку на YouTube')
    else if ((embed ?? undefined) !== old.videoUrl) {
        if (embed) edited.videoUrl = embed
        else delete edited.videoUrl
        changes.push(embed ? 'видео' : 'видео убрано')
    }

    if (form.pdf === 'replace') {
        const path = old.lyricsBookPath
            ? versionedPath(old.lyricsBookPath, 'pdf', today, taken, `${id}-lyrics`)
            : taken.has(`lyrics-books/${id}-lyrics.pdf`)
              ? versionedPath(`lyrics-books/${id}-lyrics.pdf`, 'pdf', today, taken, `${id}-lyrics`)
              : `lyrics-books/${id}-lyrics.pdf`
        edited.lyricsBookPath = path
        uploads.push({ kind: 'pdf', path })
        if (old.lyricsBookPath) deletes.push(old.lyricsBookPath)
        changes.push(old.lyricsBookPath ? 'PDF заменён' : 'PDF добавлен')
    } else if (form.pdf === 'remove' && old.lyricsBookPath) {
        delete edited.lyricsBookPath
        deletes.push(old.lyricsBookPath)
        changes.push('PDF убран')
    }

    const release = orderReleaseFields(edited)
    // Ключи в прежнем порядке: меняется только запись этого релиза.
    const next = Object.fromEntries(Object.entries(releases).map(([k, v]) => [k, k === id ? release : v])) as Releases

    // Та же проверка, что сделает функция при коммите.
    errors.push(...checkRegistryChange(releases as unknown as Registry, next as unknown as Registry))
    const existingDeletes = deletes.filter((p) => files.some((f) => f.path === p))
    errors.push(...checkDeletions(existingDeletes, { registry: releases, site: null }, { registry: next, site: null }))

    return { next, release, uploads, deletes: existingDeletes, changes, errors }
}
