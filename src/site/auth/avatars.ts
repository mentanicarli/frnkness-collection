import { avatarUploadUrl } from '@/supabaseConfig'

/**
 * Аватар хранится в профиле строкой (формат проверяет база):
 *   initials:<цвет>   цветные инициалы
 *   emoji:<номер>     эмодзи из набора
 *   cover:<releaseId> обложка релиза
 *   upload:<версия>   своя картинка в бакете avatars (<id>/avatar)
 */

export const INITIALS_COLORS = ['#3a3a40', '#7c3aed', '#2563eb', '#0891b2', '#059669', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#db2777']
export const EMOJIS = ['🎧', '🎤', '🔥', '🌙', '⭐', '🐸', '🦊', '🐱', '👾', '🍕', '🌊', '💿', '🎸', '🌵', '🍒', '👻']

export type AvatarView =
    | { kind: 'img'; src: string }
    | { kind: 'emoji'; text: string; bg: string }
    | { kind: 'initials'; text: string; bg: string }

export function initialsOf(nick: string): string {
    const first = [...(nick || '').trim()][0]
    return first ? first.toUpperCase() : '?'
}

/** coverOf — путь к обложке релиза (в админке реестра нет — тогда инициалы). */
export function avatarView(avatar: string | null | undefined, nick: string, userId: string, coverOf?: (releaseId: string) => string | null): AvatarView {
    const [kind, value = ''] = String(avatar || '').split(/:(.*)/s)
    const fallback: AvatarView = { kind: 'initials', text: initialsOf(nick), bg: INITIALS_COLORS[0] }
    if (kind === 'initials') return { ...fallback, bg: INITIALS_COLORS[Number(value) % INITIALS_COLORS.length] ?? INITIALS_COLORS[0] }
    if (kind === 'emoji') {
        const emoji = EMOJIS[Number(value)]
        return emoji ? { kind: 'emoji', text: emoji, bg: INITIALS_COLORS[0] } : fallback
    }
    if (kind === 'cover') {
        const src = coverOf?.(value)
        return src ? { kind: 'img', src } : fallback
    }
    if (kind === 'upload' && /^\d{1,15}$/.test(value) && userId) return { kind: 'img', src: avatarUploadUrl(userId, value) }
    return fallback
}

// ── Своя картинка ──────────────────────────────────────────────────────
export const AVATAR_SIZE = 256
export const AVATAR_SOURCE_MAX_BYTES = 5 * 1024 * 1024
export const AVATAR_SOURCE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function checkAvatarSource(file: { type: string; size: number }): string | null {
    if (!AVATAR_SOURCE_TYPES.includes(file.type)) return 'Подойдёт картинка jpg, png или webp'
    if (file.size > AVATAR_SOURCE_MAX_BYTES) return 'Картинка больше 5 МБ'
    return null
}

/**
 * Квадрат исходной картинки, который попадает в аватар: zoom ≥ 1 — во
 * сколько раз приблизить относительно «вписать короткую сторону», offset —
 * сдвиг центра в долях свободного хода (−1…1 по каждой оси).
 */
export function cropRect(width: number, height: number, zoom: number, offsetX: number, offsetY: number) {
    const side = Math.min(width, height) / Math.max(1, zoom)
    const clamp = (v: number) => Math.max(-1, Math.min(1, v))
    const freeX = (width - side) / 2
    const freeY = (height - side) / 2
    return {
        sx: freeX + clamp(offsetX) * freeX,
        sy: freeY + clamp(offsetY) * freeY,
        side
    }
}
