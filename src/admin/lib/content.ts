import type { Releases, SiteSettings } from '@/types'

/**
 * Сериализация src/content/*.json — в формате текущих файлов (4 пробела,
 * перевод строки в конце), чтобы коммит менял только нужные строки.
 */
export function serializeSite(settings: SiteSettings): string {
    return JSON.stringify({ promo: { enabled: settings.promo.enabled, releaseId: settings.promo.releaseId } }, null, 4) + '\n'
}

export function serializeReleases(releases: Releases): string {
    return JSON.stringify(releases, null, 4) + '\n'
}
