// Проверка сборки: админка изолирована от основного сайта.
//   1. В графе загрузки index.html (статические и динамические импорты)
//      нет чанков admin-* и кода админки.
//   2. В precache service worker только файлы основного сайта.
//   3. admin.html существует и закрыт от индексации.
// Запускается после vite build (npm run build), падает с кодом 1.
import fs from 'node:fs'
import path from 'node:path'

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
