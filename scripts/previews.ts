// Статические страницы для превью ссылок (Telegram, VK, WhatsApp и т. п.).
//
// Мессенджеры не читают часть адреса после «#», поэтому «#/track/…» у всех
// выглядит как главная. Для каждого релиза и трека при сборке создаётся
// страница с og-тегами:
//   /r/<releaseId>/index.html            → #/release/<releaseId>
//   /t/<releaseId>/<slug>/index.html     → #/track/<releaseId>/<slug>
// Человека страница сразу перенаправляет на нужный «#/…» адрес сайта.
//
// Перенаправление — встроенный скрипт, разрешённый в CSP страницы по хешу
// его текста (как в index.html). Тега <meta http-equiv="refresh"> нет
// намеренно: часть краулеров идёт по нему на главную и берёт её общие теги,
// а превью должно остаться от этой страницы. Без JavaScript остаётся ссылка.
//
// Модуль не читает файлы сам (проверку наличия обложки передаёт вызывающий),
// поэтому его можно тестировать на фикстуре каталога.
import { createHash } from 'node:crypto'
import type { Release, Releases } from '../src/types'
import { releaseSharePath, trackSharePath } from '../src/utils/share'
import { getTrackSlug } from '../src/utils/slug'

export const DEFAULT_SITE_URL = 'https://frnkness.ru'
/** Общая картинка сайта: public/og-default.png, 1200×630. */
export const DEFAULT_IMAGE_PATH = 'og-default.png'
export const SITE_TITLE = 'frnk ness collection'
export const SITE_DESCRIPTION = 'Треки, тексты и караоке frnk ness. Слушай, делись с друзьями и слушай вместе.'
const ARTIST = 'frnk ness'

export interface PreviewOptions {
    /** Публичный адрес сайта без «/» на конце. */
    siteUrl?: string
    /** Есть ли файл (путь от корня сайта, например images/x.jpg). */
    fileExists: (rel: string) => boolean
}

export interface PreviewPage {
    /** Путь файла в сборке, например t/id/slug/index.html. */
    file: string
    html: string
}

export function normalizeSiteUrl(raw: string | undefined): string {
    const value = (raw || '').trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s/]+/i.test(value)) return DEFAULT_SITE_URL
    return value
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
/** Экранирование для текста и значений атрибутов. */
export function escapeHtml(value: string): string {
    return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch])
}

/** Путь файла сайта в URL: каждый сегмент кодируется (пробелы, кириллица). */
function encodePath(rel: string): string {
    return rel
        .replace(/^\.?\/+/, '')
        .split('/')
        .map(encodeURIComponent)
        .join('/')
}

/**
 * Картинка превью: обложка трека (необязательное поле track.cover, если оно
 * когда-нибудь появится), иначе обложка релиза, иначе общая картинка сайта.
 * Всегда абсолютный URL.
 */
export function resolveImage(siteUrl: string, candidates: (string | undefined)[], fileExists: (rel: string) => boolean): string {
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim() && !/^[a-z]+:/i.test(c) && fileExists(c.replace(/^\.?\/+/, ''))) {
            return `${siteUrl}/${encodePath(c)}`
        }
    }
    return `${siteUrl}/${DEFAULT_IMAGE_PATH}`
}

function kindLabel(release: Release): string {
    return release.type === 'album' ? 'Альбом' : 'Сингл'
}

function pluralTracks(n: number): string {
    const m10 = n % 10
    const m100 = n % 100
    if (m10 === 1 && m100 !== 11) return `${n} трек`
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} трека`
    return `${n} треков`
}

interface PageMeta {
    title: string
    description: string
    image: string
    url: string
    /** Тип og:type. */
    type: 'website' | 'music.song' | 'music.album'
}

function metaTags(m: PageMeta): string {
    const t = escapeHtml
    return [
        `<meta name="description" content="${t(m.description)}">`,
        `<link rel="canonical" href="${t(m.url)}">`,
        `<meta property="og:site_name" content="${t(SITE_TITLE)}">`,
        `<meta property="og:locale" content="ru_RU">`,
        `<meta property="og:type" content="${m.type}">`,
        `<meta property="og:title" content="${t(m.title)}">`,
        `<meta property="og:description" content="${t(m.description)}">`,
        `<meta property="og:url" content="${t(m.url)}">`,
        `<meta property="og:image" content="${t(m.image)}">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${t(m.title)}">`,
        `<meta name="twitter:description" content="${t(m.description)}">`,
        `<meta name="twitter:image" content="${t(m.image)}">`
    ].join('\n    ')
}

/** Теги для главной страницы (index.html). */
export function homeMetaTags(siteUrl: string): string {
    return metaTags({
        title: SITE_TITLE,
        description: SITE_DESCRIPTION,
        image: `${siteUrl}/${DEFAULT_IMAGE_PATH}`,
        url: `${siteUrl}/`,
        type: 'website'
    })
}

/**
 * Скрипт перенаправления. Адрес — литерал в JSON (безопасно для вставки
 * в <script>: «<» экранируется).
 */
export function redirectScript(target: string): string {
    const literal = JSON.stringify(target).replace(/</g, '\\u003c')
    return `location.replace(${literal});`
}

export function scriptHash(code: string): string {
    return `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`
}

/** CSP страницы-превью: ничего, кроме собственного скрипта по хешу. */
export function previewCsp(code: string): string {
    return `default-src 'none'; script-src ${scriptHash(code)}; base-uri 'none'; form-action 'none'`
}

function renderPage(meta: PageMeta, target: string, linkText: string): string {
    const code = redirectScript(target)
    const t = escapeHtml
    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${t(previewCsp(code))}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#000000">
    <title>${t(meta.title)}</title>
    ${metaTags(meta)}
</head>
<body>
    <p><a href="${t(target)}">${t(linkText)}</a></p>
    <script>${code}</script>
</body>
</html>
`
}

/** Относительный адрес корня сайта из страницы на глубине depth. */
function rootFrom(depth: number): string {
    return '../'.repeat(depth)
}

export function buildPreviewPages(releases: Releases, options: PreviewOptions): PreviewPage[] {
    const siteUrl = normalizeSiteUrl(options.siteUrl)
    const pages: PreviewPage[] = []

    for (const [releaseId, release] of Object.entries(releases)) {
        if (!release || !Array.isArray(release.tracks)) continue
        const releasePath = releaseSharePath(releaseId)
        const releaseImage = resolveImage(siteUrl, [release.cover], options.fileExists)

        const bits = [kindLabel(release), release.releaseDate || release.year, pluralTracks(release.tracks.length)].filter(Boolean)
        pages.push({
            file: `${releasePath}index.html`,
            html: renderPage(
                {
                    title: `${release.title} — ${ARTIST}`,
                    description: `${bits.join(' • ')}. Слушать на ${SITE_TITLE}.`,
                    image: releaseImage,
                    url: `${siteUrl}/${releasePath}`,
                    type: 'music.album'
                },
                `${rootFrom(2)}#/release/${encodeURIComponent(releaseId)}`,
                `Открыть «${release.title}»`
            )
        })

        for (const track of release.tracks) {
            const slug = getTrackSlug(track)
            const trackPath = trackSharePath(releaseId, slug)
            const image = resolveImage(siteUrl, [(track as { cover?: string }).cover, release.cover], options.fileExists)
            pages.push({
                file: `${trackPath}index.html`,
                html: renderPage(
                    {
                        title: `${track.title} — ${ARTIST}`,
                        description: `${kindLabel(release)} «${release.title}» • ${release.releaseDate || release.year}. Слушать и читать текст на ${SITE_TITLE}.`,
                        image,
                        url: `${siteUrl}/${trackPath}`,
                        type: 'music.song'
                    },
                    `${rootFrom(3)}#/track/${encodeURIComponent(releaseId)}/${encodeURIComponent(slug)}`,
                    `Открыть «${track.title}»`
                )
            })
        }
    }
    return pages
}
