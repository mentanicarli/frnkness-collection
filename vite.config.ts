/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'
import fs from 'fs'
import { injectCsp } from './scripts/csp'

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

// CSP только в продакшен-сборке: dev-сервер Vite вставляет свои скрипты.
function cspPlugin(supabaseUrl: string) {
    return {
        name: 'frnkness-csp',
        apply: 'build' as const,
        transformIndexHtml: {
            order: 'post' as const,
            handler: (html: string) => injectCsp(html, supabaseUrl)
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

export default defineConfig(({ mode }) => ({
    plugins: [
        vue(),
        cspPlugin(supabaseUrlFor(mode)),
        lyricsIndexPlugin(),
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
                globIgnores: ['admin.html', '**/admin-*']
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
