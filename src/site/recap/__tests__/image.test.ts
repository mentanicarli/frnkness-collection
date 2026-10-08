import { describe, expect, it, vi } from 'vitest'
import { IMAGE_HEIGHT, IMAGE_WIDTH, ellipsize, isIos, renderRecapImage, saveRecapImage, wrapText, type DrawableImage, type RenderDeps, type SaveEnv } from '../image'
import { CATALOG, makeRecap } from './fixtures'

const measure = (s: string) => [...s].length * 10

describe('картинка итогов: перенос и обрезка текста', () => {
    it('короткая строка не меняется, длинная обрезается многоточием и помещается', () => {
        expect(ellipsize(measure, 'Привет', 100)).toBe('Привет')
        const out = ellipsize(measure, 'Очень длинное название трека без конца', 150)
        expect(out.endsWith('…')).toBe(true)
        expect(measure(out)).toBeLessThanOrEqual(150)
        expect(ellipsize(measure, 'Ы'.repeat(50), 5)).toBe('…')
    })

    it('перенос по словам, лишнее — многоточием в последней строке', () => {
        expect(wrapText(measure, 'раз два три', 1000, 2)).toEqual(['раз два три'])
        expect(wrapText(measure, 'раз два три четыре', 80, 3)).toEqual(['раз два', 'три', 'четыре'])
        const lines = wrapText(measure, 'раз два три четыре пять шесть семь', 80, 2)
        expect(lines).toHaveLength(2)
        expect(lines[1].endsWith('…')).toBe(true)
        lines.forEach((l) => expect(measure(l)).toBeLessThanOrEqual(80))
    })

    it('слово длиннее строки режется, пустой текст не ломается', () => {
        const lines = wrapText(measure, 'Ш'.repeat(40), 100, 2)
        lines.forEach((l) => expect(measure(l)).toBeLessThanOrEqual(100))
        expect(wrapText(measure, '   ', 100, 2)).toEqual([''])
    })
})

function fakeCanvas() {
    const texts: { text: string; x: number; y: number; align: string }[] = []
    const draws: unknown[] = []
    const order: string[] = []
    const ctx: any = {
        font: '', fillStyle: '', textAlign: 'left', textBaseline: '',
        measureText: (s: string) => ({ width: [...s].length * 12 }),
        fillText: (text: string, x: number, y: number) => texts.push({ text, x, y, align: ctx.textAlign }),
        drawImage: (img: unknown) => draws.push(img),
        createRadialGradient: () => ({ addColorStop: () => undefined }),
        fillRect: () => undefined, save: () => undefined, restore: () => undefined, clip: () => undefined,
        beginPath: () => undefined, moveTo: () => undefined, arcTo: () => undefined, closePath: () => undefined, fill: () => undefined
    }
    const canvas = {
        width: 0, height: 0,
        getContext: () => ctx,
        toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' }))
    }
    return { ctx, canvas, texts, draws, order }
}

const IMG = { width: 200, height: 100 } as unknown as DrawableImage

function deps(overrides: Partial<RenderDeps> = {}) {
    const f = fakeCanvas()
    const d: RenderDeps = {
        createCanvas: (w, h) => {
            f.order.push('canvas')
            f.canvas.width = w
            f.canvas.height = h
            return f.canvas as any
        },
        loadImage: vi.fn(async () => IMG),
        fontsReady: vi.fn(async () => { f.order.push('fonts') }),
        ...overrides
    }
    return { d, f }
}

describe('картинка итогов: PNG 1080×1920', () => {
    it('рисует на холсте 1080×1920 и отдаёт PNG; шрифты ждём до рисования', async () => {
        const { d, f } = deps()
        const blob = await renderRecapImage({ recap: makeRecap(), catalog: CATALOG }, d)
        expect(blob.type).toBe('image/png')
        expect([f.canvas.width, f.canvas.height]).toEqual([IMAGE_WIDTH, IMAGE_HEIGHT])
        expect([IMAGE_WIDTH, IMAGE_HEIGHT]).toEqual([1080, 1920])
        expect(f.order).toEqual(['fonts', 'canvas'])
        const texts = f.texts.map((t) => t.text)
        expect(texts).toContain('Яна')
        expect(texts).toContain('frnkness.ru')
        expect(texts).toContain('640')
        expect(texts).toContain('Первый')
        expect(texts).toContain('120')
        expect(texts).toContain('3')
    })

    it('обложки и аватар грузятся через loadImage (fetch как blob), а не прямым <img>', async () => {
        const { d } = deps()
        await renderRecapImage({ recap: makeRecap({ user: { id: 'u1', nick: 'Яна', avatar: 'upload:5' } }), catalog: CATALOG }, d)
        const urls = (d.loadImage as any).mock.calls.map((c: string[]) => c[0])
        expect(urls).toEqual(expect.arrayContaining(['images/alpha.jpg', 'images/beta.jpg']))
        expect(urls.some((u: string) => u.includes('/storage/v1/object/public/avatars/u1/avatar'))).toBe(true)
    })

    it('аватар не загрузился — рисуем без него, без ошибки; обложки тоже необязательны', async () => {
        const { d, f } = deps({ loadImage: vi.fn(async () => null) })
        const recap = makeRecap({ user: { id: 'u1', nick: 'Яна', avatar: 'upload:5' } })
        await expect(renderRecapImage({ recap, catalog: CATALOG }, d)).resolves.toBeInstanceOf(Blob)
        expect(f.draws).toHaveLength(0)
        // Ник сдвигать вправо не нужно: места под аватар не оставляли.
        expect(f.texts.find((t) => t.text === 'Яна')?.x).toBe(90)
    })

    it('длинные названия обрезаются или переносятся и не вылезают за край', async () => {
        const { d, f } = deps()
        const long = 'Очень '.repeat(40)
        const catalog = {
            track: () => ({ title: long, releaseId: 'alpha', releaseTitle: long, cover: null }),
            release: () => ({ title: long, cover: null })
        }
        const recap = makeRecap({ user: { id: 'u1', nick: 'Н'.repeat(20), avatar: 'initials:1' } })
        await renderRecapImage({ recap, catalog }, d)
        // Ширина символа в заглушке — 12 px: каждая строка целиком внутри холста с полями 90 px.
        for (const t of f.texts) {
            const w = [...t.text].length * 12
            const left = t.align === 'right' ? t.x - w : t.align === 'center' ? t.x - w / 2 : t.x
            expect(left, t.text).toBeGreaterThanOrEqual(0)
            expect(left + w, t.text).toBeLessThanOrEqual(IMAGE_WIDTH - 90 + 1)
        }
        expect(f.texts.some((t) => t.text.endsWith('…'))).toBe(true)
    })

    it('все блоки (три трека, релиз с длинным названием) стоят выше подписи сайта и не налезают на неё', async () => {
        const { d, f } = deps()
        const long = { track: CATALOG.track, release: () => ({ title: 'Очень длинное название релиза '.repeat(5), cover: 'images/beta.jpg' }) }
        await renderRecapImage({ recap: makeRecap(), catalog: long }, d)
        const footer = f.texts.find((t) => t.text === 'frnkness.ru')!
        expect(footer.y).toBeGreaterThan(1700)
        const rest = f.texts.filter((t) => t !== footer)
        for (const t of rest) expect(t.y, t.text).toBeLessThan(footer.y - 60)
    })

    it('текст попадает в canvas как текст: разметка в нике не интерпретируется', async () => {
        const { d, f } = deps()
        await renderRecapImage({ recap: makeRecap({ user: { id: 'u1', nick: '<b>x</b>', avatar: 'initials:0' } }), catalog: CATALOG }, d)
        expect(f.texts.map((t) => t.text)).toContain('<b>x</b>')
    })

    it('нет холста — понятная ошибка', async () => {
        const { d } = deps({ createCanvas: () => ({ width: 0, height: 0, getContext: () => null, toBlob: () => undefined }) })
        await expect(renderRecapImage({ recap: makeRecap(), catalog: CATALOG }, d)).rejects.toThrow()
    })
})

function env(over: Partial<SaveEnv> = {}): SaveEnv & { calls: string[] } {
    const calls: string[] = []
    return {
        userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
        canShareFiles: () => true,
        share: async () => { calls.push('share') },
        download: () => { calls.push('download') },
        openInTab: () => { calls.push('open'); return true },
        calls,
        ...over
    }
}
const PNG = new Blob(['x'], { type: 'image/png' })

describe('картинка итогов: сохранение на телефоне', () => {
    it('iOS определяется (в том числе iPad под видом Mac)', () => {
        expect(isIos({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 })).toBe(true)
        expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
        expect(isIos({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
        expect(isIos({ userAgent: 'Android', platform: 'Linux', maxTouchPoints: 5 })).toBe(false)
    })

    it('iOS: окно «Поделиться»; отмена — не ошибка; без share — открыть в новой вкладке', async () => {
        const ios = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', platform: 'iPhone' }
        const a = env(ios)
        expect(await saveRecapImage(PNG, 'a.png', a)).toBe('shared')
        expect(a.calls).toEqual(['share'])

        const b = env({ ...ios, share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) } })
        expect(await saveRecapImage(PNG, 'a.png', b)).toBe('cancelled')

        const c = env({ ...ios, canShareFiles: () => false })
        expect(await saveRecapImage(PNG, 'a.png', c)).toBe('opened')
        expect(c.calls).toEqual(['open'])

        const d = env({ ...ios, share: async () => { throw new Error('boom') } })
        expect(await saveRecapImage(PNG, 'a.png', d)).toBe('opened')
    })

    it('Android и десктоп: обычное скачивание; если не вышло — «Поделиться», затем вкладка', async () => {
        const a = env()
        expect(await saveRecapImage(PNG, 'a.png', a)).toBe('downloaded')
        expect(a.calls).toEqual(['download'])

        const b = env({ download: () => { throw new Error('blocked') } })
        expect(await saveRecapImage(PNG, 'a.png', b)).toBe('shared')

        const c = env({ download: () => { throw new Error('blocked') }, canShareFiles: () => false })
        expect(await saveRecapImage(PNG, 'a.png', c)).toBe('opened')
    })
})
