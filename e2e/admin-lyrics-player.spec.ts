import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, installMocks, loginAs, repoFile } from './mocks'

// Аудио отдаёт мок из фикстуры (tests/fixtures/catalog/audio) с поддержкой Range.

async function openLyrics(page: Page, hash: string) {
    await installMocks(page)
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    await page.goto('/admin.html' + hash)
    await expect(page.getByRole('textbox', { name: 'Текст песни' })).toBeVisible()
    // Перемотка работает только после метаданных аудио.
    await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 15_000 }).toBeGreaterThan(0)
}

const audio = (page: Page) => page.getByTestId('audio')
const audioTime = (page: Page) => audio(page).evaluate((a: HTMLAudioElement) => a.currentTime)
const isPaused = (page: Page) => audio(page).evaluate((a: HTMLAudioElement) => a.paused)
const setTime = (page: Page, t: number) =>
    audio(page).evaluate((a: HTMLAudioElement, time) => {
        a.currentTime = time
        a.dispatchEvent(new Event('timeupdate'))
    }, t)

// Время строки из фикстурного .lrc — тест не знает конкретных цифр заранее.
function lrcLine(rel: string, n: number) {
    const m = repoFile(rel)!.replace(/\r/g, '').trim().split('\n')[n].match(/^\[(\d{2}):(\d{2})\.(\d{2})\](.*)$/)!
    return { time: Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100, text: m[4] }
}

test('плеер: кнопки, горячие клавиши во время набора, подсказка', async ({ page }) => {
    await openLyrics(page, '#/lyrics/most-venture-poopsicks/0')
    const player = page.getByTestId('player')
    await expect(player.getByRole('button', { name: 'Играть' })).toBeVisible()
    await expect(page.getByTestId('player-keys')).toContainText('Alt+2')
    await expect(page.getByTestId('player-keys')).toContainText('Alt+1')
    await expect(page.getByTestId('player-keys')).toContainText('Alt+3')

    // Пробел в поле ввода печатает пробел, а не запускает плеер.
    const input = page.getByRole('textbox', { name: 'Текст песни' })
    await input.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type(' x y')
    await expect(input).toHaveValue(/ x y$/)
    expect(await isPaused(page)).toBe(true)

    // Alt+3 / Alt+1 — перемотка, Alt+2 — играть/пауза; фокус остаётся в поле.
    await setTime(page, 5)
    await page.keyboard.press('Alt+3')
    await expect.poll(() => audioTime(page)).toBeCloseTo(8, 0)
    await page.keyboard.press('Alt+1')
    await page.keyboard.press('Alt+1')
    await expect.poll(() => audioTime(page)).toBeCloseTo(2, 0)
    await page.keyboard.press('Alt+2')
    await expect.poll(() => isPaused(page)).toBe(false)
    await expect(player.getByRole('button', { name: 'Пауза' })).toBeVisible()
    await page.keyboard.press('Alt+2')
    await expect.poll(() => isPaused(page)).toBe(true)
    await expect(input).toBeFocused()
    await expect(input).toHaveValue(/ x y$/)

    // Скорость.
    await player.getByRole('button', { name: '0.75×' }).click()
    expect(await audio(page).evaluate((a: HTMLAudioElement) => a.playbackRate)).toBe(0.75)
})

test('откат на 2 с после паузы — и его можно выключить', async ({ page }) => {
    await openLyrics(page, '#/lyrics/most-venture-poopsicks/0')
    const player = page.getByTestId('player')
    const toggle = player.getByRole('checkbox', { name: /Откат на 2 с/ })
    await expect(toggle).toBeChecked()

    await setTime(page, 10)
    await player.getByRole('button', { name: 'Играть' }).click()
    await player.getByRole('button', { name: 'Пауза' }).click()
    const pausedAt = await audioTime(page)
    await player.getByRole('button', { name: 'Играть' }).click()
    const resumed = await audioTime(page)
    expect(resumed).toBeLessThan(pausedAt - 1.5)
    await player.getByRole('button', { name: 'Пауза' }).click()

    // Перемотали на паузе — откат не нужен.
    await setTime(page, 12)
    await player.getByRole('button', { name: 'Играть' }).click()
    expect(await audioTime(page)).toBeGreaterThanOrEqual(11.95)
    await player.getByRole('button', { name: 'Пауза' }).click()

    await toggle.uncheck()
    const t0 = await audioTime(page)
    await player.getByRole('button', { name: 'Играть' }).click()
    expect(await audioTime(page)).toBeGreaterThanOrEqual(t0 - 0.05)
    await player.getByRole('button', { name: 'Пауза' }).click()
})

test('с .lrc: подсветка звучащей строки, клик в предпросмотре — перемотка', async ({ page }) => {
    await openLyrics(page, '#/lyrics/most-venture-poopsicks/0')
    const rel = 'lyrics/album1/01-poopsicks.lrc'
    const second = lrcLine(rel, 1)
    const fourth = lrcLine(rel, 3)

    await setTime(page, second.time + 0.1)
    const playing = page.getByTestId('lines').locator('.adm-line.is-playing')
    await expect(playing).toHaveCount(1)
    await expect(playing).toContainText(second.text)
    await expect(page.getByTestId('now-line')).toContainText(second.text)

    await page.getByRole('tab', { name: 'Предпросмотр' }).click()
    const preview = page.getByTestId('preview')
    await expect(preview.locator('.lyric-line.is-playing')).toHaveText(second.text)
    await preview.locator('.lyric-line', { hasText: fourth.text }).first().click()
    await expect.poll(() => audioTime(page)).toBeCloseTo(fourth.time, 1)
    await expect(preview.locator('.lyric-line.is-playing')).toHaveText(fourth.text)

    // «Следить за строкой» запоминается.
    const follow = page.getByTestId('player').getByRole('checkbox', { name: 'Следить за строкой' })
    await expect(follow).toBeChecked()
    await follow.uncheck()
    await page.reload()
    await expect(page.getByTestId('player').getByRole('checkbox', { name: 'Следить за строкой' })).not.toBeChecked()
})

test('без .lrc — только плеер, без подсветки', async ({ page }) => {
    await openLyrics(page, '#/lyrics/born-to-be-deluxe/0')
    await expect(page.getByTestId('no-lrc')).toBeVisible()
    await expect(page.getByTestId('now-line')).toHaveCount(0)
    await setTime(page, 5)
    await expect(page.getByTestId('lines').locator('.adm-line.is-playing')).toHaveCount(0)
})

test('смена трека останавливает плеер и переключает аудио', async ({ page }) => {
    await openLyrics(page, '#/lyrics/most-venture-poopsicks/0')
    const src0 = await audio(page).getAttribute('src')
    await page.getByTestId('player').getByRole('button', { name: 'Играть' }).click()
    await expect.poll(() => isPaused(page)).toBe(false)
    await page.getByRole('combobox', { name: 'Трек' }).selectOption('1')
    await expect(page).toHaveURL(/#\/lyrics\/most-venture-poopsicks\/1$/)
    await expect.poll(() => audio(page).getAttribute('src')).not.toBe(src0)
    expect(await isPaused(page)).toBe(true)
    await expect(page.getByTestId('player').getByRole('button', { name: 'Играть' })).toBeVisible()
    await expect(page.getByTestId('time')).toContainText('00:00.00 /')
})

test('плеер закреплён и виден при прокрутке — в том числе на телефоне', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await openLyrics(page, '#/lyrics/most-venture-poopsicks/0')
    for (const size of [{ width: 1280, height: 720 }, { width: 390, height: 740 }]) {
        await page.setViewportSize(size)
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200)
        const box = (await page.getByTestId('player').boundingBox())!
        const header = (await page.locator('.adm-top').boundingBox())!
        expect(box.y).toBeGreaterThanOrEqual(header.y + header.height - 1)
        expect(box.y).toBeLessThan(header.y + header.height + 4)
        await expect(page.getByTestId('player').getByRole('button', { name: 'Играть' })).toBeInViewport()
        // Без горизонтальной прокрутки.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
})
