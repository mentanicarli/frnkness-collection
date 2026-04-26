import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig(() => ({
    plugins: [vue()],
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
    }
}))
