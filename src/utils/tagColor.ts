/**
 * Цвет тега пользователя: только #RRGGBB (то же правило в базе, tag_clean_color).
 * Цвет текста на значке подбирается автоматически по контрасту с фоном.
 */

export const TAG_NAME_MAX = 20

const COLOR_RE = /^#[0-9a-f]{6}$/i

export function isTagColor(value: unknown): value is string {
    return typeof value === 'string' && COLOR_RE.test(value)
}

/** Нормальный вид для хранения: нижний регистр. null — формат неверный. */
export function normalizeTagColor(value: unknown): string | null {
    return isTagColor(value) ? value.toLowerCase() : null
}

function channel(v: number): number {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Относительная яркость по WCAG, 0…1. */
export function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16)
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** Коэффициент контраста двух цветов по WCAG, от 1 до 21. */
export function contrastRatio(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

/** Белый или чёрный — тот, у которого контраст с фоном выше. */
export function tagTextColor(background: string): '#ffffff' | '#000000' {
    if (!isTagColor(background)) return '#ffffff'
    return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000') ? '#ffffff' : '#000000'
}
