import { test, expect } from '@playwright/test'
import { installMocks } from './mocks'

// Основной сайт в настоящем Chromium: настоящее воспроизведение mp3 и
// отправка сессии в /rest/v1/rpc/record_listen_session (замокано).
interface Captured {
    body: Record<string, unknown>
    apikey: string | null
}

async function openRelease(page: import('@playwright/test').Page, status = 204) {
    const sessions: Captured[] = []
    await installMocks(page, {
        rpc: (name, body) => {
            if (name !== 'record_listen_session') return undefined
            return { status, body: status === 404 ? { code: 'PGRST202', message: 'Could not find the function' } : null }
        }
    })
    page.on('request', (req) => {
        if (req.url().includes('/rest/v1/rpc/record_listen_session') && req.method() === 'POST') {
            sessions.push({ body: JSON.parse(req.postData() || '{}'), apikey: req.headers()['apikey'] ?? null })
        }
    })
    await page.goto('/#/release/zlaya-nostalgia')
    return sessions
}

/**
 * Время воспроизведения ведёт тест. Настоящий звук под нагрузкой присылает
 * timeupdate рывками, а шаги длиннее 1,5 с трекер (честно) не засчитывает —
 * тогда «прослушано» зависело бы от загрузки машины. Поэтому, когда трек
 * запустился и известна длительность, настоящий звук ставится на паузу, а
 * дальше элемент «играет» с шагом 0,5 с: playFor(n) — ещё n секунд.
 */
async function takeOverPlayback(page: import('@playwright/test').Page) {
    const audio = page.locator('#audio-player')
    await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => (a.paused ? 0 : a.readyState)), { timeout: 15_000 }).toBeGreaterThan(0)
    await audio.evaluate(async (a: HTMLAudioElement) => {
        await new Promise((resolve) => {
            a.addEventListener('pause', resolve, { once: true })
            HTMLMediaElement.prototype.pause.call(a)
        })
        let t = a.currentTime
        Object.defineProperty(a, 'paused', { configurable: true, get: () => false })
        Object.defineProperty(a, 'currentTime', { configurable: true, get: () => t, set: (v: number) => { t = v } })
        ;(window as unknown as { __playFor: (s: number) => void }).__playFor = (seconds: number) => {
            for (let i = 0; i < seconds * 2; i++) {
                t += 0.5
                a.dispatchEvent(new Event('timeupdate'))
            }
        }
    })
}

const playFor = (page: import('@playwright/test').Page, seconds: number) =>
    page.evaluate((s) => (window as unknown as { __playFor: (s: number) => void }).__playFor(s), seconds)

test('смена трека отправляет сессию: ключ, прослушанные секунды, длительность, apikey', async ({ page }) => {
    const sessions = await openRelease(page)
    const rows = page.locator('#tracklist .track-row')
    await rows.nth(0).click()
    await takeOverPlayback(page)
    await playFor(page, 5)
    await rows.nth(1).click()
    await expect.poll(() => sessions.length, { timeout: 10_000 }).toBe(1)
    const s = sessions[0]
    expect(s.apikey).toBe('test-anon-key')
    expect(s.body.track_key_input).toBe('zlaya-nostalgia-0')
    expect(s.body.session_id_input).toMatch(/^[0-9a-f-]{36}$/)
    // 5 с шагами по 0,5 с; первый шаг мог уйти на старт сессии.
    expect(Number(s.body.listened_input)).toBeGreaterThanOrEqual(4.5)
    expect(Number(s.body.max_position_input)).toBeGreaterThanOrEqual(Number(s.body.listened_input) - 0.5)
    expect(Number(s.body.duration_input)).toBeGreaterThan(30)
    expect(s.body.completed_input).toBe(false)
})

test('короткая сессия (< 3 с) не отправляется', async ({ page }) => {
    const sessions = await openRelease(page)
    const rows = page.locator('#tracklist .track-row')
    await rows.nth(0).click()
    await takeOverPlayback(page)
    await playFor(page, 2)
    await rows.nth(1).click()
    // Второй трек играет по-настоящему: дождёмся его начала — к этому
    // моменту сессия первого уже была бы отправлена (loadstart).
    await expect(page.locator('#player-track')).toHaveText('Общество Могнутых Аналитиков')
    await expect.poll(() => page.locator('#audio-player').evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 15_000 }).toBeGreaterThan(0)
    expect(sessions).toEqual([])
})

// Сама доставка keepalive-запроса при уходе/закрытии проверена отдельно на
// настоящем сервере (Chromium и WebKit). Перехват Playwright на выгружаемой
// странице запросы не видит, поэтому здесь — что сайт отправляет по pagehide
// и при скрытии вкладки, причём одну и ту же сессию.
test('pagehide и скрытие вкладки — снимок той же сессии', async ({ page }) => {
    const sessions = await openRelease(page)
    await page.locator('#tracklist .track-row').nth(0).click()
    await takeOverPlayback(page)
    await playFor(page, 4)
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect.poll(() => sessions.length, { timeout: 10_000 }).toBe(1)
    await playFor(page, 2)
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })))
    await expect.poll(() => sessions.length, { timeout: 10_000 }).toBe(2)
    expect(sessions[0].body.session_id_input).toBe(sessions[1].body.session_id_input)
    expect(Number(sessions[1].body.listened_input)).toBeGreaterThan(Number(sessions[0].body.listened_input))
    expect(sessions[1].body.track_key_input).toBe('zlaya-nostalgia-0')
})

test('миграция не применена (404) — сайт работает дальше без ошибок', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    const sessions = await openRelease(page, 404)
    const rows = page.locator('#tracklist .track-row')
    await rows.nth(0).click()
    await takeOverPlayback(page)
    await playFor(page, 4)
    await rows.nth(1).click()
    await expect.poll(() => sessions.length, { timeout: 10_000 }).toBe(1)
    await expect(page.locator('#player-track')).toHaveText('Общество Могнутых Аналитиков')
    expect(errors).toEqual([])
})
