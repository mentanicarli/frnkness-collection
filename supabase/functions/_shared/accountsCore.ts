/**
 * Логика Edge Functions аккаунтов без привязки к Deno и Supabase:
 *   register          — регистрация (капча, правила, лимит по IP)
 *   recovery-request  — заявка на восстановление (капча, лимиты, одинаковый ответ)
 *   account           — сам пользователь: смена пароля и ника, удаление аккаунта
 *   admin-users       — админка: сброс пароля, ник, аватар, бан, сеансы,
 *                       удаление, роли (роли — только владелец),
 *                       модерация плейлистов
 *
 * Все внешние зависимости приходят в AccountsDeps: index.ts каждой функции
 * подставляет настоящие (supabase-js с service role), тесты — фейковые.
 */
import {
    type AppRole,
    NICK_CHANGE_INTERVAL_DAYS,
    cleanBio,
    cleanNick,
    cleanPlaylistTitle,
    nickKey,
    roleOf,
    techEmail,
    validateBio,
    validateNick,
    validatePassword,
    validatePlaylistTitle
} from './accounts.ts'
import { HttpError, bearer, clientIp, keyHash, serveJson, str, verifyTurnstile } from './http.ts'
import { generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode } from './recoveryCode.ts'

export interface AuthUser {
    id: string
    email?: string | null
    app_metadata?: Record<string, unknown>
    banned_until?: string | null
}

export interface Profile {
    id: string
    nick: string
    nick_key: string
    avatar: string
    bio: string
}

export interface AccountPrivate {
    must_change_password: boolean
    nick_changed_at: string | null
}

export interface Playlist {
    id: string
    owner_id: string
    title: string
    cover_version: number | null
}

export interface UserUpdate {
    password?: string
    email?: string
    role?: 'user' | 'admin'
    ban?: boolean
}

export interface AccountsDeps {
    env: {
        turnstileSecret?: string
        hashSecret: string
    }
    fetch: typeof fetch
    now: () => number
    log?: (message: string) => void
    auth: {
        /** Пользователь по JWT — проверка на сервере Auth, app_metadata из базы. */
        getUser(jwt: string): Promise<AuthUser | null>
        getUserById(id: string): Promise<AuthUser | null>
        /** 'exists' — адрес (то есть ник) уже занят. */
        createUser(email: string, password: string): Promise<{ id: string } | 'exists'>
        updateUser(id: string, update: UserUpdate): Promise<void>
        deleteUser(id: string): Promise<void>
        /** Проверка пароля без побочных эффектов для пользователя. */
        verifyPassword(email: string, password: string): Promise<boolean>
    }
    db: {
        rateLimit(action: string, key: string, max: number, windowSeconds: number): Promise<boolean>
        profileById(id: string): Promise<Profile | null>
        profileByKey(key: string): Promise<Profile | null>
        /** false — ключ ника уже занят. */
        insertProfile(p: { id: string; nick: string; nick_key: string }): Promise<boolean>
        /** false — ключ ника уже занят. */
        updateProfile(id: string, patch: Partial<Pick<Profile, 'nick' | 'nick_key' | 'avatar' | 'bio'>>): Promise<boolean>
        getPrivate(id: string): Promise<AccountPrivate | null>
        upsertPrivate(id: string, patch: Partial<AccountPrivate>): Promise<void>
        insertRecovery(r: { nick: string; nick_key: string; user_id: string | null; contact: string; comment: string }): Promise<void>
        signOutUser(id: string): Promise<void>
        /** Код восстановления: в базе только хеш (supabase/migrations/20261012120000_recovery_tags.sql). */
        setRecoveryCode(userId: string, hash: string): Promise<void>
        /** true — хеш подошёл и код сгорел (удаление и проверка одним запросом). */
        consumeRecoveryCode(userId: string, hash: string): Promise<boolean>
        confirmRecoveryCode(userId: string): Promise<void>
        /** null — кода нет. */
        getRecoveryCodeState(userId: string): Promise<{ confirmed: boolean } | null>
        playlistById(id: string): Promise<Playlist | null>
        updatePlaylist(id: string, patch: { title?: string; cover_version?: null }): Promise<void>
        deletePlaylist(id: string): Promise<void>
    }
    storage: {
        removeAvatar(userId: string): Promise<void>
        /** Своя обложка плейлиста: файл <ownerId>/<playlistId> в playlist-covers. */
        removePlaylistCover(ownerId: string, playlistId: string): Promise<void>
        /** Все обложки пользователя (папка <userId>/). */
        removePlaylistCovers(userId: string): Promise<void>
    }
}

// ── Лимиты ──────────────────────────────────────────────────────────────
export const LIMITS = {
    registerPerIpDay: 10,
    recoveryPerIpDay: 3,
    recoveryPerNickDay: 3,
    // Вход по коду восстановления: считается каждая попытка, верная или нет.
    recoveryCodePerIpHour: 10,
    recoveryCodePerNickHour: 5,
    passwordChecksPerUserHour: 10
} as const

const DAY = 86_400
const HOUR = 3_600

const conflictNick = () => new HttpError(409, 'nick_taken', 'Этот ник занят')

function requireValid(error: string | null, code = 'invalid'): void {
    if (error) throw new HttpError(400, code, error)
}

async function requireCaptcha(deps: AccountsDeps, req: Request, body: Record<string, unknown>): Promise<string> {
    const ip = clientIp(req)
    const ok = await verifyTurnstile(deps.fetch, deps.env.turnstileSecret, str(body, 'captchaToken', 4096), ip)
    if (!ok) throw new HttpError(400, 'captcha', 'Проверка «я не робот» не пройдена — попробуй ещё раз')
    return ip
}

async function currentUser(deps: AccountsDeps, req: Request): Promise<AuthUser> {
    const jwt = bearer(req)
    if (!jwt) throw new HttpError(401, 'unauthorized', 'Нужно войти')
    const user = await deps.auth.getUser(jwt).catch(() => null)
    if (!user) throw new HttpError(401, 'unauthorized', 'Нужно войти')
    if (user.banned_until && Date.parse(user.banned_until) > deps.now()) throw new HttpError(403, 'banned', 'Аккаунт заблокирован')
    return user
}

async function checkPassword(deps: AccountsDeps, user: AuthUser, password: string): Promise<void> {
    if (!password) throw new HttpError(400, 'wrong_password', 'Введи пароль')
    const allowed = await deps.db.rateLimit('password-check', await keyHash(deps.env.hashSecret, user.id), LIMITS.passwordChecksPerUserHour, HOUR)
    if (!allowed) throw new HttpError(429, 'rate_limited', 'Слишком много попыток — попробуй через час')
    const ok = user.email ? await deps.auth.verifyPassword(user.email, password) : false
    if (!ok) throw new HttpError(400, 'wrong_password', 'Неверный пароль')
}

/** Смена ника: адрес аккаунта, затем профиль; при сбое профиля адрес возвращается. */
async function setNick(deps: AccountsDeps, userId: string, rawNick: string): Promise<Profile> {
    const nick = cleanNick(rawNick)
    requireValid(validateNick(nick))
    const profile = await deps.db.profileById(userId)
    if (!profile) throw new HttpError(404, 'not_found', 'Профиль не найден')
    const key = nickKey(nick)
    if (key !== profile.nick_key) {
        const other = await deps.db.profileByKey(key)
        if (other && other.id !== userId) throw conflictNick()
        await deps.auth.updateUser(userId, { email: await techEmail(nick) }).catch(() => {
            throw conflictNick()
        })
    }
    const ok = await deps.db.updateProfile(userId, { nick, nick_key: key })
    if (!ok) {
        if (key !== profile.nick_key) await deps.auth.updateUser(userId, { email: await techEmail(profile.nick) }).catch(() => undefined)
        throw conflictNick()
    }
    return { ...profile, nick, nick_key: key }
}

async function deleteAccount(deps: AccountsDeps, userId: string): Promise<void> {
    await deps.storage.removeAvatar(userId).catch((e) => deps.log?.(`avatar remove failed: ${e}`))
    // Файлы Storage база каскадом не удалит — только через API.
    await deps.storage.removePlaylistCovers(userId).catch((e) => deps.log?.(`playlist covers remove failed: ${e}`))
    await deps.db.signOutUser(userId).catch(() => undefined)
    // Профиль, флаги, сеансы, избранное, плейлисты, дружбы и заявки
    // удаляются каскадом, статистика — user_id = null.
    await deps.auth.deleteUser(userId)
}

/** Новый код: старый отменяется, в базу уходит только хеш, открытый код — владельцу. */
async function issueRecoveryCode(deps: AccountsDeps, userId: string): Promise<string> {
    const code = generateRecoveryCode()
    const hash = await hashRecoveryCode(deps.env.hashSecret, userId, code.replace(/-/g, ''))
    await deps.db.setRecoveryCode(userId, hash)
    return code
}

// ── register ────────────────────────────────────────────────────────────
export function createRegisterHandler(deps: AccountsDeps) {
    return serveJson(async (req, body) => {
        const nick = cleanNick(str(body, 'nick', 100))
        const password = str(body, 'password', 1000)
        if (body.agree !== true) throw new HttpError(400, 'agree', 'Нужно согласие с тем, какие данные мы храним')
        requireValid(validateNick(nick))
        requireValid(validatePassword(password, nick))
        const ip = await requireCaptcha(deps, req, body)

        const key = nickKey(nick)
        if (await deps.db.profileByKey(key)) throw conflictNick()
        const allowed = await deps.db.rateLimit('register-ip', await keyHash(deps.env.hashSecret, ip), LIMITS.registerPerIpDay, DAY)
        if (!allowed) throw new HttpError(429, 'rate_limited', 'Слишком много регистраций с этого адреса — попробуй завтра')

        const created = await deps.auth.createUser(await techEmail(nick), password)
        if (created === 'exists') throw conflictNick()
        if (!(await deps.db.insertProfile({ id: created.id, nick, nick_key: key }))) {
            await deps.auth.deleteUser(created.id).catch(() => undefined)
            throw conflictNick()
        }
        await deps.db.upsertPrivate(created.id, { must_change_password: false })
        // Код восстановления выдаётся сразу и показывается один раз. Сбой здесь
        // регистрацию не ломает: код можно создать позже в настройках.
        const recoveryCode = await issueRecoveryCode(deps, created.id).catch((e) => {
            deps.log?.(`recovery code issue failed: ${e}`)
            return null
        })
        return { ok: true, recoveryCode }
    }, deps.log)
}

// ── Восстановление по коду ──────────────────────────────────────────────
// Ответ при неверном нике и при неверном коде один и тот же, лимит считается
// по ключу ника независимо от того, есть ли такой ник, и хеш считается всегда:
// по ответу и по времени нельзя узнать, какие ники существуют.
const NO_ACCOUNT_ID = '00000000-0000-0000-0000-000000000000'
const wrongCode = () => new HttpError(400, 'invalid_code', 'Неверный ник или код')

async function recoverWithCode(deps: AccountsDeps, req: Request, body: Record<string, unknown>): Promise<unknown> {
    const nick = cleanNick(str(body, 'nick', 100))
    const codeInput = str(body, 'code', 100)
    const password = str(body, 'password', 1000)
    if (!nick || [...nick].length > 40 || !codeInput.trim() || !password) {
        throw new HttpError(400, 'invalid', 'Введи ник, код и новый пароль')
    }
    requireValid(validatePassword(password, nick))
    const ip = await requireCaptcha(deps, req, body)

    const key = nickKey(nick)
    const ipOk = await deps.db.rateLimit('recovery-code-ip', await keyHash(deps.env.hashSecret, ip), LIMITS.recoveryCodePerIpHour, HOUR)
    const nickOk = await deps.db.rateLimit('recovery-code-nick', await keyHash(deps.env.hashSecret, key), LIMITS.recoveryCodePerNickHour, HOUR)
    if (!ipOk || !nickOk) throw new HttpError(429, 'rate_limited', 'Слишком много попыток — попробуй позже')

    const profile = await deps.db.profileByKey(key)
    const normalized = normalizeRecoveryCode(codeInput)
    const hash = await hashRecoveryCode(deps.env.hashSecret, profile?.id ?? NO_ACCOUNT_ID, normalized ?? 'invalid-format')
    const ok = profile && normalized ? await deps.db.consumeRecoveryCode(profile.id, hash) : false
    if (!profile || !ok) throw wrongCode()

    // Код уже сгорел. Если смена пароля не удалась, возвращаем его: человек не должен остаться и без кода, и без пароля.
    try {
        await deps.auth.updateUser(profile.id, { password })
        await deps.db.upsertPrivate(profile.id, { must_change_password: false })
        await deps.db.signOutUser(profile.id)
    } catch (e) {
        await deps.db.setRecoveryCode(profile.id, hash).catch(() => undefined)
        await deps.db.confirmRecoveryCode(profile.id).catch(() => undefined)
        throw e
    }
    return { ok: true }
}

// ── recovery-request ────────────────────────────────────────────────────
// Ответ всегда одинаковый: и для несуществующего ника, и при исчерпанном
// лимите — по форме нельзя узнать, какие ники есть.
export function createRecoveryHandler(deps: AccountsDeps) {
    return serveJson(async (req, body) => {
        if (body.mode === 'code') return recoverWithCode(deps, req, body)
        const nick = cleanNick(str(body, 'nick', 100))
        const contact = str(body, 'contact', 1000).trim()
        const comment = str(body, 'comment', 2000).trim()
        if (!nick || [...nick].length > 40) throw new HttpError(400, 'invalid', 'Укажи ник')
        if (!contact) throw new HttpError(400, 'invalid', 'Укажи, как с тобой связаться')
        if ([...contact].length > 200) throw new HttpError(400, 'invalid', 'Контакт — до 200 символов')
        if ([...comment].length > 500) throw new HttpError(400, 'invalid', 'Комментарий — до 500 символов')
        const ip = await requireCaptcha(deps, req, body)

        const key = nickKey(nick)
        const ipOk = await deps.db.rateLimit('recovery-ip', await keyHash(deps.env.hashSecret, ip), LIMITS.recoveryPerIpDay, DAY)
        const nickOk = ipOk && (await deps.db.rateLimit('recovery-nick', await keyHash(deps.env.hashSecret, key), LIMITS.recoveryPerNickDay, DAY))
        if (ipOk && nickOk) {
            const profile = await deps.db.profileByKey(key)
            await deps.db.insertRecovery({ nick, nick_key: key, user_id: profile?.id ?? null, contact, comment: cleanBio(comment) })
        }
        return { ok: true }
    }, deps.log)
}

// ── account ─────────────────────────────────────────────────────────────
export function createAccountHandler(deps: AccountsDeps) {
    return serveJson(async (req, body) => {
        const user = await currentUser(deps, req)
        const action = str(body, 'action', 40)

        if (action === 'change-password') {
            const password = str(body, 'password', 1000)
            const profile = await deps.db.profileById(user.id)
            const priv = await deps.db.getPrivate(user.id)
            // После сброса админом текущий (временный) пароль не спрашиваем:
            // человек только что вошёл с ним.
            if (!priv?.must_change_password) await checkPassword(deps, user, str(body, 'current', 1000))
            requireValid(validatePassword(password, profile?.nick ?? ''))
            if (priv?.must_change_password && user.email && (await deps.auth.verifyPassword(user.email, password))) {
                throw new HttpError(400, 'invalid', 'Новый пароль должен отличаться от временного')
            }
            await deps.auth.updateUser(user.id, { password })
            await deps.db.upsertPrivate(user.id, { must_change_password: false })
            return { ok: true }
        }

        if (action === 'recovery-code-create') {
            // Пока прошлый код не подтверждён («Я сохранил»), заменить его можно без пароля:
            // так продолжается регистрация после перезагрузки страницы.
            const state = await deps.db.getRecoveryCodeState(user.id)
            if (!state || state.confirmed) await checkPassword(deps, user, str(body, 'password', 1000))
            return { ok: true, recoveryCode: await issueRecoveryCode(deps, user.id) }
        }

        if (action === 'recovery-code-confirm') {
            await deps.db.confirmRecoveryCode(user.id)
            return { ok: true }
        }

        if (action === 'change-nick') {
            const priv = await deps.db.getPrivate(user.id)
            if (priv?.nick_changed_at) {
                const next = Date.parse(priv.nick_changed_at) + NICK_CHANGE_INTERVAL_DAYS * DAY * 1000
                if (next > deps.now()) {
                    throw new HttpError(429, 'too_soon', `Ник можно менять раз в ${NICK_CHANGE_INTERVAL_DAYS} дней — следующий раз ${new Date(next).toLocaleDateString('ru-RU')}`)
                }
            }
            const profile = await setNick(deps, user.id, str(body, 'nick', 100))
            await deps.db.upsertPrivate(user.id, { nick_changed_at: new Date(deps.now()).toISOString() })
            return { ok: true, nick: profile.nick }
        }

        if (action === 'delete-account') {
            if (roleOf(user.app_metadata) === 'owner') throw new HttpError(403, 'owner', 'Аккаунт владельца удалить нельзя')
            await checkPassword(deps, user, str(body, 'password', 1000))
            await deleteAccount(deps, user.id)
            return { ok: true }
        }

        throw new HttpError(400, 'bad_action', 'Неизвестное действие')
    }, deps.log)
}

// ── admin-users ─────────────────────────────────────────────────────────
export const ADMIN_ACTIONS = [
    'reset-password',
    'rename',
    'set-bio',
    'remove-avatar',
    'ban',
    'unban',
    'sign-out',
    'delete',
    'set-role',
    // Модерация плейлистов пользователя userId (плейлист — playlistId).
    'playlist-rename',
    'playlist-delete',
    'playlist-cover-remove'
] as const
export type AdminAction = (typeof ADMIN_ACTIONS)[number]

const OWNER_PROTECTED: AdminAction[] = ['ban', 'delete', 'set-role', 'sign-out', 'reset-password']

/**
 * Можно ли actor выполнить action над target. null — можно, иначе текст отказа.
 * Владельца не трогает никто (кроме него самого — ник, «о себе», аватар).
 * Над админами действует только владелец. Роли выдаёт только владелец.
 */
export function adminPermission(actor: { id: string; role: AppRole }, target: { id: string; role: AppRole }, action: AdminAction): string | null {
    if (actor.role !== 'admin' && actor.role !== 'owner') return 'Нет доступа'
    if (action === 'set-role' && actor.role !== 'owner') return 'Выдавать и снимать права админа может только владелец'
    if (target.role === 'owner') {
        if (actor.id !== target.id) return 'Владельца нельзя изменить из админки'
        if (OWNER_PROTECTED.includes(action)) return 'Владельца нельзя забанить, удалить или понизить'
        return null
    }
    if (target.role === 'admin' && actor.role !== 'owner') return 'Действия над админами — только у владельца'
    return null
}

export function createAdminUsersHandler(deps: AccountsDeps) {
    return serveJson(async (req, body) => {
        const actorUser = await currentUser(deps, req)
        const actor = { id: actorUser.id, role: roleOf(actorUser.app_metadata) }
        if (actor.role !== 'admin' && actor.role !== 'owner') throw new HttpError(403, 'forbidden', 'Нет доступа')

        const action = str(body, 'action', 40) as AdminAction
        if (!ADMIN_ACTIONS.includes(action)) throw new HttpError(400, 'bad_action', 'Неизвестное действие')
        const userId = str(body, 'userId', 64)
        if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new HttpError(400, 'bad_request', 'Неверный пользователь')
        const targetUser = await deps.auth.getUserById(userId)
        if (!targetUser) throw new HttpError(404, 'not_found', 'Пользователь не найден')
        const target = { id: targetUser.id, role: roleOf(targetUser.app_metadata) }

        const denied = adminPermission(actor, target, action)
        if (denied) throw new HttpError(403, 'forbidden', denied)

        if (action.startsWith('playlist-')) {
            const playlistId = str(body, 'playlistId', 64)
            if (!/^[0-9a-f-]{36}$/i.test(playlistId)) throw new HttpError(400, 'bad_request', 'Неверный плейлист')
            const playlist = await deps.db.playlistById(playlistId)
            if (!playlist || playlist.owner_id !== userId) throw new HttpError(404, 'not_found', 'Плейлист не найден')
            switch (action) {
                case 'playlist-rename': {
                    const title = cleanPlaylistTitle(str(body, 'title', 1000))
                    requireValid(validatePlaylistTitle(title))
                    await deps.db.updatePlaylist(playlistId, { title })
                    return { ok: true, title }
                }
                case 'playlist-cover-remove':
                    await deps.storage.removePlaylistCover(userId, playlistId)
                    await deps.db.updatePlaylist(playlistId, { cover_version: null })
                    break
                case 'playlist-delete':
                    // Сначала файл: строка без файла — норма, файл без строки — мусор.
                    await deps.storage.removePlaylistCover(userId, playlistId)
                    await deps.db.deletePlaylist(playlistId)
                    break
            }
            return { ok: true }
        }

        switch (action) {
            case 'reset-password': {
                const password = str(body, 'password', 1000)
                const profile = await deps.db.profileById(userId)
                requireValid(validatePassword(password, profile?.nick ?? ''))
                await deps.auth.updateUser(userId, { password })
                await deps.db.upsertPrivate(userId, { must_change_password: true })
                await deps.db.signOutUser(userId)
                break
            }
            case 'rename': {
                const profile = await setNick(deps, userId, str(body, 'nick', 100))
                return { ok: true, nick: profile.nick }
            }
            case 'set-bio': {
                const bio = cleanBio(str(body, 'bio', 2000))
                requireValid(validateBio(bio))
                await deps.db.updateProfile(userId, { bio })
                break
            }
            case 'remove-avatar':
                await deps.storage.removeAvatar(userId)
                await deps.db.updateProfile(userId, { avatar: 'initials:0' })
                break
            case 'ban':
                if (target.id === actor.id) throw new HttpError(400, 'self', 'Нельзя забанить себя')
                await deps.auth.updateUser(userId, { ban: true })
                await deps.db.signOutUser(userId)
                break
            case 'unban':
                await deps.auth.updateUser(userId, { ban: false })
                break
            case 'sign-out':
                await deps.db.signOutUser(userId)
                break
            case 'delete':
                if (target.id === actor.id) throw new HttpError(400, 'self', 'Свой аккаунт удаляется в настройках сайта')
                await deleteAccount(deps, userId)
                break
            case 'set-role': {
                const role = str(body, 'role', 10)
                if (role !== 'user' && role !== 'admin') throw new HttpError(400, 'invalid', 'Роль — user или admin')
                await deps.auth.updateUser(userId, { role })
                break
            }
        }
        return { ok: true }
    }, deps.log)
}
