import type { ColorSet } from '@/types'

export interface HSL {
    h: number
    s: number
    l: number
}

export interface RGB {
    r: number
    g: number
    b: number
}

const DEFAULT_COLOR: ColorSet = {
    hex: 'rgb(103, 114, 131)',
    glow: 'rgba(103, 114, 131, 0.32)',
    soft: 'rgba(103, 114, 131, 0.18)'
}

/**
 * Get average color from image
 */
export function getAverageColorFromImage(img: HTMLImageElement): [number, number, number] {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas context failed')

    const width = Math.max(1, Math.min(64, img.naturalWidth || 64))
    const height = Math.max(1, Math.min(64, img.naturalHeight || 64))

    canvas.width = width
    canvas.height = height
    ctx.drawImage(img, 0, 0, width, height)

    const { data } = ctx.getImageData(0, 0, width, height)
    let r = 0,
        g = 0,
        b = 0,
        count = 0

    for (let i = 0; i < data.length; i += 16) {
        const alpha = data[i + 3]
        if (alpha < 16) continue
        r += data[i]
        g += data[i + 1]
        b += data[i + 2]
        count++
    }

    if (!count) throw new Error('Average color extraction failed')
    return [Math.round(r / count), Math.round(g / count), Math.round(b / count)]
}

/**
 * RGB to HSL conversion
 */
export function rgbToHsl(r: number, g: number, b: number): HSL {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b)
    let h = 0,
        s = 0
    const l = (max + min) / 2

    if (max !== min) {
        const d = max - min
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0)) / 6
                break
            case g:
                h = ((b - r) / d + 2) / 6
                break
            case b:
                h = ((r - g) / d + 4) / 6
                break
        }
    }

    return { h: h * 360, s: s * 100, l: l * 100 }
}

/**
 * HSL to RGB conversion
 */
export function hslToRgb(h: number, s: number, l: number): RGB {
    h /= 360
    s /= 100
    l /= 100

    let r_val = 0, g_val = 0, b_val = 0

    if (s === 0) {
        r_val = g_val = b_val = l
    } else {
        const hue2rgb = (p: number, q: number, t: number): number => {
            if (t < 0) t += 1
            if (t > 1) t -= 1
            if (t < 1 / 6) return p + (q - p) * 6 * t
            if (t < 1 / 2) return q
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
            return p
        }

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s
        const p = 2 * l - q
        r_val = hue2rgb(p, q, h + 1 / 3)
        g_val = hue2rgb(p, q, h)
        b_val = hue2rgb(p, q, h - 1 / 3)
    }

    return { r: Math.round(r_val * 255), g: Math.round(g_val * 255), b: Math.round(b_val * 255) }
}

/**
 * Normalize RGB color to suitable accent color
 */
export function normalizeColor(rgb: [number, number, number]): ColorSet {
    const [r, g, b] = rgb
    let hsl = rgbToHsl(r, g, b)

    // Handle grayscale colors
    if (hsl.s < 12) {
        const neutralLightness =
            hsl.l > 75 ? 90 : hsl.l < 30 ? 72 : Math.min(88, Math.max(72, hsl.l + 10))
        const neutralRgb = hslToRgb(0, 0, neutralLightness)
        return {
            hex: `rgb(${neutralRgb.r}, ${neutralRgb.g}, ${neutralRgb.b})`,
            glow: `rgba(${neutralRgb.r}, ${neutralRgb.g}, ${neutralRgb.b}, 0.24)`,
            soft: `rgba(${neutralRgb.r}, ${neutralRgb.g}, ${neutralRgb.b}, 0.14)`
        }
    }

    // Normalize lightness
    if (hsl.l < 30) hsl.l = 66
    else if (hsl.l > 82) hsl.l = 74
    else hsl.l = Math.min(76, Math.max(64, hsl.l + 8))

    // Normalize saturation
    if (hsl.s < 22) hsl.s = 32
    else if (hsl.s > 72) hsl.s = 52
    else hsl.s = Math.min(56, Math.max(34, hsl.s - 10))

    const finalRgb = hslToRgb(hsl.h, hsl.s, hsl.l)
    return {
        hex: `rgb(${finalRgb.r}, ${finalRgb.g}, ${finalRgb.b})`,
        glow: `rgba(${finalRgb.r}, ${finalRgb.g}, ${finalRgb.b}, 0.28)`,
        soft: `rgba(${finalRgb.r}, ${finalRgb.g}, ${finalRgb.b}, 0.14)`
    }
}

/**
 * Get dominant color from image URL
 */
export async function getDominantColor(
    imageUrl: string,
    colorCache: Partial<Record<string, [number, number, number]>>,
    colorPromiseCache: Partial<Record<string, Promise<[number, number, number]>>>,
    colorThief: any
): Promise<[number, number, number]> {
    return new Promise((resolve, reject) => {
        if (colorCache[imageUrl]) return resolve(colorCache[imageUrl])
        if (colorPromiseCache[imageUrl]) return colorPromiseCache[imageUrl].then(resolve, reject)

        const img = new Image()
        img.crossOrigin = 'Anonymous'

        colorPromiseCache[imageUrl] = new Promise((innerResolve, innerReject) => {
            img.onload = () => {
                try {
                    let rgb: [number, number, number]

                    if (colorThief) {
                        try {
                            rgb = colorThief.getColor(img)
                        } catch {
                            rgb = getAverageColorFromImage(img)
                        }
                    } else {
                        rgb = getAverageColorFromImage(img)
                    }

                    colorCache[imageUrl] = rgb
                    delete colorPromiseCache[imageUrl]
                    innerResolve(rgb)
                } catch (e) {
                    delete colorPromiseCache[imageUrl]
                    innerReject(e)
                }
            }

            img.onerror = () => {
                delete colorPromiseCache[imageUrl]
                innerReject(new Error('Image load error'))
            }
        })

        img.src = imageUrl
        colorPromiseCache[imageUrl].then(resolve, reject)
    })
}

/**
 * Apply color set to CSS variables
 */
export function applyColorToCSSVariables(
    colors: ColorSet,
    selector: '--player-accent' | '--page-accent' | '--card-accent' = '--player-accent'
): void {
    const root = document.documentElement
    root.style.setProperty(selector, colors.hex)
    root.style.setProperty(`${selector}-glow`, colors.glow)
    root.style.setProperty(`${selector}-soft`, colors.soft)
}

/**
 * Reset accent color to default
 */
export function resetColorToDefault(
    selector: '--player-accent' | '--page-accent' | '--card-accent' = '--player-accent'
): void {
    applyColorToCSSVariables(DEFAULT_COLOR, selector)
}
