// Адрес и публичный ключ Supabase. Отдельный модуль, чтобы админка
// брала их без реестра релизов из config.ts.
const DEFAULT_SUPABASE_URL = 'https://momcakikuivtvxkmgjhx.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_ept_0dlTFn9cWLM0wIK2JA_a7xNSx-I'

// Публичный ключ (Site Key) виджета Cloudflare Turnstile — капча при
// регистрации и в заявке «Забыли пароль?». Секретный ключ хранится только
// в секретах Edge Functions (TURNSTILE_SECRET_KEY). См. docs/accounts-setup.md.
const DEFAULT_TURNSTILE_SITE_KEY = ''

// Fallback-значения нужны для локального запуска, если env не задан.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || DEFAULT_TURNSTILE_SITE_KEY

// Сессия общая у сайта и админки (один origin): вошёл на сайте с ролью
// admin/owner — админка открывается без повторного входа.
export const AUTH_STORAGE_KEY = 'frnk-auth'

export function functionUrl(name: string): string {
    return `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${name}`
}

/** Публичная ссылка на свою картинку-аватар (бакет avatars). */
export function avatarUploadUrl(userId: string, version: string): string {
    return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/avatars/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(version)}`
}
