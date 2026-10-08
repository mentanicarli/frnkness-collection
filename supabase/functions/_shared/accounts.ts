/**
 * Правила аккаунтов — общие для сайта, админки и Edge Functions.
 *
 * Ник: 3–20 символов — русские и латинские буквы, цифры, «_», «.», «-».
 * Уникальность — по ключу ника (nickKey): без учёта регистра, ё = е,
 * похожие латинские буквы = кириллические, 0 = о, «_», «.», «-» — один знак.
 *
 * Технический адрес аккаунта строится из ключа ника, поэтому вход
 * «ЯН» и «ян» — один и тот же аккаунт. ВНИМАНИЕ: правила ключа нельзя
 * менять без пересчёта адресов всех аккаунтов — иначе люди не смогут войти.
 */

export const NICK_MIN = 3
export const NICK_MAX = 20
export const PASSWORD_MIN = 8
// bcrypt учитывает только первые 72 байта; длиннее не принимаем.
export const PASSWORD_MAX_BYTES = 72
export const BIO_MAX = 200

export const NICK_RE = /^[A-Za-zА-Яа-яЁё0-9_.-]+$/
export const TECH_EMAIL_DOMAIN = 'id.frnkness.ru'
export const TECH_EMAIL_RE = /^u-[0-9a-f]{32}@id\.frnkness\.ru$/

// Латиница, похожая на кириллицу (после перевода в нижний регистр), и 0 = о.
const LOOKALIKES: Record<string, string> = {
    a: 'а',
    b: 'в',
    c: 'с',
    e: 'е',
    h: 'н',
    k: 'к',
    m: 'м',
    o: 'о',
    p: 'р',
    t: 'т',
    x: 'х',
    y: 'у',
    '0': 'о',
    ё: 'е',
    '.': '_',
    '-': '_'
}

/** Ник как его ввели: без пробелов по краям, в NFC (й с macOS приходит разложенной). */
export function cleanNick(nick: string): string {
    return String(nick ?? '').normalize('NFC').trim()
}

/** Ключ уникальности ника. */
export function nickKey(nick: string): string {
    let out = ''
    for (const ch of cleanNick(nick).toLowerCase()) out += LOOKALIKES[ch] ?? ch
    return out
}

// Запрещены, если ключ ника совпадает или содержит (CONTAINS) / совпадает (EXACT).
const RESERVED_CONTAINS = ['admin', 'админ', 'moderator', 'модератор', 'support', 'поддержка', 'owner', 'владелец', 'administrator', 'администратор']
const RESERVED_EXACT = ['root', 'system', 'система', 'mod', 'модер', 'staff', 'help', 'помощь', 'official', 'null', 'undefined', 'anonymous', 'аноним', 'superuser']

const RESERVED_CONTAINS_KEYS = RESERVED_CONTAINS.map(nickKey)
const RESERVED_EXACT_KEYS = new Set(RESERVED_EXACT.map(nickKey))

export function isReservedNick(nick: string): boolean {
    const key = nickKey(nick)
    return RESERVED_EXACT_KEYS.has(key) || RESERVED_CONTAINS_KEYS.some((r) => key.includes(r))
}

/** Текст ошибки для пользователя или null, если ник подходит. */
export function validateNick(nick: string): string | null {
    const value = cleanNick(nick)
    const length = [...value].length
    if (length < NICK_MIN || length > NICK_MAX) return `Ник — от ${NICK_MIN} до ${NICK_MAX} символов`
    if (!NICK_RE.test(value)) return 'В нике можно использовать только русские и латинские буквы, цифры, «_», «.» и «-»'
    if (isReservedNick(value)) return 'Этот ник занят'
    return null
}

/** Текст ошибки или null, если пароль подходит. */
export function validatePassword(password: string, nick: string): string | null {
    const value = String(password ?? '')
    if ([...value].length < PASSWORD_MIN) return `Пароль — минимум ${PASSWORD_MIN} символов`
    if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) return 'Пароль слишком длинный'
    if (nick && nickKey(value) === nickKey(nick)) return 'Пароль не должен совпадать с ником'
    return null
}

async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Технический адрес аккаунта по нику. Пользователю не показывается. */
export async function techEmail(nick: string): Promise<string> {
    const hash = await sha256Hex(`frnkness-nick-v1:${nickKey(nick)}`)
    return `u-${hash.slice(0, 32)}@${TECH_EMAIL_DOMAIN}`
}

/** «О себе»: без управляющих символов, не длиннее BIO_MAX. */
export function cleanBio(bio: string): string {
    // eslint-disable-next-line no-control-regex
    return String(bio ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim()
}

export function validateBio(bio: string): string | null {
    return [...cleanBio(bio)].length > BIO_MAX ? `«О себе» — до ${BIO_MAX} символов` : null
}

/** Название плейлиста: одна строка без управляющих символов (как clean_user_text в базе). */
export const PLAYLIST_TITLE_MAX = 80
export const PLAYLIST_DESCRIPTION_MAX = 300

export function cleanPlaylistTitle(title: string): string {
    // eslint-disable-next-line no-control-regex
    return String(title ?? '').normalize('NFC').replace(/[\u0001-\u001F\u007F]/g, ' ').trim()
}

export function validatePlaylistTitle(title: string): string | null {
    const length = [...cleanPlaylistTitle(title)].length
    return length < 1 || length > PLAYLIST_TITLE_MAX ? `Название — от 1 до ${PLAYLIST_TITLE_MAX} символов` : null
}

/** Как часто пользователь может менять ник сам (админ — в любой момент). */
export const NICK_CHANGE_INTERVAL_DAYS = 30

export function nextNickChangeAt(changedAt: string | null): Date | null {
    if (!changedAt) return null
    const t = Date.parse(changedAt)
    if (Number.isNaN(t)) return null
    return new Date(t + NICK_CHANGE_INTERVAL_DAYS * 86_400_000)
}

export type AppRole = 'user' | 'admin' | 'owner'

export function roleOf(appMetadata: Record<string, unknown> | null | undefined): AppRole {
    const role = appMetadata?.role
    return role === 'admin' || role === 'owner' ? role : 'user'
}

export const isAdminRole = (role: AppRole): boolean => role === 'admin' || role === 'owner'
