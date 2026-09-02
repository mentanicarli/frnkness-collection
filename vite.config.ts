/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'
import fs from 'fs'

// Склеивает все .lrc в один JSON, чтобы поиску по строкам текстов не
// приходилось делать отдельный запрос на каждый трек. Файл отдаётся и в
// dev через middleware, поэтому обе среды идут по одному и тому же пути.
const LYRICS_INDEX_FILE = 'lyrics-index.json'

function buildLyricsIndex() {
    const root = path.resolve(__dirname, 'lyrics')
    const index: Record<string, string> = {}
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (entry.name.toLowerCase().endsWith('.lrc')) {
                const rel = path.relative(__dirname, full).split(path.sep).join('/')
                index[rel] = fs.readFileSync(full, 'utf-8')
            }
        }
    }
    if (fs.existsSync(root)) walk(root)
    return JSON.stringify(index)
}

function lyricsIndexPlugin() {
    return {
        name: 'frnkness-lyrics-index',
        generateBundle(this: any) {
            this.emitFile({ type: 'asset', fileName: LYRICS_INDEX_FILE, source: buildLyricsIndex() })
        },
        configureServer(server: any) {
            server.middlewares.use((req: any, res: any, next: any) => {
                const url = (req.url || '').split('?')[0]
                if (!url.endsWith('/' + LYRICS_INDEX_FILE)) return next()
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                res.end(buildLyricsIndex())
            })
        }
    }
}

export default defineConfig(() => ({
    plugins: [
        vue(),
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
                globIgnores: ['**/supabase-*.js']
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
            output: {
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
            '@components': path.resolve(__dirname, './src/components'),
            '@types': path.resolve(__dirname, './src/types'),
            '@utils': path.resolve(__dirname, './src/utils')
        }
    },
    test: {
        environment: 'jsdom',
        globals: true
    }
}))
