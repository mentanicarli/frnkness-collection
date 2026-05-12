/// <reference types="vitest" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'

export default defineConfig(() => ({
    plugins: [
        vue(),
        tailwindcss(),
        VitePWA({
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.js',
            registerType: 'autoUpdate',
            injectRegister: null,
            manifest: false,
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
                    framework: ['vue', 'pinia']
                }
            }
        }
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@components': path.resolve(__dirname, './src/components'),
            '@stores': path.resolve(__dirname, './src/stores'),
            '@types': path.resolve(__dirname, './src/types'),
            '@utils': path.resolve(__dirname, './src/utils')
        }
    },
    test: {
        environment: 'jsdom',
        globals: true
    }
}))
