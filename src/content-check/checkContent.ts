import fs from 'node:fs'
import path from 'node:path'
import { checkTrackIds, validateSiteSettings, validateTrackNotes } from '../../supabase/functions/_shared/rules.ts'
import { findDanglingAnnotations, type TrackNotes } from '@/utils/trackNotes'
import { getTrackSlug } from '@/utils/slug'
import type { Track } from '@/types'

/**
 * Проверка контента репозитория (npm run check:content): реестр и site.json
 * валидны, все файлы, на которые они ссылаются, существуют, разборы и .lrc
 * читаются. Проверяет любой корректный каталог, а не конкретный: ничего не
 * знает о том, какие релизы и треки сейчас есть.
 *
 * Пути сравниваются с учётом регистра: GitHub Pages различает ZAL.mp3 и
 * zal.mp3, а Windows — нет.
 */

export interface ContentReport {
    errors: string[]
    stats: { releases: number; tracks: number; notes: number; lrc: number }
}

const RELEASE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RELEASE_KEYS = new Set(['type', 'title', 'year', 'releaseDate', 'cover', 'audioPath', 'lyricsPath', 'lyricsBookPath', 'videoUrl', 'upcoming', 'tracks'])
const TRACK_KEYS = new Set(['num', 'title', 'file', 'lyricsFile', 'id'])
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const RELEASE_DATE_RE = new RegExp(`^([1-9]|[12]\\d|3[01]) (${MONTHS.join('|')}) (\\d{4})$`)
const YOUTUBE_EMBED_RE = /^https:\/\/www\.youtube\.com\/embed\/[\w-]{6,20}$/
// Строка .lrc: одна или несколько меток [mm:ss.xx] и текст — как читает parseLRC.
const LRC_LINE_RE = /^(\[\d{2}:\d{2}(?:[.:]\d{2})?\])+/
const CONTENT_DIRS = ['audio', 'images', 'lyrics', 'lyrics-books']

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isFileName = (v: unknown, ext: string): v is string =>
    typeof v === 'string' && v.trim() === v && v.length > ext.length && v.toLowerCase().endsWith(ext) && !/[/\\]/.test(v)

/** Все файлы контентных папок — пути от корня через «/». */
function listFiles(root: string): Set<string> {
    const out = new Set<string>()
    const walk = (rel: string) => {
        const full = path.join(root, rel)
        if (!fs.existsSync(full)) return
        for (const e of fs.readdirSync(full, { withFileTypes: true })) {
            const child = `${rel}/${e.name}`
            if (e.isDirectory()) walk(child)
            else out.add(child)
        }
    }
    CONTENT_DIRS.forEach(walk)
    return out
}

function readJson(root: string, rel: string, errors: string[]): unknown {
    const full = path.join(root, rel)
    if (!fs.existsSync(full)) {
        errors.push(`${rel}: файла нет`)
        return undefined
    }
    try {
        return JSON.parse(fs.readFileSync(full, 'utf8'))
    } catch (e) {
        errors.push(`${rel}: битый JSON — ${(e as Error).message}`)
        return undefined
    }
}

/** Структура реестра. Мягче, чем проверка нового релиза: старые релизы
 *  лежат в папках с пробелами и с mp3 не в латинице — это допустимо. */
function checkRegistry(registry: unknown, errors: string[]): Obj {
    const p = 'src/content/releases.json'
    if (!isObj(registry)) {
        errors.push(`${p}: ожидается объект релизов`)
        return {}
    }
    for (const [id, value] of Object.entries(registry)) {
        const rp = `${p}: релиз «${id}»`
        if (!RELEASE_ID_RE.test(id)) errors.push(`${rp}: id может содержать только a-z, 0-9 и дефисы`)
        if (!isObj(value)) {
            errors.push(`${rp}: ожидается объект`)
            continue
        }
        const r = value
        for (const key of Object.keys(r)) if (!RELEASE_KEYS.has(key)) errors.push(`${rp}: лишнее поле «${key}»`)
        if (r.type !== 'album' && r.type !== 'single') errors.push(`${rp}: type должен быть album или single`)
        if (typeof r.title !== 'string' || !r.title.trim()) errors.push(`${rp}: пустое название`)
        if (typeof r.year !== 'string' || !/^\d{4}$/.test(r.year)) errors.push(`${rp}: year — 4 цифры строкой`)
        if (r.releaseDate !== undefined) {
            const m = typeof r.releaseDate === 'string' ? r.releaseDate.match(RELEASE_DATE_RE) : null
            if (!m) errors.push(`${rp}: releaseDate — вида «26 августа 2026»`)
            else if (m[3] !== r.year) errors.push(`${rp}: год в releaseDate не совпадает с year`)
        }
        if (typeof r.cover !== 'string' || !/^images\/[^/]+\.(jpg|jpeg|png)$/i.test(r.cover)) errors.push(`${rp}: cover — файл jpg/png в images/`)
        if (r.lyricsBookPath !== undefined && (typeof r.lyricsBookPath !== 'string' || !/^lyrics-books\/[^/]+\.pdf$/i.test(r.lyricsBookPath))) {
            errors.push(`${rp}: lyricsBookPath — файл pdf в lyrics-books/`)
        }
        if (r.videoUrl !== undefined && (typeof r.videoUrl !== 'string' || !YOUTUBE_EMBED_RE.test(r.videoUrl))) {
            errors.push(`${rp}: videoUrl — https://www.youtube.com/embed/<id>`)
        }
        if (r.upcoming !== undefined && typeof r.upcoming !== 'boolean') errors.push(`${rp}: upcoming — true/false`)
        if (typeof r.audioPath !== 'string' || !/^audio\/[^/]+\/$/.test(r.audioPath)) errors.push(`${rp}: audioPath — audio/<папка>/`)
        if (typeof r.lyricsPath !== 'string' || !/^lyrics\/[^/]+\/$/.test(r.lyricsPath)) errors.push(`${rp}: lyricsPath — lyrics/<папка>/`)
        if (r.type === 'single') {
            if (r.audioPath !== 'audio/singles/') errors.push(`${rp}: аудио сингла лежит в audio/singles/`)
            if (r.lyricsPath !== 'lyrics/singles/') errors.push(`${rp}: текст сингла лежит в lyrics/singles/`)
        }

        if (!Array.isArray(r.tracks) || r.tracks.length === 0) {
            errors.push(`${rp}: нужен хотя бы один трек`)
            continue
        }
        if (r.type === 'single' && r.tracks.length !== 1) errors.push(`${rp}: у сингла ровно один трек`)
        const slugs = new Set<string>()
        r.tracks.forEach((t: unknown, i: number) => {
            const tp = `${rp}, трек ${i + 1}`
            if (!isObj(t)) {
                errors.push(`${tp}: ожидается объект`)
                return
            }
            for (const key of Object.keys(t)) if (!TRACK_KEYS.has(key)) errors.push(`${tp}: лишнее поле «${key}»`)
            if (t.num !== i + 1) errors.push(`${tp}: num должен быть ${i + 1}`)
            if (typeof t.title !== 'string' || !t.title.trim()) errors.push(`${tp}: пустое название`)
            if (!isFileName(t.file, '.mp3')) errors.push(`${tp}: file — имя mp3 без папки`)
            if (!isFileName(t.lyricsFile, '.txt')) {
                errors.push(`${tp}: lyricsFile — имя .txt без папки`)
                return
            }
            // Slug — адрес страницы трека: два одинаковых в релизе не открыть.
            const slug = getTrackSlug(t as unknown as Track)
            if (slugs.has(slug)) errors.push(`${tp}: адрес трека «${slug}» уже занят в этом релизе`)
            slugs.add(slug)
        })
    }
    // Постоянный id есть у каждого трека, формат верный, повторов нет.
    for (const e of checkTrackIds(registry, true)) errors.push(`${p}: ${e}`)
    return registry
}

export function checkContent(root: string): ContentReport {
    const errors: string[] = []
    const files = listFiles(root)
    const has = (rel: string) => files.has(rel)
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n?/g, '\n')

    const registry = checkRegistry(readJson(root, 'src/content/releases.json', errors), errors)
    const site = readJson(root, 'src/content/site.json', errors)
    if (site !== undefined) for (const e of validateSiteSettings(site, registry)) errors.push(e.startsWith('site.json') ? `src/content/${e}` : `src/content/site.json: ${e}`)

    // Ссылки реестра и site.json на файлы.
    const used = new Map<string, string>()
    const need = (rel: unknown, what: string, allowEmptyCheck = true) => {
        if (typeof rel !== 'string') return
        if (!has(rel)) errors.push(`${what}: нет файла ${rel}`)
        else if (allowEmptyCheck && fs.statSync(path.join(root, rel)).size === 0) errors.push(`${what}: пустой файл ${rel}`)
        const other = used.get(rel)
        if (other && other !== what && !rel.startsWith('images/')) errors.push(`${what}: файл ${rel} уже занят (${other})`)
        used.set(rel, what)
    }
    let tracks = 0
    for (const [id, value] of Object.entries(registry)) {
        if (!isObj(value)) continue
        const rp = `релиз «${id}»`
        need(value.cover, `${rp}: обложка`)
        need(value.lyricsBookPath, `${rp}: PDF`)
        if (!Array.isArray(value.tracks) || typeof value.audioPath !== 'string' || typeof value.lyricsPath !== 'string') continue
        // У анонсированного релиза файлов треков ещё может не быть.
        if (value.upcoming === true) continue
        value.tracks.forEach((t: unknown, i: number) => {
            if (!isObj(t)) return
            tracks++
            const tp = `${rp}, трек ${i + 1}`
            if (typeof t.file === 'string') need(value.audioPath + t.file, `${tp}: mp3`)
            // Пустой текст допустим: на сайте будет «Текст будет позже...».
            if (typeof t.lyricsFile === 'string') need(value.lyricsPath + t.lyricsFile, `${tp}: текст`, false)
        })
    }
    if (isObj(site) && isObj(site.announce)) need(site.announce.cover, 'site.json: обложка анонса')

    // Разборы: валидный JSON по схеме и ни одного висящего.
    let notes = 0
    let lrc = 0
    for (const rel of [...files].sort()) {
        if (!rel.startsWith('lyrics/')) continue
        if (rel.endsWith('.notes.json')) {
            notes++
            let value: unknown
            try {
                value = JSON.parse(read(rel))
            } catch (e) {
                errors.push(`${rel}: битый JSON — ${(e as Error).message}`)
                continue
            }
            const schema = validateTrackNotes(value)
            if (schema.length) {
                errors.push(...schema.map((e) => `${rel}: ${e}`))
                continue
            }
            const txt = rel.replace(/\.notes\.json$/, '.txt')
            if (!has(txt)) {
                errors.push(`${rel}: нет файла текста ${txt}`)
                continue
            }
            for (const a of findDanglingAnnotations(read(txt), value as TrackNotes)) errors.push(`${rel}: висящий разбор — строки «${a.line}» нет в тексте`)
        } else if (rel.toLowerCase().endsWith('.lrc')) {
            lrc++
            const lines = read(rel).split('\n').map((l) => l.trim()).filter(Boolean)
            if (!lines.length) errors.push(`${rel}: пустой .lrc`)
            lines.forEach((line, i) => {
                if (!LRC_LINE_RE.test(line)) errors.push(`${rel}: строка ${i + 1} без метки времени [mm:ss.xx]: «${line.slice(0, 60)}»`)
            })
            const txt = rel.replace(/\.lrc$/i, '.txt')
            if (!has(txt)) errors.push(`${rel}: нет файла текста ${txt}`)
        }
    }

    return { errors, stats: { releases: Object.keys(registry).length, tracks, notes, lrc } }
}
