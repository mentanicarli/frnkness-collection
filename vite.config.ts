/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'
import fs from 'fs'
import { injectCsp } from './scripts/csp'
import { normalizeBase } from './src/supabaseRoute'
import { COVER_WIDTHS } from './src/utils/cover'
import { buildPreviewPages, homeMetaTags, normalizeSiteUrl } from './scripts/previews'

// Адрес Supabase для CSP: из env сборки или значение по умолчанию из
// src/supabaseConfig.ts (один источник — сам файл конфига).
function supabaseUrlFor(mode: string): string {
    const env = loadEnv(mode, __dirname, 'VITE_')
    if (env.VITE_SUPABASE_URL) return env.VITE_SUPABASE_URL
    const config = fs.readFileSync(path.resolve(__dirname, 'src/supabaseConfig.ts'), 'utf-8')
    const m = config.match(/DEFAULT_SUPABASE_URL = '([^']+)'/)
    if (!m) throw new Error('vite.config: не найден DEFAULT_SUPABASE_URL в src/supabaseConfig.ts')
    return m[1]
}

// Адрес посредника для CSP: env сборки или DEFAULT_SUPABASE_PROXY_URL из
// src/supabaseConfig.ts. Невалидный адрес сайт тоже игнорирует (normalizeBase).
function proxyUrlFor(mode: string): string {
    const env = loadEnv(mode, __dirname, 'VITE_')
    if (env.VITE_SUPABASE_PROXY_URL) return normalizeBase(env.VITE_SUPABASE_PROXY_URL)
    const config = fs.readFileSync(path.resolve(__dirname, 'src/supabaseConfig.ts'), 'utf-8')
    const m = config.match(/DEFAULT_SUPABASE_PROXY_URL = '([^']*)'/)
    if (!m) throw new Error('vite.config: не найден DEFAULT_SUPABASE_PROXY_URL в src/supabaseConfig.ts')
    return normalizeBase(m[1])
}

// Склеивает тексты в один JSON, чтобы поиску по строкам не приходилось
// делать отдельный запрос на каждый трек: .lrc (строки со временем), а для
// треков без караоке — обычный .txt. Файл отдаётся и в dev через
// middleware, поэтому обе среды идут по одному и тому же пути.
const LYRICS_INDEX_FILE = 'lyrics-index.json'
const TRACK_NOTES_FILE = 'track-notes.json'

function buildLyricsIndex() {
    const root = path.resolve(__dirname, 'lyrics')
    const index: Record<string, string> = {}
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                walk(full)
                continue
            }
            const name = entry.name.toLowerCase()
            const isLrc = name.endsWith('.lrc')
            // .txt берём, только если у трека нет .lrc: иначе строки задвоятся,
            // а у строк из .lrc есть время для перехода в караоке.
            const isTxtWithoutLrc = name.endsWith('.txt') && !fs.existsSync(full.replace(/\.txt$/i, '.lrc'))
            if (!isLrc && !isTxtWithoutLrc) continue
            const rel = path.relative(__dirname, full).split(path.sep).join('/')
            index[rel] = fs.readFileSync(full, 'utf-8')
        }
    }
    if (fs.existsSync(root)) walk(root)
    return JSON.stringify(index)
}

// Собирает *.notes.json (описание трека и разборы строк) в один файл,
// чтобы страница трека не ходила за ними по отдельности.
function buildTrackNotes() {
    const root = path.resolve(__dirname, 'lyrics')
    const notes: Record<string, unknown> = {}
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                walk(full)
                continue
            }
            if (!entry.name.toLowerCase().endsWith('.notes.json')) continue
            const rel = path.relative(__dirname, full).split(path.sep).join('/')
            try {
                notes[rel] = JSON.parse(fs.readFileSync(full, 'utf-8'))
            } catch (e) {
                // Битый JSON не должен ронять сборку — предупреждаем и пропускаем.
                console.warn(`[track-notes] пропущен ${rel}: ${(e as Error).message}`)
            }
        }
    }
    if (fs.existsSync(root)) walk(root)
    return JSON.stringify(notes)
}

// Превью ссылок (scripts/previews.ts): общие og-теги в index.html (вместо
// маркера <!--OG_TAGS-->) и статические страницы /r/<релиз>/ и /t/<релиз>/<слаг>/
// для каждого релиза и трека. Реестр читается при каждой сборке, поэтому
// сборка «только контент» (правка из админки) и новый релиз сразу получают
// свои страницы. Адрес сайта — VITE_SITE_URL, по умолчанию https://frnkness.ru.
function previewsPlugin(siteUrl: string) {
    return {
        name: 'frnkness-previews',
        transformIndexHtml: {
            order: 'pre' as const,
            handler: (html: string) => html.replace('<!--OG_TAGS-->', homeMetaTags(siteUrl))
        },
        generateBundle(this: any) {
            const releases = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'src/content/releases.json'), 'utf-8'))
            const fileExists = (rel: string) => {
                // Обложки лежат в images/ (копируются в сборку как есть); общая картинка — в public/.
                return fs.existsSync(path.resolve(__dirname, rel)) || fs.existsSync(path.resolve(__dirname, 'public', rel))
            }
            for (const page of buildPreviewPages(releases, { siteUrl, fileExists })) {
                this.emitFile({ type: 'asset', fileName: page.file, source: page.html })
            }
        }
    }
}

// CSP только в продакшен-сборке: dev-сервер Vite вставляет свои скрипты.
function cspPlugin(supabaseUrl: string, proxyUrl: string) {
    return {
        name: 'frnkness-csp',
        apply: 'build' as const,
        transformIndexHtml: {
            order: 'post' as const,
            handler: (html: string) => injectCsp(html, supabaseUrl, proxyUrl)
        }
    }
}

// Уменьшенные webp-копии обложек: images/<имя>-<ширина>.webp для каждой
// картинки images/*.jpg|png. Делаются при КАЖДОЙ сборке (в том числе при
// публикации одного контента из админки), поэтому новому релизу ничего
// вручную готовить не нужно. Те же файлы dev-сервер отдаёт на лету.
// Ширины — в src/utils/cover.ts (используют сайт и эта сборка).
const COVER_SOURCE = /\.(jpe?g|png)$/i

async function resizeCover(file: string, width: number): Promise<Buffer> {
    const sharp = (await import('sharp')).default
    // withoutEnlargement: маленький оригинал не раздуваем — копия получает его размер.
    return sharp(fs.readFileSync(file)).resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
}

function coverVariantsPlugin() {
    const dir = path.resolve(__dirname, 'images')
    const cache = new Map<string, Buffer>()
    return {
        name: 'frnkness-cover-variants',
        async generateBundle(this: any) {
            if (!fs.existsSync(dir)) return
            for (const name of fs.readdirSync(dir)) {
                if (!COVER_SOURCE.test(name)) continue
                const base = name.replace(COVER_SOURCE, '')
                for (const width of COVER_WIDTHS) {
                    const source = await resizeCover(path.join(dir, name), width)
                    this.emitFile({ type: 'asset', fileName: `images/${base}-${width}.webp`, source })
                }
            }
        },
        configureServer(server: any) {
            server.middlewares.use(async (req: any, res: any, next: any) => {
                const m = /\/images\/([^/?]+)-(\d+)\.webp$/.exec((req.url || '').split('?')[0])
                if (!m) return next()
                const width = Number(m[2])
                const original = fs.existsSync(dir) && fs.readdirSync(dir).find((n) => COVER_SOURCE.test(n) && n.replace(COVER_SOURCE, '') === decodeURIComponent(m[1]))
                if (!original || !(COVER_WIDTHS as readonly number[]).includes(width)) return next()
                try {
                    const key = `${original}@${width}`
                    if (!cache.has(key)) cache.set(key, await resizeCover(path.join(dir, original), width))
                    res.setHeader('Content-Type', 'image/webp')
                    res.end(cache.get(key))
                } catch {
                    next()
                }
            })
        }
    }
}

// Модуль админки: src/admin/ и код функций, кроме общих правил аккаунтов.
function isAdminModule(id: string): boolean {
    if (/\/supabase\/functions\/_shared\/accounts\.ts$/.test(id)) return false
    return /\/(src\/admin|supabase\/functions)\//.test(id)
}

function lyricsIndexPlugin() {
    return {
        name: 'frnkness-lyrics-index',
        generateBundle(this: any) {
            this.emitFile({ type: 'asset', fileName: LYRICS_INDEX_FILE, source: buildLyricsIndex() })
            this.emitFile({ type: 'asset', fileName: TRACK_NOTES_FILE, source: buildTrackNotes() })
        },
        configureServer(server: any) {
            server.middlewares.use((req: any, res: any, next: any) => {
                const url = (req.url || '').split('?')[0]
                if (url.endsWith('/' + LYRICS_INDEX_FILE)) {
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.end(buildLyricsIndex())
                    return
                }
                if (url.endsWith('/' + TRACK_NOTES_FILE)) {
                    res.setHeader('Content-Type', 'application/json; charset=utf-8')
                    res.end(buildTrackNotes())
                    return
                }
                return next()
            })
        }
    }
}

// Версия сборки для журнала ошибок и обращений: короткий хеш коммита (в CI
// его даёт GITHUB_SHA), локально — «dev».
const BUILD_ID = (process.env.GITHUB_SHA || '').slice(0, 7) || 'dev'

export default defineConfig(({ mode }) => ({
    define: {
        __BUILD_ID__: JSON.stringify(BUILD_ID)
    },
    plugins: [
        vue(),
        previewsPlugin(normalizeSiteUrl(loadEnv(mode, __dirname, 'VITE_').VITE_SITE_URL)),
        cspPlugin(supabaseUrlFor(mode), proxyUrlFor(mode)),
        lyricsIndexPlugin(),
        coverVariantsPlugin(),
        tailwindcss(),
        VitePWA({
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.js',
            registerType: 'autoUpdate',
            injectRegister: null,
            manifest: false,
            injectManifest: {
                // Админка не кэшируется service worker'ом сайта: её чанки
                // называются admin-* (см. chunkFileNames ниже). Чанк supabase
                // кэшируется: без него сайт не проверит вход и не откроется.
                globIgnores: ['admin.html', '**/admin-*', 'r/**', 't/**', 'og-default.png']
            },
            devOptions: { enabled: false }
        }),
        viteStaticCopy({
            targets: [
                { src: 'images', dest: '' },
                { src: 'audio', dest: '' },
                { src: 'lyrics', dest: '' },
                { src: 'lyrics-books', dest: '' }
            ]
        })
    ],
    base: './',
    build: {
        target: 'es2020',
        cssCodeSplit: true,
        rollupOptions: {
            // Вторая точка входа — админка (admin.html → src/admin/main.ts).
            input: {
                index: path.resolve(__dirname, 'index.html'),
                admin: path.resolve(__dirname, 'admin.html')
            },
            output: {
                // Всё, что содержит код src/admin/ или общие правила функции
                // (supabase/functions/), получает префикс admin-: по нему админку
                // исключает service worker и проверяет scripts/check-dist.mjs.
                // Исключение — правила аккаунтов (_shared/accounts.ts): ими
                // пользуется и сайт (вход по нику, проверка ника и пароля).
                chunkFileNames: (chunk) =>
                    chunk.moduleIds.some((id) => isAdminModule(id.split(path.sep).join('/')))
                        ? 'assets/admin-[name]-[hash].js'
                        : 'assets/[name]-[hash].js',
                manualChunks: {
                    framework: ['vue'],
                    supabase: ['@supabase/supabase-js']
                }
            }
        }
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@types': path.resolve(__dirname, './src/types'),
            '@utils': path.resolve(__dirname, './src/utils')
        }
    },
    test: {
        environment: 'jsdom',
        globals: true,
        // Playwright-тесты живут в e2e/ и запускаются отдельно (npm run test:e2e).
        exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**']
    }
}))
