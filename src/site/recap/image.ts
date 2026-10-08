import { avatarView, initialsOf, type AvatarView } from '@/site/auth/avatars'
import { formatCount, formatDuration } from './format'
import type { Recap, RecapCatalog } from './types'

/**
 * Картинка итогов для сторис: PNG 1080×1920, рисуется в браузере (canvas),
 * без внешних сервисов. Обложки и аватар загружаются через fetch как blob
 * (так canvas не «пачкается» и toBlob работает); аватар не загрузился —
 * рисуем без него, без ошибки. Длинные названия переносятся или
 * обрезаются многоточием.
 */

export const IMAGE_WIDTH = 1080
export const IMAGE_HEIGHT = 1920
const SITE_NAME = 'frnkness.ru'

// ── Текст: перенос и обрезка ───────────────────────────────────────────
export type Measure = (text: string) => number

/** Строка целиком, если помещается, иначе начало с «…» (всегда в пределах maxWidth). */
export function ellipsize(measure: Measure, text: string, maxWidth: number): string {
    const chars = [...text.trim()]
    if (measure(chars.join('')) <= maxWidth) return chars.join('')
    let lo = 0
    let hi = chars.length
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (measure(chars.slice(0, mid).join('').trimEnd() + '…') <= maxWidth) lo = mid
        else hi = mid - 1
    }
    return lo > 0 ? chars.slice(0, lo).join('').trimEnd() + '…' : '…'
}

/**
 * Перенос по словам не больше чем на maxLines строк; то, что не влезло,
 * обрезается многоточием в последней строке. Слово длиннее строки режется.
 */
export function wrapText(measure: Measure, text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.trim().split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let i = 0
    while (i < words.length && lines.length < maxLines) {
        let line = ''
        while (i < words.length) {
            const next = line ? `${line} ${words[i]}` : words[i]
            if (measure(next) > maxWidth) break
            line = next
            i++
        }
        if (!line) {
            // Одно слово шире строки.
            lines.push(ellipsize(measure, words[i], maxWidth))
            i++
            continue
        }
        lines.push(line)
    }
    if (i < words.length && lines.length) {
        const last = lines.length - 1
        lines[last] = ellipsize(measure, `${lines[last]} ${words.slice(i).join(' ')}`, maxWidth)
    }
    return lines.length ? lines : ['']
}

// ── Окружение (подменяется в тестах) ───────────────────────────────────
export type DrawableImage = CanvasImageSource & { width: number; height: number }

export interface CanvasLike {
    width: number
    height: number
    getContext(type: '2d'): CanvasRenderingContext2D | null
    toBlob(callback: (blob: Blob | null) => void, type?: string): void
}

export interface RenderDeps {
    createCanvas(width: number, height: number): CanvasLike
    /** Картинка по адресу или null, если не вышло (ошибки не бросает). */
    loadImage(src: string): Promise<DrawableImage | null>
    /** Шрифты загружены — иначе canvas нарисует запасным. */
    fontsReady(): Promise<void>
}

const IMAGE_TIMEOUT_MS = 8000

async function fetchImage(src: string): Promise<DrawableImage | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
    try {
        const res = await fetch(src, { mode: 'cors', credentials: 'omit', signal: controller.signal })
        if (!res.ok) return null
        const blob = await res.blob()
        if (typeof createImageBitmap === 'function') return await createImageBitmap(blob)
        const url = URL.createObjectURL(blob)
        try {
            return await new Promise<DrawableImage | null>((resolve) => {
                const img = new Image()
                img.onload = () => resolve(img)
                img.onerror = () => resolve(null)
                img.src = url
            })
        } finally {
            URL.revokeObjectURL(url)
        }
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

async function fontsReady(): Promise<void> {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (!fonts) return
    try {
        await Promise.race([
            Promise.all([
                fonts.load('800 100px Unbounded'),
                fonts.load('700 40px Unbounded'),
                fonts.load('600 40px "Golos Text"'),
                fonts.load('400 40px "Golos Text"'),
                fonts.load('500 30px "JetBrains Mono"')
            ]).then(() => fonts.ready),
            new Promise((resolve) => setTimeout(resolve, 5000))
        ])
        await fonts.ready
    } catch {
        // Шрифт не нашёлся — рисуем запасным, картинка всё равно получится.
    }
}

export const browserDeps: RenderDeps = {
    createCanvas(width, height) {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        return canvas
    },
    loadImage: fetchImage,
    fontsReady
}

// ── Рисование ──────────────────────────────────────────────────────────
const DISPLAY = 'Unbounded, "Golos Text", system-ui, sans-serif'
const TEXT = '"Golos Text", system-ui, -apple-system, "Segoe UI", sans-serif'
const MONO = '"JetBrains Mono", ui-monospace, monospace'
const FG = '#ffffff'
const MUTED = '#a7a7ad'
const FAINT = '#6f6f76'
const MARGIN = 90
const CONTENT_W = IMAGE_WIDTH - MARGIN * 2

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
}

/** Картинка в квадрат x,y,size со скруглением; обрезка по центру (cover). */
function drawCover(ctx: CanvasRenderingContext2D, img: DrawableImage, x: number, y: number, size: number, radius: number): void {
    const side = Math.min(img.width, img.height)
    const sx = (img.width - side) / 2
    const sy = (img.height - side) / 2
    ctx.save()
    roundedPath(ctx, x, y, size, size, radius)
    ctx.clip()
    ctx.drawImage(img, sx, sy, side, side, x, y, size, size)
    ctx.restore()
}

function placeholder(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, radius: number): void {
    ctx.save()
    roundedPath(ctx, x, y, size, size, radius)
    ctx.fillStyle = '#1b1b1f'
    ctx.fill()
    ctx.restore()
}

function setFont(ctx: CanvasRenderingContext2D, weight: number | string, size: number, family: string): Measure {
    ctx.font = `${weight} ${size}px ${family}`
    return (s) => ctx.measureText(s).width
}

export interface RenderInput {
    recap: Recap
    catalog: RecapCatalog
}

interface Assets {
    avatar: { view: AvatarView; image: DrawableImage | null } | null
    covers: Map<string, DrawableImage | null>
}

async function loadAssets(input: RenderInput, deps: RenderDeps, coverPaths: string[]): Promise<Assets> {
    const { recap, catalog } = input
    const coverOf = (id: string) => catalog.release(id)?.cover ?? null
    const covers = new Map<string, DrawableImage | null>()
    const tasks: Promise<unknown>[] = []
    for (const path of new Set(coverPaths)) tasks.push(deps.loadImage(path).then((img) => covers.set(path, img)))

    let avatar: Assets['avatar'] = null
    if (recap.user) {
        const view = avatarView(recap.user.avatar, recap.user.nick, recap.user.id, coverOf)
        avatar = { view, image: null }
        if (view.kind === 'img') tasks.push(deps.loadImage(view.src).then((img) => { if (avatar) avatar.image = img }))
    }
    await Promise.all(tasks)
    return { avatar, covers }
}

/** Рисует итоги на canvas 1080×1920 и возвращает PNG. */
export async function renderRecapImage(input: RenderInput, deps: RenderDeps = browserDeps): Promise<Blob> {
    const { recap, catalog } = input
    const top = recap.top_tracks.flatMap((t) => {
        const info = catalog.track(t.track_key)
        return info ? [{ ...info, plays: t.plays }] : []
    }).slice(0, 3)
    const fav = recap.top_release ? catalog.release(recap.top_release.release_id) : null

    await deps.fontsReady()
    const covers = [...top.map((t) => t.cover), fav?.cover].filter((c): c is string => Boolean(c))
    const assets = await loadAssets(input, deps, covers)

    const canvas = deps.createCanvas(IMAGE_WIDTH, IMAGE_HEIGHT)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Не удалось создать картинку')
    ctx.textBaseline = 'alphabetic'

    // Фон: чёрный с двумя мягкими свечениями.
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)
    for (const [cx, cy, r, a] of [[900, 260, 700, 0.16], [120, 1500, 760, 0.1]] as const) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
        g.addColorStop(0, `rgba(230, 230, 232, ${a})`)
        g.addColorStop(1, 'rgba(230, 230, 232, 0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)
    }

    // Шапка.
    ctx.fillStyle = FG
    setFont(ctx, 700, 44, DISPLAY)
    ctx.textAlign = 'left'
    ctx.fillText('frnk ness', MARGIN, 150)
    ctx.fillStyle = FAINT
    setFont(ctx, 500, 30, MONO)
    ctx.textAlign = 'right'
    ctx.fillText(`ИТОГИ ${recap.year}`, IMAGE_WIDTH - MARGIN, 148)
    ctx.textAlign = 'left'

    // Аватар и ник. Аватар не загрузился — рисуем без него.
    let y = 220
    const av = assets.avatar
    const avatarSize = 150
    let textX = MARGIN
    if (av) {
        if (av.view.kind === 'img' && av.image) {
            drawCover(ctx, av.image, MARGIN, y, avatarSize, avatarSize / 2)
            textX = MARGIN + avatarSize + 36
        } else if (av.view.kind !== 'img') {
            ctx.save()
            roundedPath(ctx, MARGIN, y, avatarSize, avatarSize, avatarSize / 2)
            ctx.fillStyle = av.view.bg
            ctx.fill()
            ctx.fillStyle = FG
            ctx.textAlign = 'center'
            setFont(ctx, 700, 72, DISPLAY)
            ctx.fillText(av.view.kind === 'emoji' ? av.view.text : av.view.text || initialsOf(recap.user?.nick ?? ''), MARGIN + avatarSize / 2, y + avatarSize / 2 + 26)
            ctx.restore()
            textX = MARGIN + avatarSize + 36
        }
    }
    const nick = recap.user?.nick ?? ''
    ctx.fillStyle = FG
    ctx.textAlign = 'left'
    const nickMeasure = setFont(ctx, 700, 60, DISPLAY)
    const nickText = ellipsize(nickMeasure, nick, IMAGE_WIDTH - MARGIN - textX)
    ctx.fillText(nickText, textX, y + 82)
    ctx.fillStyle = MUTED
    setFont(ctx, 400, 36, TEXT)
    ctx.fillText(`Мой ${recap.year} год в музыке`, textX, y + 136)

    // Главная цифра.
    y = 470
    ctx.fillStyle = FG
    let size = 220
    let m = setFont(ctx, 800, size, DISPLAY)
    const minutesText = formatCount(recap.minutes)
    while (m(minutesText) > CONTENT_W && size > 80) {
        size -= 10
        m = setFont(ctx, 800, size, DISPLAY)
    }
    ctx.fillText(minutesText, MARGIN, y + size * 0.8)
    ctx.fillStyle = MUTED
    setFont(ctx, 600, 48, TEXT)
    ctx.fillText(recap.minutes >= 60 ? `минут музыки · ${formatDuration(recap.minutes)}` : 'минут музыки', MARGIN, y + size * 0.8 + 80)

    // Цифры: прослушивания, избранное, комнаты — только те, где есть данные.
    y = 800
    const stats = [
        recap.plays > 0 ? { value: formatCount(recap.plays), label: 'прослушиваний' } : null,
        recap.favorites_added > 0 ? { value: formatCount(recap.favorites_added), label: 'в избранное' } : null,
        recap.rooms.count > 0 ? { value: formatCount(recap.rooms.count), label: 'комнат' } : null
    ].filter((s): s is { value: string; label: string } => Boolean(s))
    if (stats.length) {
        const gap = 24
        const boxW = (CONTENT_W - gap * (stats.length - 1)) / stats.length
        stats.forEach((s, i) => {
            const x = MARGIN + i * (boxW + gap)
            ctx.save()
            roundedPath(ctx, x, y, boxW, 170, 28)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'
            ctx.fill()
            ctx.restore()
            ctx.textAlign = 'left'
            ctx.fillStyle = FG
            let vs = 64
            let vm = setFont(ctx, 700, vs, DISPLAY)
            while (vm(s.value) > boxW - 48 && vs > 28) {
                vs -= 4
                vm = setFont(ctx, 700, vs, DISPLAY)
            }
            ctx.fillText(s.value, x + 28, y + 88)
            ctx.fillStyle = MUTED
            const lm = setFont(ctx, 400, 30, TEXT)
            ctx.fillText(ellipsize(lm, s.label, boxW - 48), x + 28, y + 136)
        })
    }

    // Топ-3 треков.
    y = 1030
    if (top.length) {
        ctx.fillStyle = FAINT
        setFont(ctx, 500, 28, MONO)
        ctx.fillText('ТОП ТРЕКОВ', MARGIN, y)
        y += 36
        top.forEach((t, i) => {
            const rowY = y + i * 140
            const cover = t.cover ? assets.covers.get(t.cover) : null
            if (cover) drawCover(ctx, cover, MARGIN, rowY, 120, 18)
            else placeholder(ctx, MARGIN, rowY, 120, 18)
            const tx = MARGIN + 120 + 32
            const plays = `${formatCount(t.plays)}×`
            ctx.textAlign = 'right'
            ctx.fillStyle = MUTED
            const pm = setFont(ctx, 600, 36, TEXT)
            ctx.fillText(plays, IMAGE_WIDTH - MARGIN, rowY + 64)
            const maxW = IMAGE_WIDTH - MARGIN - tx - pm(plays) - 24
            ctx.textAlign = 'left'
            ctx.fillStyle = FG
            const tm = setFont(ctx, 700, 42, TEXT)
            ctx.fillText(ellipsize(tm, t.title, maxW), tx, rowY + 52)
            ctx.fillStyle = MUTED
            const sm = setFont(ctx, 400, 32, TEXT)
            ctx.fillText(ellipsize(sm, t.releaseTitle, maxW), tx, rowY + 100)
        })
        y += top.length * 140
    }

    // Любимый релиз: название переносится на две строки.
    if (fav && recap.top_release) {
        y += 40
        const cover = fav.cover ? assets.covers.get(fav.cover) : null
        if (cover) drawCover(ctx, cover, MARGIN, y, 150, 22)
        else placeholder(ctx, MARGIN, y, 150, 22)
        const tx = MARGIN + 150 + 36
        ctx.fillStyle = FAINT
        setFont(ctx, 500, 28, MONO)
        ctx.fillText('ЛЮБИМЫЙ РЕЛИЗ', tx, y + 34)
        ctx.fillStyle = FG
        const fm = setFont(ctx, 700, 44, TEXT)
        wrapText(fm, fav.title, IMAGE_WIDTH - MARGIN - tx, 2).forEach((line, i) => ctx.fillText(line, tx, y + 90 + i * 54))
    }

    // Подвал.
    ctx.textAlign = 'center'
    ctx.fillStyle = FG
    setFont(ctx, 600, 46, DISPLAY)
    ctx.fillText(SITE_NAME, IMAGE_WIDTH / 2, IMAGE_HEIGHT - 110)
    ctx.textAlign = 'left'

    return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не удалось сохранить картинку'))), 'image/png')
    })
}

// ── Сохранение ─────────────────────────────────────────────────────────
export type SaveResult = 'shared' | 'downloaded' | 'opened' | 'cancelled'

export interface SaveEnv {
    userAgent: string
    platform: string
    maxTouchPoints: number
    canShareFiles(file: File): boolean
    share(file: File): Promise<void>
    download(blob: Blob, filename: string): void
    openInTab(blob: Blob): boolean
}

export function isIos(env: Pick<SaveEnv, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
    return /iP(hone|ad|od)/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1)
}

export const browserSaveEnv = (): SaveEnv => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    canShareFiles: (file) => typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }),
    share: (file) => navigator.share({ files: [file], title: 'Мои итоги года' }),
    download(blob, filename) {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.rel = 'noopener'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
    openInTab(blob) {
        const url = URL.createObjectURL(blob)
        const w = window.open(url, '_blank', 'noopener')
        setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
        return Boolean(w)
    }
})

/**
 * Сохранить PNG. На iOS прямое скачивание картинки не кладёт её в Фото,
 * поэтому там сначала окно «Поделиться» (в нём «Сохранить изображение»);
 * не вышло — открываем картинку в новой вкладке (долгое нажатие → «Сохранить»).
 * Остальные браузеры (десктоп и Android) — обычное скачивание.
 * Вызывать сразу из обработчика нажатия: share требует жеста пользователя,
 * поэтому картинку лучше нарисовать заранее.
 */
export async function saveRecapImage(blob: Blob, filename: string, env: SaveEnv = browserSaveEnv()): Promise<SaveResult> {
    const file = new File([blob], filename, { type: 'image/png' })
    if (isIos(env)) {
        if (env.canShareFiles(file)) {
            try {
                await env.share(file)
                return 'shared'
            } catch (e) {
                if ((e as { name?: string })?.name === 'AbortError') return 'cancelled'
                // Не получилось поделиться — пробуем открыть.
            }
        }
        return env.openInTab(blob) ? 'opened' : 'cancelled'
    }
    try {
        env.download(blob, filename)
        return 'downloaded'
    } catch {
        if (env.canShareFiles(file)) {
            try {
                await env.share(file)
                return 'shared'
            } catch (e) {
                if ((e as { name?: string })?.name === 'AbortError') return 'cancelled'
            }
        }
        return env.openInTab(blob) ? 'opened' : 'cancelled'
    }
}

export const recapFilename = (year: number): string => `frnkness-recap-${year}.png`
