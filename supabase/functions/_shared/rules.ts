/**
 * Правила контента, общие для Edge Function `admin-content` и админки.
 *
 * Файл без зависимостей и без Deno-API: его импортирует функция (Deno),
 * админка (Vite) и юнит-тесты (Vitest). Функция — последняя линия
 * обороны: всё, что здесь запрещено, она не закоммитит, что бы ни прислал
 * браузер.
 */

// ── Пути и файлы ───────────────────────────────────────────────────────

export type FileKind = 'text' | 'binary'

export interface PathRule {
    kind: FileKind
    maxBytes: number
}

const MB = 1024 * 1024

// Расширение → правило. Текстовые файлы приходят в функцию строкой,
// бинарные — через staging-бакет в Supabase Storage.
const LYRICS_RULES: Record<string, PathRule> = {
    '.txt': { kind: 'text', maxBytes: 512 * 1024 },
    '.lrc': { kind: 'text', maxBytes: 512 * 1024 },
    '.notes.json': { kind: 'text', maxBytes: 512 * 1024 }
}
const AUDIO_RULES: Record<string, PathRule> = { '.mp3': { kind: 'binary', maxBytes: 30 * MB } }
const IMAGE_RULES: Record<string, PathRule> = {
    '.jpg': { kind: 'binary', maxBytes: 5 * MB },
    '.jpeg': { kind: 'binary', maxBytes: 5 * MB },
    '.png': { kind: 'binary', maxBytes: 5 * MB }
}
const BOOK_RULES: Record<string, PathRule> = { '.pdf': { kind: 'binary', maxBytes: 30 * MB } }
const CONTENT_RULES: Record<string, PathRule> = { '.json': { kind: 'text', maxBytes: 512 * 1024 } }

export const STAGING_MIME_TYPES = ['audio/mpeg', 'image/jpeg', 'image/png', 'application/pdf']

function matchExtension(name: string, rules: Record<string, PathRule>): PathRule | null {
    const lower = name.toLowerCase()
    // Длинные расширения раньше коротких: «.notes.json» не должен
    // проиграть простому «.json».
    const exts = Object.keys(rules).sort((a, b) => b.length - a.length)
    for (const ext of exts) {
        if (lower.endsWith(ext) && lower.length > ext.length) return rules[ext]
    }
    return null
}

/**
 * Проверяет путь по белому списку. Возвращает правило или текст ошибки.
 *   lyrics/**            .txt .lrc .notes.json
 *   audio/**             .mp3
 *   images/**            .jpg .jpeg .png
 *   lyrics-books/**      .pdf
 *   src/content/*.json   только файлы прямо в папке
 */
export function checkPath(path: unknown): { ok: true; rule: PathRule } | { ok: false; error: string } {
    if (typeof path !== 'string' || !path) return { ok: false, error: 'пустой путь' }
    if (path.length > 300) return { ok: false, error: 'слишком длинный путь' }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f\\]/.test(path)) return { ok: false, error: 'недопустимые символы в пути' }
    const segments = path.split('/')
    if (segments.some((s) => !s || s === '.' || s === '..' || s.startsWith('.') || s !== s.trim())) {
        return { ok: false, error: 'недопустимый сегмент пути' }
    }
    const [top] = segments
    const name = segments[segments.length - 1]
    let rules: Record<string, PathRule> | null = null
    if (top === 'lyrics' && segments.length >= 2) rules = LYRICS_RULES
    else if (top === 'audio' && segments.length >= 2) rules = AUDIO_RULES
    else if (top === 'images' && segments.length >= 2) rules = IMAGE_RULES
    else if (top === 'lyrics-books' && segments.length >= 2) rules = BOOK_RULES
    else if (top === 'src' && segments[1] === 'content' && segments.length === 3) rules = CONTENT_RULES
    if (!rules) return { ok: false, error: `путь вне разрешённых папок: ${path}` }
    const rule = matchExtension(name, rules)
    if (!rule) return { ok: false, error: `недопустимое расширение файла: ${path}` }
    return { ok: true, rule }
}

// ── .notes.json ────────────────────────────────────────────────────────

/** Ошибки в содержимом .notes.json (пустой список — всё в порядке). */
export function validateTrackNotes(value: unknown): string[] {
    const errors: string[] = []
    if (!value || typeof value !== 'object' || Array.isArray(value)) return ['ожидается объект']
    const obj = value as Record<string, unknown>
    for (const key of Object.keys(obj)) {
        if (key !== 'about' && key !== 'annotations') errors.push(`лишнее поле «${key}»`)
    }
    if (obj.about !== undefined && typeof obj.about !== 'string') errors.push('«about» должно быть строкой')
    if (obj.annotations !== undefined) {
        if (!Array.isArray(obj.annotations)) errors.push('«annotations» должно быть списком')
        else
            obj.annotations.forEach((item, i) => {
                const a = item as Record<string, unknown>
                if (!a || typeof a !== 'object') {
                    errors.push(`разбор #${i + 1}: ожидается объект`)
                    return
                }
                if (typeof a.line !== 'string' || !a.line.trim()) errors.push(`разбор #${i + 1}: пустая строка`)
                if (typeof a.note !== 'string' || !a.note.trim()) errors.push(`разбор #${i + 1}: пустой текст разбора`)
            })
    }
    return errors
}

// ── Реестр релизов ─────────────────────────────────────────────────────

export interface RegistryTrack {
    num: number
    title: string
    file: string
    lyricsFile: string
}

export interface RegistryRelease {
    type: 'album' | 'single'
    title: string
    year: string
    releaseDate?: string
    cover: string
    audioPath: string
    lyricsPath: string
    lyricsBookPath?: string
    videoUrl?: string
    upcoming?: boolean
    tracks: RegistryTrack[]
}

export type Registry = Record<string, RegistryRelease>

export const RU_MONTHS_GENITIVE = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
]

export const RELEASE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RELEASE_DATE_RE = new RegExp(`^([1-9]|[12]\\d|3[01]) (${RU_MONTHS_GENITIVE.join('|')}) (\\d{4})$`)
const YOUTUBE_EMBED_RE = /^https:\/\/www\.youtube\.com\/embed\/[\w-]{6,20}$/

const RELEASE_KEYS = new Set([
    'type', 'title', 'year', 'releaseDate', 'cover', 'audioPath', 'lyricsPath',
    'lyricsBookPath', 'videoUrl', 'upcoming', 'tracks'
])
const TRACK_KEYS = new Set(['num', 'title', 'file', 'lyricsFile'])

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>
        return `{${Object.keys(obj)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
            .join(',')}}`
    }
    return JSON.stringify(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Проверяет запись нового релиза по соглашениям проекта:
 * альбом — audio/<папка>/, lyrics/<папка>/, тексты NN-slug.txt;
 * сингл — audio/singles/, lyrics/singles/, текст slug.txt, один трек.
 */
export function validateNewRelease(id: string, value: unknown): string[] {
    const errors: string[] = []
    const p = `релиз «${id}»`
    if (!RELEASE_ID_RE.test(id)) errors.push(`${p}: id может содержать только a-z, 0-9 и дефисы`)
    if (!isPlainObject(value)) return [...errors, `${p}: ожидается объект`]
    const r = value as Record<string, unknown>
    for (const key of Object.keys(r)) if (!RELEASE_KEYS.has(key)) errors.push(`${p}: лишнее поле «${key}»`)

    if (r.type !== 'album' && r.type !== 'single') errors.push(`${p}: тип должен быть album или single`)
    if (typeof r.title !== 'string' || !r.title.trim()) errors.push(`${p}: пустое название`)
    if (typeof r.year !== 'string' || !/^\d{4}$/.test(r.year)) errors.push(`${p}: год должен быть из 4 цифр`)
    if (r.releaseDate !== undefined) {
        const m = typeof r.releaseDate === 'string' ? r.releaseDate.match(RELEASE_DATE_RE) : null
        if (!m) errors.push(`${p}: дата должна быть вида «26 августа 2026»`)
        else if (m[3] !== r.year) errors.push(`${p}: год в дате не совпадает с полем year`)
    }
    if (typeof r.cover !== 'string' || !/^images\/[a-z0-9-]+\.(jpg|jpeg|png)$/.test(r.cover)) {
        errors.push(`${p}: обложка должна лежать в images/ и называться латиницей`)
    }
    if (r.lyricsBookPath !== undefined && (typeof r.lyricsBookPath !== 'string' || !/^lyrics-books\/[a-z0-9-]+\.pdf$/.test(r.lyricsBookPath))) {
        errors.push(`${p}: PDF должен лежать в lyrics-books/ и называться латиницей`)
    }
    if (r.videoUrl !== undefined && (typeof r.videoUrl !== 'string' || !YOUTUBE_EMBED_RE.test(r.videoUrl))) {
        errors.push(`${p}: ссылка на видео должна быть вида https://www.youtube.com/embed/<id>`)
    }
    if (r.upcoming !== undefined && typeof r.upcoming !== 'boolean') errors.push(`${p}: upcoming должно быть true/false`)

    const isSingle = r.type === 'single'
    if (isSingle) {
        if (r.audioPath !== 'audio/singles/') errors.push(`${p}: аудио сингла лежит в audio/singles/`)
        if (r.lyricsPath !== 'lyrics/singles/') errors.push(`${p}: текст сингла лежит в lyrics/singles/`)
    } else {
        if (typeof r.audioPath !== 'string' || !/^audio\/[a-z0-9-]+\/$/.test(r.audioPath) || r.audioPath === 'audio/singles/') {
            errors.push(`${p}: папка аудио альбома — audio/<латиница без пробелов>/`)
        }
        if (typeof r.lyricsPath !== 'string' || !/^lyrics\/[a-z0-9-]+\/$/.test(r.lyricsPath) || r.lyricsPath === 'lyrics/singles/') {
            errors.push(`${p}: папка текстов альбома — lyrics/<латиница без пробелов>/`)
        }
    }

    if (!Array.isArray(r.tracks) || r.tracks.length === 0) {
        errors.push(`${p}: нужен хотя бы один трек`)
        return errors
    }
    if (isSingle && r.tracks.length !== 1) errors.push(`${p}: у сингла ровно один трек`)
    const slugs = new Set<string>()
    r.tracks.forEach((t, i) => {
        const tp = `${p}, трек ${i + 1}`
        if (!isPlainObject(t)) {
            errors.push(`${tp}: ожидается объект`)
            return
        }
        for (const key of Object.keys(t)) if (!TRACK_KEYS.has(key)) errors.push(`${tp}: лишнее поле «${key}»`)
        if (t.num !== i + 1) errors.push(`${tp}: номер должен быть ${i + 1}`)
        if (typeof t.title !== 'string' || !t.title.trim()) errors.push(`${tp}: пустое название`)
        if (typeof t.file !== 'string' || !/^[a-z0-9-]+\.mp3$/.test(t.file)) errors.push(`${tp}: mp3 должен называться <slug>.mp3 латиницей`)
        // Ведущий «NN-» сайт срезает из slug, поэтому у сингла его быть не должно.
        const lyricsRe = isSingle ? /^(?!\d+-)([a-z0-9-]+)\.txt$/ : /^(\d{2})-([a-z0-9-]+)\.txt$/
        const m = typeof t.lyricsFile === 'string' ? t.lyricsFile.match(lyricsRe) : null
        if (!m) {
            errors.push(`${tp}: файл текста — ${isSingle ? 'slug.txt' : 'NN-slug.txt'}`)
            return
        }
        if (!isSingle && Number(m[1]) !== i + 1) errors.push(`${tp}: номер в имени файла текста должен быть ${String(i + 1).padStart(2, '0')}`)
        const slug = isSingle ? m[1] : m[2]
        if (!SLUG_RE.test(slug)) errors.push(`${tp}: slug может содержать только a-z, 0-9 и дефисы`)
        if (slugs.has(slug)) errors.push(`${tp}: slug «${slug}» уже есть в релизе`)
        slugs.add(slug)
    })
    return errors
}

/**
 * Защита статистики: ключ прослушиваний — «<releaseId>-<индекс трека>»,
 * поэтому существующие релизы нельзя ни менять, ни удалять, ни
 * переставлять в них треки. Разрешено только добавить новый релиз.
 */
export function checkRegistryChange(before: unknown, after: unknown): string[] {
    if (!isPlainObject(before)) return ['текущий releases.json повреждён']
    if (!isPlainObject(after)) return ['releases.json должен быть объектом']
    const errors: string[] = []

    for (const [id, release] of Object.entries(before)) {
        if (!(id in after)) {
            errors.push(`релиз «${id}» нельзя удалить или переименовать — это перепутает прослушивания`)
            continue
        }
        const oldTracks = isPlainObject(release) && Array.isArray(release.tracks) ? release.tracks : []
        const next = after[id]
        const newTracks = isPlainObject(next) && Array.isArray(next.tracks) ? next.tracks : []
        if (newTracks.length !== oldTracks.length) {
            errors.push(`релиз «${id}»: нельзя добавлять или удалять треки`)
        } else {
            oldTracks.forEach((t, i) => {
                if (stableStringify(t) !== stableStringify(newTracks[i])) {
                    errors.push(`релиз «${id}»: трек ${i + 1} нельзя менять или переставлять`)
                }
            })
        }
        const { tracks: _a, ...oldRest } = release as Record<string, unknown>
        const { tracks: _b, ...newRest } = (isPlainObject(next) ? next : {}) as Record<string, unknown>
        if (stableStringify(oldRest) !== stableStringify(newRest)) {
            errors.push(`релиз «${id}»: существующие релизы в админке не редактируются`)
        }
    }

    // Порядок старых ключей сохраняется: он задаёт порядок карточек на главной.
    const oldIds = Object.keys(before)
    const keptOrder = Object.keys(after).filter((id) => id in before)
    if (errors.length === 0 && keptOrder.join('\n') !== oldIds.join('\n')) {
        errors.push('нельзя менять порядок существующих релизов')
    }

    const newIds = Object.keys(after).filter((id) => !(id in before))
    for (const id of newIds) errors.push(...validateNewRelease(id, after[id]))

    // Файлы нового релиза не должны совпадать с файлами других релизов
    // (синглы делят общие папки).
    if (errors.length === 0 && newIds.length) {
        const reg = after as Registry
        const owner = new Map<string, string>()
        const claim = (path: string, id: string) => {
            const prev = owner.get(path)
            if (prev) errors.push(`файл ${path} уже занят релизом «${prev}»`)
            else owner.set(path, id)
        }
        // Сначала занимаем файлы существующих релизов, потом проверяем новые.
        for (const id of [...oldIds, ...newIds]) {
            const rel = reg[id]
            const isNew = newIds.includes(id)
            for (const path of [rel.cover, ...rel.tracks.flatMap((t) => [rel.audioPath + t.file, rel.lyricsPath + t.lyricsFile])]) {
                if (isNew) claim(path, id)
                else owner.set(path, id)
            }
        }
        // У альбома своя папка: класть его в чужую нельзя.
        for (const id of newIds) {
            const rel = reg[id]
            if (rel.type !== 'album') continue
            for (const other of Object.keys(reg)) {
                if (other === id) continue
                if (reg[other].audioPath === rel.audioPath) errors.push(`папка ${rel.audioPath} уже занята релизом «${other}»`)
                if (reg[other].lyricsPath === rel.lyricsPath) errors.push(`папка ${rel.lyricsPath} уже занята релизом «${other}»`)
            }
        }
    }
    return errors
}

// ── site.json ──────────────────────────────────────────────────────────

export interface SiteSettingsData {
    promo: { enabled: boolean; releaseId: string }
}

export function validateSiteSettings(value: unknown, registry: unknown): string[] {
    if (!isPlainObject(value)) return ['site.json должен быть объектом']
    const errors: string[] = []
    for (const key of Object.keys(value)) if (key !== 'promo') errors.push(`site.json: лишнее поле «${key}»`)
    const promo = value.promo
    if (!isPlainObject(promo)) return [...errors, 'site.json: нет блока promo']
    for (const key of Object.keys(promo)) {
        if (key !== 'enabled' && key !== 'releaseId') errors.push(`site.json: лишнее поле promo.${key}`)
    }
    if (typeof promo.enabled !== 'boolean') errors.push('site.json: promo.enabled должно быть true/false')
    if (typeof promo.releaseId !== 'string' || !isPlainObject(registry) || !(promo.releaseId in registry)) {
        errors.push('site.json: promo.releaseId должен быть id существующего релиза')
    }
    return errors
}
