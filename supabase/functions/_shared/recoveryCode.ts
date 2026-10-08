/**
 * Код восстановления пароля: одноразовый, 16 символов группами по 4
 * (XXXX-XXXX-XXXX-XXXX). Алфавит из 32 знаков без похожих (нет 0, 1, I, O),
 * то есть ровно 5 бит на символ и около 80 бит на код: перебор невозможен
 * даже без лимитов. В базе хранится только HMAC-хеш с секретом функции и
 * id пользователя, открытый код знает один человек.
 * Без привязки к Deno: тестируется в vitest.
 */
import { keyHash } from './http.ts'

export const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const RECOVERY_CODE_LENGTH = 16
const FORMAT_RE = /^[A-HJ-NP-Z2-9]{16}$/

/** Новый случайный код. random — для тестов (по умолчанию crypto.getRandomValues). */
export function generateRecoveryCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
    // 32 символа в алфавите, 256 делится на 32 без остатка — смещения нет.
    const bytes = random(RECOVERY_CODE_LENGTH)
    let raw = ''
    for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) raw += RECOVERY_ALPHABET[bytes[i] & 31]
    return formatRecoveryCode(raw)
}

export function formatRecoveryCode(raw: string): string {
    return raw.match(/.{1,4}/g)!.join('-')
}

/** Введённый код без пробелов и дефисов, в верхнем регистре; null — формат неверный. */
export function normalizeRecoveryCode(input: unknown): string | null {
    const raw = String(input ?? '').toUpperCase().replace(/[\s-]+/g, '')
    return FORMAT_RE.test(raw) ? raw : null
}

/** Хеш для хранения и сравнения: привязан к пользователю, поэтому одинаковые коды у двоих дают разные хеши. */
export function hashRecoveryCode(secret: string, userId: string, normalizedCode: string): Promise<string> {
    return keyHash(secret, `recovery-code-v1:${userId}:${normalizedCode}`)
}
