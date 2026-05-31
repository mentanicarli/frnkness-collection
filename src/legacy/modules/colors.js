export function createColorsModule(ctx) {
    const { state, colorCache, colorPromiseCache, DEFAULT_COLOR } = ctx

    function getAverageColorFromImage(img) {
        const canvas = document.createElement('canvas')
        const domCtx = canvas.getContext('2d', { willReadFrequently: true })
        const width = Math.max(1, Math.min(64, img.naturalWidth || 64))
        const height = Math.max(1, Math.min(64, img.naturalHeight || 64))
        canvas.width = width
        canvas.height = height
        domCtx.drawImage(img, 0, 0, width, height)
        const { data } = domCtx.getImageData(0, 0, width, height)
        let r = 0, g = 0, b = 0, count = 0
        for (let i = 0; i < data.length; i += 16) {
            const alpha = data[i + 3]
            if (alpha < 16) continue
            r += data[i]; g += data[i + 1]; b += data[i + 2]; count++
        }
        if (!count) throw new Error('Average color extraction failed')
        return [Math.round(r / count), Math.round(g / count), Math.round(b / count)]
    }

    function getDominantColor(imageUrl) {
        return new Promise((resolve, reject) => {
            if (colorCache[imageUrl]) return resolve(colorCache[imageUrl])
            if (colorPromiseCache[imageUrl]) return colorPromiseCache[imageUrl].then(resolve, reject)
            const img = new Image()
            img.crossOrigin = 'Anonymous'
            colorPromiseCache[imageUrl] = new Promise((innerResolve, innerReject) => {
                img.onload = () => {
                    try {
                        let rgb
                        if (state.colorThief) {
                            try { rgb = state.colorThief.getColor(img) } catch { rgb = getAverageColorFromImage(img) }
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

    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255
        const max = Math.max(r, g, b), min = Math.min(r, g, b)
        let h = 0, s = 0, l = (max + min) / 2
        if (max !== min) {
            const d = max - min
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)); break
                case g: h = ((b - r) / d + 2); break
                case b: h = ((r - g) / d + 4); break
            }
            h /= 6
        }
        return { h: h * 360, s: s * 100, l: l * 100 }
    }

    function hslToRgb(h, s, l) {
        h /= 360; s /= 100; l /= 100
        let r, g, b
        if (s === 0) {
            r = g = b = l
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1
                if (t > 1) t -= 1
                if (t < 1 / 6) return p + (q - p) * 6 * t
                if (t < 1 / 2) return q
                if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
                return p
            }
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s
            const p = 2 * l - q
            r = hue2rgb(p, q, h + 1 / 3)
            g = hue2rgb(p, q, h)
            b = hue2rgb(p, q, h - 1 / 3)
        }
        return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) }
    }

    function normalizeColor(rgb) {
        const [r, g, b] = rgb
        const hsl = rgbToHsl(r, g, b)
        if (hsl.s < 12) {
            const neutralLightness = hsl.l > 75 ? 90 : hsl.l < 30 ? 72 : Math.min(88, Math.max(72, hsl.l + 10))
            const neutralRgb = hslToRgb(0, 0, neutralLightness)
            return {
                hex: `rgb(${neutralRgb.r}, ${neutralRgb.g}, ${neutralRgb.b})`,
                glow: `rgba(${neutralRgb.r}, ${neutralRgb.g}, ${neutralRgb.b}, 0.24)`,
                soft: `rgba(${neutralRgb.r}, ${neutralRgb.g}, ${neutralRgb.b}, 0.14)`
            }
        }
        if (hsl.l < 30) hsl.l = 66
        else if (hsl.l > 82) hsl.l = 74
        else hsl.l = Math.min(76, Math.max(64, hsl.l + 8))
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

    async function updatePlayerAccent(imageUrl) {
        try {
            const rgb = await getDominantColor(imageUrl)
            const vars = normalizeColor(rgb)
            const root = document.documentElement
            root.style.setProperty('--player-accent', vars.hex)
            root.style.setProperty('--player-accent-glow', vars.glow)
            root.style.setProperty('--player-accent-soft', vars.soft)
        } catch { }
    }

    async function updatePageAccent(imageUrl) {
        try {
            const rgb = await getDominantColor(imageUrl)
            const vars = normalizeColor(rgb)
            const root = document.documentElement
            root.style.setProperty('--page-accent', vars.hex)
            root.style.setProperty('--page-accent-glow', vars.glow)
            root.style.setProperty('--page-accent-soft', vars.soft)
        } catch { }
    }

    function resetPageAccent() {
        const root = document.documentElement
        root.style.setProperty('--page-accent', DEFAULT_COLOR.hex)
        root.style.setProperty('--page-accent-glow', DEFAULT_COLOR.glow)
        root.style.setProperty('--page-accent-soft', DEFAULT_COLOR.soft)
    }

    async function applyCardAccent(card, imageUrl) {
        try {
            const rgb = await getDominantColor(imageUrl)
            const vars = normalizeColor(rgb)
            card.style.setProperty('--card-accent', vars.hex)
            card.style.setProperty('--card-glow', vars.glow)
            card.style.setProperty('--card-soft', vars.soft)
        } catch { }
    }

    function resetCardAccent(card) {
        card.style.removeProperty('--card-accent')
        card.style.removeProperty('--card-glow')
        card.style.removeProperty('--card-soft')
    }

    return { getDominantColor, normalizeColor, updatePlayerAccent, updatePageAccent, resetPageAccent, applyCardAccent, resetCardAccent }
}
