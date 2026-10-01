import { defineConfig, devices } from '@playwright/test'

// E2E-тесты админки. Supabase и функция admin-content замоканы в e2e/mocks.ts:
// dev-сервер запускается с несуществующим адресом Supabase, а любой запрос
// к настоящему *.supabase.co тест обрывает и считает ошибкой.
const PORT = 4317

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: true,
    reporter: 'list',
    timeout: 30_000,
    use: {
        baseURL: `http://localhost:${PORT}`,
        viewport: { width: 1280, height: 592 },
        serviceWorkers: 'block'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 592 } } }],
    webServer: {
        command: `npx vite --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}/admin.html`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
            VITE_SUPABASE_URL: 'https://mock.supabase.test',
            VITE_SUPABASE_ANON_KEY: 'test-anon-key'
        }
    }
})
