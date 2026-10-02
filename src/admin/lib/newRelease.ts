import type { Releases } from '@/types'
import {
    RELEASE_ID_RE,
    SLUG_RE,
    checkRegistryChange,
    type Registry,
    type RegistryRelease
} from '../../../supabase/functions/_shared/rules.ts'
import { formatRuDate, isValidIsoDate, type IsoDate } from './dates'

/**
 * Новый релиз: транслитерация, имена файлов по соглашениям проекта и
 * проверка, что в реестре меняется только добавление этого релиза.
 *
 *   альбом: audio/albumN/<slug>.mp3, lyrics/albumN/NN-<slug>.txt,
 *           images/albumN-cover.jpg, lyrics-books/<id>.pdf
 *   сингл:  audio/singles/<slug>.mp3, lyrics/singles/<slug>.txt,
 *           images/singleN-cover.jpg, lyrics-books/<id>.pdf
 */

const MAP: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}

export function transliterate(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        // Диакритика латиницы (Última → ultima); «й» и «ё» собираем обратно.
        .replace(/й/g, 'й')
        .replace(/ё/g, 'ё')
        .replace(/[̀-ͯ]/g, '')
        .split('')
        .map((ch) => MAP[ch] ?? ch)
        .join('')
        // «первый» → pervyy → pervy, как в существующих slug (mezhdunarodny).
        .replace(/yy/g, 'y')
}

export function slugify(text: string, maxLength = 60): string {
    const slug = transliterate(text)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    return slug.slice(0, maxLength).replace(/-+$/g, '')
}

export function uniqueId(base: string, taken: Set<string>): string {
    const root = base || 'release'
    if (!taken.has(root)) return root
    for (let i = 2; ; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`
}

/** Номер для новой папки albumN / обложки singleN: больше любого занятого. */
export function nextNumber(kind: 'album' | 'single', releases: Releases, files: { path: string }[]): number {
    const re = kind === 'album' ? /(?:^|\/)album\s?(\d+)(?:[/-]|$)/ : /(?:^|\/)single(\d+)-/
    let max = 0
    const scan = (p: string) => {
        const m = p.match(re)
        if (m) max = Math.max(max, Number(m[1]))
    }
    for (const r of Object.values(releases)) [r.audioPath, r.lyricsPath, r.cover, r.lyricsBookPath ?? ''].forEach(scan)
    files.forEach((f) => scan(f.path))
    return max + 1
}

/** Любая ссылка на ролик YouTube → https://www.youtube.com/embed/<id>. */
export function youtubeEmbed(url: string): string | null {
    const s = url.trim()
    if (!s) return null
    const m =
        s.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]{6,20})/) ||
        s.match(/^https?:\/\/youtu\.be\/([\w-]{6,20})/) ||
        s.match(/^https?:\/\/(?:www\.)?youtube\.com\/(?:embed|shorts|live)\/([\w-]{6,20})/)
    return m ? `https://www.youtube.com/embed/${m[1]}` : null
}

export interface TrackDraft {
    title: string
    slug: string
    audio: { name: string; size: number } | null
}

export interface ReleaseDraft {
    type: 'album' | 'single'
    title: string
    id: string
    date: IsoDate
    cover: { name: string; size: number; width: number; height: number } | null
    youtube: string
    pdf: { name: string; size: number } | null
    tracks: TrackDraft[]
}

export interface PlannedRelease {
    id: string
    release: RegistryRelease
    /** Куда лягут файлы (для медиа — пары «трек → путь»). */
    paths: {
        cover: string
        pdf: string | null
        tracks: { audio: string; txt: string }[]
    }
}

export function planRelease(draft: ReleaseDraft, releases: Releases, files: { path: string }[]): PlannedRelease {
    const isAlbum = draft.type === 'album'
    const n = nextNumber(draft.type, releases, files)
    const audioPath = isAlbum ? `audio/album${n}/` : 'audio/singles/'
    const lyricsPath = isAlbum ? `lyrics/album${n}/` : 'lyrics/singles/'
    const cover = isAlbum ? `images/album${n}-cover.jpg` : `images/single${n}-cover.jpg`
    const pdf = draft.pdf ? `lyrics-books/${draft.id}.pdf` : null
    const tracks = draft.tracks.map((t, i) => ({
        num: i + 1,
        title: t.title.trim(),
        file: `${t.slug}.mp3`,
        lyricsFile: isAlbum ? `${String(i + 1).padStart(2, '0')}-${t.slug}.txt` : `${t.slug}.txt`
    }))
    const release: RegistryRelease = {
        type: draft.type,
        title: draft.title.trim(),
        year: draft.date.slice(0, 4),
        releaseDate: isValidIsoDate(draft.date) ? formatRuDate(draft.date) : draft.date,
        cover,
        audioPath,
        lyricsPath,
        ...(pdf ? { lyricsBookPath: pdf } : {}),
        ...(youtubeEmbed(draft.youtube) ? { videoUrl: youtubeEmbed(draft.youtube)! } : {}),
        tracks
    }
    return {
        id: draft.id,
        release,
        paths: {
            cover,
            pdf,
            tracks: tracks.map((t) => ({ audio: audioPath + t.file, txt: lyricsPath + t.lyricsFile }))
        }
    }
}

/** Новый реестр: все существующие релизы как есть + новый в конце. */
export function appendRelease(releases: Releases, plan: PlannedRelease): Releases {
    return { ...releases, [plan.id]: plan.release } as Releases
}

export const COVER_MIN_SIDE = 600
export const COVER_MAX_BYTES = 5 * 1024 * 1024
export const MP3_MAX_BYTES = 30 * 1024 * 1024
export const PDF_MAX_BYTES = 30 * 1024 * 1024

/** Ошибки черновика (пустой список — можно публиковать). */
export function validateDraft(draft: ReleaseDraft, releases: Releases, files: { path: string }[]): string[] {
    const errors: string[] = []
    if (!draft.title.trim()) errors.push('Укажи название релиза')
    if (!RELEASE_ID_RE.test(draft.id)) errors.push('ID — латиница, цифры и дефисы, например zlaya-nostalgia')
    else if (draft.id in releases) errors.push(`Релиз с ID «${draft.id}» уже есть`)
    if (!isValidIsoDate(draft.date)) errors.push('Укажи дату релиза')

    if (!draft.cover) errors.push('Добавь обложку (jpg)')
    else {
        const { width, height, size } = draft.cover
        if (Math.abs(width - height) > Math.max(width, height) * 0.01) errors.push(`Обложка должна быть квадратной (сейчас ${width}×${height})`)
        if (Math.min(width, height) < COVER_MIN_SIDE) errors.push(`Обложка слишком маленькая: нужно от ${COVER_MIN_SIDE}×${COVER_MIN_SIDE}`)
        if (size > COVER_MAX_BYTES) errors.push('Обложка больше 5 МБ')
    }
    if (draft.youtube.trim() && !youtubeEmbed(draft.youtube)) errors.push('Не получилось распознать ссылку на YouTube')
    if (draft.pdf && draft.pdf.size > PDF_MAX_BYTES) errors.push('PDF больше 30 МБ')

    if (!draft.tracks.length) errors.push('Добавь хотя бы один трек')
    if (draft.type === 'single' && draft.tracks.length > 1) errors.push('У сингла ровно один трек')
    const slugs = new Map<string, number>()
    draft.tracks.forEach((t, i) => {
        const p = `Трек ${i + 1}`
        if (!t.title.trim()) errors.push(`${p}: нет названия`)
        if (!t.audio) errors.push(`${p}: нет mp3`)
        else if (t.audio.size > MP3_MAX_BYTES) errors.push(`${p}: mp3 больше 30 МБ`)
        if (!SLUG_RE.test(t.slug)) errors.push(`${p}: slug — латиница, цифры и дефисы`)
        else if (slugs.has(t.slug)) errors.push(`${p}: slug «${t.slug}» уже у трека ${slugs.get(t.slug)! + 1}`)
        slugs.set(t.slug, i)
    })
    if (errors.length) return errors

    // Итоговая проверка — та же, что сделает функция при коммите:
    // существующие релизы и их треки не меняются, файлы не заняты.
    const plan = planRelease(draft, releases, files)
    const taken = new Set(files.map((f) => f.path))
    for (const p of [plan.paths.cover, plan.paths.pdf, ...plan.paths.tracks.flatMap((t) => [t.audio, t.txt])]) {
        if (p && taken.has(p)) errors.push(`Файл ${p} уже есть в репозитории — поменяй slug`)
    }
    errors.push(...checkRegistryChange(releases as unknown as Registry, appendRelease(releases, plan) as unknown as Registry))
    return errors
}
