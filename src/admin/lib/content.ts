import type { Releases, SiteSettings } from '@/types'

/**
 * Сериализация src/content/*.json — в формате текущих файлов (4 пробела,
 * перевод строки в конце), чтобы коммит менял только нужные строки.
 */
export function serializeSite(settings: SiteSettings): string {
    const out: Record<string, unknown> = { promo: { enabled: settings.promo.enabled, releaseId: settings.promo.releaseId } }
    const a = settings.announce
    if (a) {
        out.announce = {
            enabled: a.enabled,
            title: a.title.trim(),
            cover: a.cover,
            ...(a.releaseAt ? { releaseAt: a.releaseAt } : {}),
            ...(a.text && a.text.trim() ? { text: a.text.trim() } : {}),
            ...(a.url && a.url.trim() ? { url: a.url.trim() } : {})
        }
    }
    return JSON.stringify(out, null, 4) + '\n'
}

export function serializeReleases(releases: Releases): string {
    return JSON.stringify(releases, null, 4) + '\n'
}
