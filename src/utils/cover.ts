/**
 * Обложки: рядом с каждой картинкой images/<имя>.jpg|png сборка кладёт
 * уменьшенные webp-копии images/<имя>-<ширина>.webp (vite.config.ts,
 * coverVariantsPlugin). Здесь — адреса копий для srcset.
 */
export const COVER_WIDTHS = [160, 320, 640, 960] as const

const SOURCE = /^(.*)\.(jpe?g|png)$/i

/** Адрес копии нужной ширины; null — если это не картинка из images/ (например, из Storage). */
export function coverVariant(cover: string, width: number): string | null {
    if (!/(^|\/)images\//.test(cover) || /^(https?:|data:|blob:)/.test(cover)) return null
    const m = SOURCE.exec(cover)
    return m ? `${m[1]}-${width}.webp` : null
}

/** Значение srcset для обложки; undefined — копий нет, остаётся обычный src. */
export function coverSrcset(cover: string | null | undefined): string | undefined {
    if (!cover) return undefined
    const parts = COVER_WIDTHS.map((w) => {
        const url = coverVariant(cover, w)
        return url ? `${url} ${w}w` : null
    }).filter(Boolean)
    return parts.length ? parts.join(', ') : undefined
}
