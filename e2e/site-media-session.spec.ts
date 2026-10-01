import { test, expect } from '@playwright/test'
import { installMocks } from './mocks'

// Основной сайт: Media Session в настоящем Chromium. Обработчики кнопок
// экрана блокировки перехватываем, чтобы «нажать» их из теста.
test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const w = window as unknown as { __ms: Record<string, (d: unknown) => void> }
        w.__ms = {}
        const original = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession)
        navigator.mediaSession.setActionHandler = (action, handler) => {
            if (handler) w.__ms[action] = handler as (d: unknown) => void
            original(action, handler)
        }
    })
    await installMocks(page)
})

const press = (page: import('@playwright/test').Page, action: string, details: object = {}) =>
    page.evaluate(([a, d]) => (window as unknown as { __ms: Record<string, (d: unknown) => void> }).__ms[a as string](d), [action, details] as const)

const meta = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
        const m = navigator.mediaSession.metadata
        return m ? { title: m.title, artist: m.artist, album: m.album, art: m.artwork.map((a) => a.src), sizes: m.artwork.map((a) => a.sizes) } : null
    })

test('карточка на экране блокировки и кнопки управления', async ({ page }) => {
    await page.goto('/#/release/zlaya-nostalgia')
    await page.locator('#tracklist .track-row').first().click()

    await expect.poll(() => meta(page).then((m) => m?.title)).toBe('Маканочки')
    const m = (await meta(page))!
    expect(m.artist).toBe('frnk ness')
    expect(m.album).toBe('Злая Ностальгия')
    expect(new Set(m.art)).toEqual(new Set(['http://localhost:4317/images/album4-cover.jpg']))
    expect(m.sizes).toContain('512x512')
    expect(Object.keys(await page.evaluate(() => (window as unknown as { __ms: object }).__ms)).sort()).toEqual(
        ['nexttrack', 'pause', 'play', 'previoustrack', 'seekbackward', 'seekforward', 'seekto'].sort()
    )
    await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe('playing')

    // Следующий трек — и карточка, и мини-плеер.
    await press(page, 'nexttrack')
    await expect.poll(() => meta(page).then((x) => x?.title)).toBe('Общество Могнутых Аналитиков')
    await expect(page.locator('#player-track')).toHaveText('Общество Могнутых Аналитиков')
    await press(page, 'previoustrack')
    await expect.poll(() => meta(page).then((x) => x?.title)).toBe('Маканочки')

    // Пауза и продолжение — как кнопкой плеера.
    await press(page, 'pause')
    await expect.poll(() => page.evaluate(() => navigator.mediaSession.playbackState)).toBe('paused')
    expect(await page.locator('#audio-player').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
    await press(page, 'play')
    await expect.poll(() => page.locator('#audio-player').evaluate((a: HTMLAudioElement) => a.paused)).toBe(false)

    // Перемотка ±10 с и seekto; на паузе перемотка не запускает воспроизведение.
    await press(page, 'pause')
    await press(page, 'seekto', { seekTime: 30 })
    await press(page, 'seekforward', {})
    await expect.poll(() => page.locator('#audio-player').evaluate((a: HTMLAudioElement) => Math.round(a.currentTime))).toBe(40)
    await press(page, 'seekbackward', {})
    await expect.poll(() => page.locator('#audio-player').evaluate((a: HTMLAudioElement) => Math.round(a.currentTime))).toBe(30)
    expect(await page.locator('#audio-player').evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
})

test('в Потоке «следующий» с экрана блокировки — случайный трек, не по порядку', async ({ page }) => {
    await page.addInitScript(() => {
        let n = 0
        // Детерминированный «случайный» выбор: каждый раз другой трек.
        Math.random = () => ((n++ * 0.37) % 1)
    })
    await page.goto('/#/')
    await page.locator('#flow-mode-btn').click()
    await expect.poll(() => meta(page).then((m) => m?.title)).toBeTruthy()
    const first = (await meta(page))!
    await press(page, 'nexttrack')
    await expect.poll(() => meta(page).then((m) => `${m?.album}/${m?.title}`)).not.toBe(`${first.album}/${first.title}`)
    await expect(page.locator('#flow-mode-btn')).toHaveClass(/active/)
})
