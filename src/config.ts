import type { Releases, SiteSettings } from '@/types'
import releasesData from './content/releases.json'
import siteData from './content/site.json'

// Центральный конфиг приложения: env-переменные и контент сайта.
// Сам контент лежит в src/content/*.json — эти файлы правит админка,
// поэтому в них только данные, без кода.
export { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseConfig'

// Настройки сайта (промо-блок на главной) — src/content/site.json.
export const siteSettings: SiteSettings = siteData as SiteSettings

export const SHOW_NEW_RELEASE_PROMO = siteSettings.promo.enabled
export const PROMO_RELEASE_ID = siteSettings.promo.releaseId
// Анонс будущего релиза; блок в site.json необязательный.
export const ANNOUNCE = siteSettings.announce ?? null

// Единый источник данных по дискографии, трекам и путям к медиа/текстам —
// src/content/releases.json. Порядок ключей задаёт порядок карточек на главной.
export const releases: Releases = releasesData as Releases
