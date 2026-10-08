// Проверка сборки: админка изолирована от основного сайта.
//   1. В графе загрузки index.html (статические и динамические импорты)
//      нет чанков admin-* и кода админки.
//   2. В precache service worker только файлы основного сайта.
//   3. admin.html существует и закрыт от индексации.
// Запускается после vite build (npm run build), падает с кодом 1.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const dist = path.resolve(process.argv[2] || 'dist')
const errors = []
const read = (rel) => fs.readFileSync(path.join(dist, rel), 'utf8')

// Строки, которые есть только в коде админки.
const ADMIN_MARKERS = ['admin-content', 'admin-users', 'admin_users_list', 'owner_recovery_list']

function collectGraph(entryHtml) {
    const html = read(entryHtml)
    const queue = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1])
    const seen = new Set()
    while (queue.length) {
        const rel = queue.shift()
        if (seen.has(rel)) continue
        seen.add(rel)
        if (!rel.endsWith('.js')) continue
        const code = read(rel)
        const dir = path.posix.dirname(rel)
        // import "./x.js", import("./x.js"), а также пути в __vite__mapDeps.
        for (const m of code.matchAll(/["'`](\.{1,2}\/[^"'`]+?\.(?:js|css))["'`]/g)) {
            const target = path.posix.normalize(path.posix.join(dir, m[1]))
            // Строки вида "./sw.js" — пути от документа, а не соседние чанки.
            if (fs.existsSync(path.join(dist, target))) queue.push(target)
        }
        for (const m of code.matchAll(/["'`](assets\/[^"'`]+?\.(?:js|css))["'`]/g)) queue.push(m[1])
    }
    return seen
}

if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error(`check-dist: нет ${dist}/index.html — сначала vite build`)
    process.exit(1)
}

const mainGraph = collectGraph('index.html')
for (const rel of mainGraph) {
    if (path.posix.basename(rel).startsWith('admin-')) errors.push(`основной сайт загружает чанк админки: ${rel}`)
    if (!fs.existsSync(path.join(dist, rel))) {
        errors.push(`не найден файл из графа сайта: ${rel}`)
        continue
    }
    const code = read(rel)
    for (const marker of ADMIN_MARKERS) {
        if (code.includes(marker)) errors.push(`в ${rel} есть код админки («${marker}»)`)
    }
}

const sw = read('sw.js')
const manifestMatch = sw.match(/\[\{[^\]]*"url"[^\]]*\}\]/)
if (!manifestMatch) errors.push('не найден precache-манифест в sw.js')
const precache = manifestMatch ? JSON.parse(manifestMatch[0]).map((e) => e.url) : []
for (const url of precache) {
    if (/admin/i.test(url)) errors.push(`admin-файл в precache: ${url}`)
    if (url.startsWith('assets/') && !mainGraph.has(url)) errors.push(`в precache файл не из основного сайта: ${url}`)
}
for (const rel of mainGraph) {
    if (!precache.includes(rel)) errors.push(`файл сайта не попал в precache: ${rel}`)
}

// CSP: тег есть в обеих страницах, встроенные скрипты разрешены только хешем.
for (const page of ['index.html', 'admin.html']) {
    if (!fs.existsSync(path.join(dist, page))) continue
    const csp = read(page).match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1]
    if (!csp) errors.push(`${page}: нет Content-Security-Policy`)
    else {
        if (!/script-src [^;]*https:\/\/challenges\.cloudflare\.com/.test(csp)) errors.push(`${page}: CSP без Turnstile`)
        if (!/img-src [^;]*https:\/\/[^ ;]+\.supabase\.co/.test(csp)) errors.push(`${page}: CSP без хранилища Supabase в img-src`)
        if (/script-src [^;]*'unsafe-inline'/.test(csp)) errors.push(`${page}: CSP разрешает любые встроенные скрипты`)
    }
}

// Превью ссылок: у каждого релиза и трека из реестра есть своя страница с
// og-тегами и перенаправлением по CSP-хешу; на главной есть общие og-теги.
// Реестр здесь — просто то, что собрано; названия релизов скрипт не знает.
{
    const og = (html, prop) => html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`))?.[1]
    const checkPage = (rel, label) => {
        if (!fs.existsSync(path.join(dist, rel))) return errors.push(`нет страницы превью ${label}: ${rel}`)
        const html = read(rel)
        for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) if (!og(html, prop)) errors.push(`${rel}: нет ${prop}`)
        if (!/^https:\/\/[^/]+\//.test(og(html, 'og:image') || '')) errors.push(`${rel}: og:image не абсолютный URL`)
        if (!/<meta name="twitter:card" content="summary_large_image">/.test(html)) errors.push(`${rel}: нет twitter:card`)
        const code = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
        const hash = code && `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`
        const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        if (!code || !csp.includes(`script-src ${hash}`)) errors.push(`${rel}: хеш CSP не совпадает со скриптом перенаправления`)
    }
    const registry = JSON.parse(fs.readFileSync(path.resolve('src/content/releases.json'), 'utf8'))
    for (const [id, release] of Object.entries(registry)) {
        checkPage(`r/${id}/index.html`, `релиза ${id}`)
        for (const track of release.tracks) {
            const slug = String(track.lyricsFile || '').replace(/\.[^/.]+$/, '').replace(/^\d+-/, '') || String(track.num)
            checkPage(`t/${id}/${slug}/index.html`, `трека ${id}/${slug}`)
        }
    }
    const home = read('index.html')
    for (const prop of ['og:title', 'og:description', 'og:image', 'og:url']) if (!og(home, prop)) errors.push(`index.html: нет ${prop}`)
    if (!fs.existsSync(path.join(dist, 'og-default.png'))) errors.push('нет dist/og-default.png (общая картинка превью)')
    for (const url of precache) if (/^(r|t)\//.test(url)) errors.push(`страница превью в precache: ${url}`)
}

if (!fs.existsSync(path.join(dist, 'admin.html'))) errors.push('нет dist/admin.html')
else {
    const adminHtml = read('admin.html')
    if (!/<meta name="robots" content="noindex/.test(adminHtml)) errors.push('admin.html без <meta name="robots" content="noindex">')
    const adminGraph = collectGraph('admin.html')
    if (![...adminGraph].some((rel) => path.posix.basename(rel).startsWith('admin-'))) errors.push('admin.html не загружает чанки admin-*')
}

if (errors.length) {
    console.error('check-dist: ОШИБКИ\n  ' + errors.join('\n  '))
    process.exit(1)
}
console.log(`check-dist: ок — сайт: ${mainGraph.size} файлов, precache: ${precache.length}, кода админки в сайте нет`)
