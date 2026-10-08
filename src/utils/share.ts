import type { Track } from '@/types'
import { getTrackSlug } from './slug'

/**
 * Ссылки «Поделиться» и «Скопировать ссылку».
 *
 * Мессенджеры не читают часть адреса после «#», поэтому делиться нужно не
 * «#/track/…», а статической страницей, которую сборка создаёт для каждого
 * релиза и трека (scripts/previews.ts): у неё свои og-теги, а открывшего
 * она сразу перенаправляет на «#/…» адрес сайта. Старые ссылки с «#»
 * продолжают работать.
 */

/** Путь страницы-превью релиза от корня сайта: r/<releaseId>/. */
export function releaseSharePath(releaseId: string): string {
    return `r/${encodeURIComponent(releaseId)}/`
}

/** Путь страницы-превью трека от корня сайта: t/<releaseId>/<slug>/. */
export function trackSharePath(releaseId: string, slug: string): string {
    return `t/${encodeURIComponent(releaseId)}/${encodeURIComponent(slug)}/`
}

/** Адрес корня сайта (с учётом подпапки, где он лежит) — как base у сборки. */
export function siteRoot(loc: Pick<Location, 'origin' | 'pathname'> = window.location): string {
    return `${loc.origin}${loc.pathname.replace(/[^/]*$/, '')}`
}

export function releaseShareUrl(releaseId: string, root: string = siteRoot()): string {
    return new URL(releaseSharePath(releaseId), root).href
}

export function trackShareUrl(releaseId: string, track: Pick<Track, 'num' | 'lyricsFile'>, root: string = siteRoot()): string {
    return new URL(trackSharePath(releaseId, getTrackSlug(track)), root).href
}
