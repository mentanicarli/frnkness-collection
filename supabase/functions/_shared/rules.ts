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
    /**
     * Постоянный id трека «<releaseId>/<slug>». Если у всех треков реестра
     * есть id, он обязателен и у треков нового релиза; если хотя бы у одного
     * трека реестра его нет, новый релиз можно добавить и без id.
     */
    id?: string
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
const TRACK_KEYS = new Set(['num', 'title', 'file', 'lyricsFile', 'id'])

// ── Постоянные id треков ───────────────────────────────────────────────
//
// id — «<releaseId>/<slug>» на момент создания трека; дальше он не меняется,
// даже если поменять название. На него ссылаются избранное, плейлисты и
// комнаты. Статистика пока считается по старому ключу «<releaseId>-<индекс>».

export const TRACK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/

export function makeTrackId(releaseId: string, slug: string): string {
    return `${releaseId}/${slug}`
}

/** У всех треков реестра есть постоянные id. */
export function registryHasTrackIds(registry: unknown): boolean {
    if (!isPlainObject(registry)) return false
    const releases = Object.values(registry)
    return releases.length > 0 && releases.every((r) =>
        isPlainObject(r) && Array.isArray(r.tracks) && r.tracks.every((t) => isPlainObject(t) && typeof t.id === 'string'))
}

/**
 * id треков во всём реестре: формат, префикс — id своего релиза, без
 * повторов. Трек без id — ошибка, только если requireIds.
 */
export function checkTrackIds(registry: unknown, requireIds: boolean): string[] {
    if (!isPlainObject(registry)) return []
    const errors: string[] = []
    const seen = new Map<string, string>()
    for (const [releaseId, release] of Object.entries(registry)) {
        if (!isPlainObject(release) || !Array.isArray(release.tracks)) continue
        release.tracks.forEach((t, i) => {
            if (!isPlainObject(t)) return
            const tp = `релиз «${releaseId}», трек ${i + 1}`
            if (t.id === undefined) {
                if (requireIds) errors.push(`${tp}: нет id`)
                return
            }
            if (typeof t.id !== 'string' || !TRACK_ID_RE.test(t.id)) {
                errors.push(`${tp}: id должен быть вида <id релиза>/<slug> латиницей`)
                return
            }
            if (!t.id.startsWith(releaseId + '/')) errors.push(`${tp}: id «${t.id}» должен начинаться с «${releaseId}/»`)
            const prev = seen.get(t.id)
            if (prev) errors.push(`${tp}: id «${t.id}» уже занят (${prev})`)
            else seen.set(t.id, tp)
        })
    }
    return errors
}

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
        if (t.id !== undefined && t.id !== makeTrackId(id, slug)) errors.push(`${tp}: id должен быть «${makeTrackId(id, slug)}»`)
    })
    return errors
}

/**
 * Поля существующего релиза, которые можно менять: они не участвуют в ключе
 * статистики и не задают расположение файлов треков.
 */
export const EDITABLE_RELEASE_FIELDS = new Set(['title', 'releaseDate', 'year', 'cover', 'videoUrl', 'lyricsBookPath'])

/**
 * Проверяет правку существующего релиза. Старые значения (в том числе имена
 * файлов не по нынешним правилам) допустимы, если их не трогали.
 */
export function validateReleaseEdit(id: string, before: Record<string, unknown>, after: Record<string, unknown>): string[] {
    const errors: string[] = []
    const p = `релиз «${id}»`
    const changed = (key: string) => stableStringify(before[key]) !== stableStringify(after[key])
    if (changed('title') && (typeof after.title !== 'string' || !after.title.trim())) errors.push(`${p}: пустое название`)
    if (changed('year') || changed('releaseDate')) {
        if (typeof after.year !== 'string' || !/^\d{4}$/.test(after.year)) errors.push(`${p}: год должен быть из 4 цифр`)
        if (after.releaseDate !== undefined) {
            const m = typeof after.releaseDate === 'string' ? after.releaseDate.match(RELEASE_DATE_RE) : null
            if (!m) errors.push(`${p}: дата должна быть вида «26 августа 2026»`)
            else if (m[3] !== after.year) errors.push(`${p}: год в дате не совпадает с полем year`)
        }
    }
    if (changed('cover') && (typeof after.cover !== 'string' || !/^images\/[a-z0-9-]+\.(jpg|jpeg|png)$/.test(after.cover))) {
        errors.push(`${p}: обложка должна лежать в images/ и называться латиницей`)
    }
    if (changed('lyricsBookPath') && after.lyricsBookPath !== undefined &&
        (typeof after.lyricsBookPath !== 'string' || !/^lyrics-books\/[a-z0-9-]+\.pdf$/.test(after.lyricsBookPath))) {
        errors.push(`${p}: PDF должен лежать в lyrics-books/ и называться латиницей`)
    }
    if (changed('videoUrl') && after.videoUrl !== undefined && (typeof after.videoUrl !== 'string' || !YOUTUBE_EMBED_RE.test(after.videoUrl))) {
        errors.push(`${p}: ссылка на видео должна быть вида https://www.youtube.com/embed/<id>`)
    }
    return errors
}

/** Все пути, на которые ссылается реестр (обложки, PDF, файлы треков). */
export function registryPaths(registry: unknown): Set<string> {
    const out = new Set<string>()
    if (!isPlainObject(registry)) return out
    for (const r of Object.values(registry)) {
        if (!isPlainObject(r)) continue
        if (typeof r.cover === 'string') out.add(r.cover)
        if (typeof r.lyricsBookPath === 'string') out.add(r.lyricsBookPath)
        if (Array.isArray(r.tracks) && typeof r.audioPath === 'string' && typeof r.lyricsPath === 'string') {
            for (const t of r.tracks) {
                if (!isPlainObject(t)) continue
                if (typeof t.file === 'string') out.add(r.audioPath + t.file)
                if (typeof t.lyricsFile === 'string') out.add(r.lyricsPath + t.lyricsFile)
            }
        }
    }
    return out
}

/** Пути медиа, которыми владеет site.json (обложка анонса). */
export function sitePaths(site: unknown): Set<string> {
    const out = new Set<string>()
    if (isPlainObject(site) && isPlainObject(site.announce) && typeof site.announce.cover === 'string') out.add(site.announce.cover)
    return out
}

/**
 * Удалять файлы можно только заменяемые: обложку или PDF релиза (или
 * обложку анонса), на которые ссылалась прежняя версия и больше не ссылается
 * новая. Так из админки нельзя удалить mp3, тексты или чужие файлы.
 */
export function checkDeletions(
    paths: string[],
    before: { registry: unknown; site: unknown },
    after: { registry: unknown; site: unknown }
): string[] {
    const errors: string[] = []
    const replaceable = new Set<string>()
    if (isPlainObject(before.registry)) {
        for (const r of Object.values(before.registry)) {
            if (!isPlainObject(r)) continue
            if (typeof r.cover === 'string') replaceable.add(r.cover)
            if (typeof r.lyricsBookPath === 'string') replaceable.add(r.lyricsBookPath)
        }
    }
    for (const p of sitePaths(before.site)) replaceable.add(p)
    const stillUsed = new Set([...registryPaths(after.registry), ...sitePaths(after.site)])
    for (const p of paths) {
        if (!replaceable.has(p)) errors.push(`удалять можно только заменяемую обложку или PDF: ${p}`)
        else if (stillUsed.has(p)) errors.push(`файл ещё используется, удалять нельзя: ${p}`)
    }
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
        let edited = false
        for (const key of new Set([...Object.keys(oldRest), ...Object.keys(newRest)])) {
            if (stableStringify(oldRest[key]) === stableStringify(newRest[key])) continue
            if (EDITABLE_RELEASE_FIELDS.has(key)) edited = true
            else errors.push(`релиз «${id}»: поле «${key}» менять нельзя`)
        }
        if (edited && isPlainObject(next)) errors.push(...validateReleaseEdit(id, release as Record<string, unknown>, next))
        // Новая обложка или PDF не должны совпасть с файлами другого релиза.
        if (edited && isPlainObject(next)) {
            for (const key of ['cover', 'lyricsBookPath'] as const) {
                const path = next[key]
                if (typeof path !== 'string' || path === (release as Record<string, unknown>)[key]) continue
                for (const [otherId, other] of Object.entries(after)) {
                    if (otherId !== id && isPlainObject(other) && (other.cover === path || other.lyricsBookPath === path)) {
                        errors.push(`релиз «${id}»: файл ${path} уже занят релизом «${otherId}»`)
                    }
                }
            }
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

    // Постоянные id треков. Если у всех треков реестра есть id, он обязателен и
    // у нового релиза; иначе новый релиз можно добавить и без id. id существующих
    // треков менять нельзя — это уже запрещает проверка выше.
    if (newIds.length) {
        const requireIds = registryHasTrackIds(before)
        const newOnly = Object.fromEntries(newIds.map((id) => [id, after[id]]))
        errors.push(...checkTrackIds(newOnly, requireIds).map((e) => requireIds && e.endsWith(': нет id')
            ? `${e} — обнови страницу админки`
            : e))
        if (errors.length === 0) errors.push(...checkTrackIds(after, false))
    }

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

export function validateSiteSettings(value: unknown, registry: unknown): string[] {
    if (!isPlainObject(value)) return ['site.json должен быть объектом']
    const errors: string[] = []
    for (const key of Object.keys(value)) if (key !== 'promo' && key !== 'announce') errors.push(`site.json: лишнее поле «${key}»`)
    const promo = value.promo
    if (!isPlainObject(promo)) return [...errors, 'site.json: нет блока promo']
    for (const key of Object.keys(promo)) {
        if (key !== 'enabled' && key !== 'releaseId') errors.push(`site.json: лишнее поле promo.${key}`)
    }
    if (typeof promo.enabled !== 'boolean') errors.push('site.json: promo.enabled должно быть true/false')
    if (typeof promo.releaseId !== 'string' || !isPlainObject(registry) || !(promo.releaseId in registry)) {
        errors.push('site.json: promo.releaseId должен быть id существующего релиза')
    }
    if (value.announce !== undefined) errors.push(...validateAnnounce(value.announce))
    return errors
}

const ANNOUNCE_KEYS = new Set(['enabled', 'title', 'cover', 'releaseAt', 'text', 'url'])
// Время выхода — по Москве, с явным смещением: «2026-11-01T18:00:00+03:00».
export const ANNOUNCE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+03:00$/

/** Блок анонса в site.json (необязательный — старые файлы без него валидны). */
export function validateAnnounce(value: unknown): string[] {
    const p = 'site.json: announce'
    if (!isPlainObject(value)) return [`${p} должен быть объектом`]
    const errors: string[] = []
    for (const key of Object.keys(value)) if (!ANNOUNCE_KEYS.has(key)) errors.push(`${p}: лишнее поле «${key}»`)
    if (typeof value.enabled !== 'boolean') errors.push(`${p}.enabled должно быть true/false`)
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 120) errors.push(`${p}.title — от 1 до 120 символов`)
    if (typeof value.cover !== 'string' || !/^images\/[a-z0-9-]+\.(jpg|jpeg|png)$/.test(value.cover)) {
        errors.push(`${p}.cover должна лежать в images/ и называться латиницей`)
    }
    // Дата необязательна: без неё на сайте «Скоро» без таймера, анонс висит, пока его не выключат.
    if (value.releaseAt !== undefined && (typeof value.releaseAt !== 'string' || !ANNOUNCE_TIME_RE.test(value.releaseAt) || !Number.isFinite(Date.parse(value.releaseAt)))) {
        errors.push(`${p}.releaseAt — дата и время по Москве вида 2026-11-01T18:00:00+03:00`)
    }
    if (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 400)) errors.push(`${p}.text — до 400 символов`)
    if (value.url !== undefined && (typeof value.url !== 'string' || !/^https:\/\/[^\s"'<>]+$/.test(value.url) || value.url.length > 500)) {
        errors.push(`${p}.url — ссылка https://…`)
    }
    return errors
}
