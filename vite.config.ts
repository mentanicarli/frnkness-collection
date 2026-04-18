import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

function resolveGithubPagesBase(): string {
    const repository = process.env.GITHUB_REPOSITORY || ''
    const repoName = repository.split('/')[1] || ''

    // User/organization site repos (e.g. username.github.io) are served from root.
    if (repoName.toLowerCase().endsWith('.github.io')) {
        return '/'
    }

    // Project site repos are served from /<repo-name>/.
    return repoName ? `/${repoName}/` : '/'
}

export default defineConfig(() => ({
    plugins: [vue()],
    base: process.env.GITHUB_ACTIONS ? resolveGithubPagesBase() : '/',
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
