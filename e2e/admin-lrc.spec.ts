import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, installMocks, loginAs, repoFile } from './mocks'

const NEW_SHA = 'c'.repeat(40)

async function openLrc(page: Page, hash: string) {
    const mocks = await installMocks(page, {
        content: (call) => {
            if (call.action === 'commit') return { body: { sha: NEW_SHA, url: 'u', message: call.body.message } }
            return undefined
        }
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    await page.goto('/admin.html' + hash)
    await expect(page.getByTestId('lrc-lines')).toBeVisible()
    // Ждём метаданные аудио: перемотка работает только после них.
    await expect.poll(() => page.getByTestId('audio').evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 15_000 }).toBeGreaterThan(0)
    return mocks
}

const setTime = (page: Page, t: number) =>
    page.getByTestId('audio').evaluate((a: HTMLAudioElement, time) => {
        a.currentTime = time
        a.dispatchEvent(new Event('timeupdate'))
    }, t)
const audioTime = (page: Page) => page.getByTestId('audio').evaluate((a: HTMLAudioElement) => a.currentTime)

// Строки ZAL без меток секций и знаков в конце — как сформирует админка.
function zalLines() {
    return repoFile('lyrics/album3/01-zal.txt')!
        .replace(/\r/g, '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^\[.+\]$/.test(l))
}

test('новый .lrc: строки из текста, Пробел/Backspace, сохранение в формате сайта', async ({ page }) => {
    const mocks = await openLrc(page, '#/lrc/born-to-be-deluxe/0')
    await expect(page.getByTestId('source-note')).toContainText('Строки взяты из lyrics/album3/01-zal.txt')
    const items = page.getByTestId('lrc-lines').locator('li')
    const count = zalLines().length
    await expect(items).toHaveCount(count)
    // Знаки препинания в конце строки убраны.
    for (const text of await items.locator('.adm-lrc-text').allTextContents()) expect(text).not.toMatch(/[,.;:—]$/)

    await setTime(page, 1.5)
    await page.keyboard.press('Space')
    await setTime(page, 3.25)
    await page.keyboard.press('Enter')
    await expect(items.nth(0).locator('.adm-lrc-stamp')).toHaveText('00:01.50')
    await expect(items.nth(1).locator('.adm-lrc-stamp')).toHaveText('00:03.25')
    await page.keyboard.press('Backspace')
    await expect(items.nth(1).locator('.adm-lrc-stamp')).toHaveText('—')
    await expect(page.getByTestId('save-block')).toContainText(`Отмечено 1 из ${count}`)
    await expect(page.getByRole('button', { name: 'Сохранить…' })).toBeDisabled()

    for (let i = 1; i < count; i++) {
        await setTime(page, 2 + i * 1.5)
        await page.keyboard.press('Space')
    }
    await expect(page.getByTestId('progress')).toHaveText(`Отмечено ${count} из ${count}`)
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-files')).toHaveText(/новый\s*lyrics\/album3\/01-zal\.lrc/)
    await expect(dialog.getByTestId('commit-message')).toHaveText('admin: караоке «ZAL» (Born to be Deluxe)')
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)

    const file = (mocks.calls.find((c) => c.action === 'commit')!.body.files as { path: string; content: string }[])[0]
    expect(file.path).toBe('lyrics/album3/01-zal.lrc')
    const out = file.content.trimEnd().split('\n')
    expect(out).toHaveLength(count)
    expect(out[0]).toBe(`[00:01.50]${(await items.nth(0).locator('.adm-lrc-text').textContent())!}`)
    expect(out.every((l) => /^\[\d{2}:\d{2}\.\d{2}\][^\s]/.test(l))).toBe(true)
    // Тот же разбор, что на сайте (parseLRC): время по возрастанию.
    const times = out.map((l) => {
        const m = l.match(/^\[(\d{2}):(\d{2})\.(\d{2})\]/)!
        return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100
    })
    expect([...times].sort((a, b) => a - b)).toEqual(times)
})

test('готовый .lrc: загрузка для правки, подстройка ±0.1, клик — перемотка', async ({ page }) => {
    const mocks = await openLrc(page, '#/lrc/faaa/0')
    await expect(page.getByTestId('source-note')).toContainText('Готовый lyrics/singles/faaa.lrc загружен для правки')
    const original = repoFile('lyrics/singles/faaa.lrc')!.replace(/\r/g, '').trimEnd().split('\n')
    const first = original[0].match(/^\[(\d{2}):(\d{2})\.(\d{2})\](.*)$/)!
    const firstTime = Number(first[1]) * 60 + Number(first[2]) + Number(first[3]) / 100
    const items = page.getByTestId('lrc-lines').locator('li')
    await expect(items).toHaveCount(original.length)
    await expect(page.getByText('Изменений нет')).toBeVisible()

    await items.nth(0).getByRole('button', { name: 'Строка 1: позже на 0.1 с' }).click()
    await items.nth(0).getByRole('button', { name: 'Строка 1: позже на 0.1 с' }).click()
    const shifted = Math.round((firstTime + 0.2) * 100) / 100
    await items.nth(0).locator('.adm-lrc-line').click()
    await expect.poll(() => audioTime(page)).toBeCloseTo(shifted, 1)
    await expect(page.getByText('Есть несохранённые изменения')).toBeVisible()

    await page.getByRole('button', { name: 'Сохранить…' }).click()
    await expect(page.getByRole('dialog').getByTestId('commit-files')).toHaveText(/изменён\s*lyrics\/singles\/faaa\.lrc/)
    await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const saved = (mocks.calls.find((c) => c.action === 'commit')!.body.files as { content: string }[])[0].content.trimEnd().split('\n')
    expect(saved.slice(1)).toEqual(original.slice(1))
    expect(saved[0]).not.toBe(original[0])
    expect(saved[0].endsWith(`]${first[4]}`)).toBe(true)
})

test('сдвиг всех строк: ±0.1, накопленный сдвиг, сброс, упор в 0', async ({ page }) => {
    await openLrc(page, '#/lrc/faaa/0')
    const stamps = () => page.getByTestId('lrc-lines').locator('.adm-lrc-stamp').allTextContents()
    const before = await stamps()
    const total = page.getByTestId('shift-total')
    await expect(total).toHaveText('Сдвиг: 0.0 с')

    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Все +0.1' }).click()
    await expect(total).toHaveText('Сдвиг: +0.3 с')
    await expect(page.getByTestId('lrc-lines').locator('.adm-lrc-stamp.flash-later').first()).toBeVisible()
    const toCs = (s: string) => {
        const m = s.match(/^(\d{2}):(\d{2})\.(\d{2})$/)!
        return (Number(m[1]) * 60 + Number(m[2])) * 100 + Number(m[3])
    }
    const after = await stamps()
    expect(after.map(toCs)).toEqual(before.map((s) => toCs(s) + 30))
    await expect(page.getByText('Есть несохранённые изменения')).toBeVisible()

    await page.getByRole('button', { name: 'Сбросить сдвиг' }).click()
    await expect(total).toHaveText('Сдвиг: 0.0 с')
    expect(await stamps()).toEqual(before)
    await expect(page.getByText('Изменений нет')).toBeVisible()

    // Тянем назад, пока самая ранняя строка не встанет на 00:00.00.
    const back = page.getByRole('button', { name: 'Все −0.1' })
    const firstCs = Math.min(...before.map(toCs))
    for (let i = 0; i < Math.ceil(firstCs / 10); i++) await back.click()
    await expect(back).toBeDisabled()
    await expect(page.getByTestId('shift-hint')).toContainText('00:00.00')
    const atZero = (await stamps()).map(toCs)
    expect(Math.min(...atZero)).toBe(0)
    expect(atZero).toEqual(before.map((s) => toCs(s) - firstCs))
})

test('перемотка ←/→, скорость 0.75×, правка строк сохраняет отметки', async ({ page }) => {
    await openLrc(page, '#/lrc/faaa/0')
    await setTime(page, 10)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => audioTime(page)).toBeCloseTo(13, 0)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => audioTime(page)).toBeCloseTo(7, 0)

    await page.getByRole('button', { name: '0.75×' }).click()
    expect(await page.getByTestId('audio').evaluate((a: HTMLAudioElement) => a.playbackRate)).toBe(0.75)

    const items = page.getByTestId('lrc-lines').locator('li')
    const firstStamp = await items.nth(0).locator('.adm-lrc-stamp').textContent()
    await page.getByRole('tab', { name: 'Строки' }).click()
    const area = page.getByRole('textbox', { name: 'Строки караоке' })
    const value = await area.inputValue()
    await area.fill(value.replace(/^[^\n]+/, 'Исправленная первая строка'))
    await page.getByRole('button', { name: 'Применить' }).click()
    await expect(items.nth(0).locator('.adm-lrc-text')).toHaveText('Исправленная первая строка')
    await expect(items.nth(0).locator('.adm-lrc-stamp')).toHaveText(firstStamp!)
})

test('предпросмотр: подсветка активной строки как в караоке на сайте', async ({ page }) => {
    await openLrc(page, '#/lrc/faaa/0')
    const lrc = repoFile('lyrics/singles/faaa.lrc')!.replace(/\r/g, '').trimEnd().split('\n')
    const third = lrc[2].match(/^\[(\d{2}):(\d{2})\.(\d{2})\](.*)$/)!
    await page.getByRole('tab', { name: 'Предпросмотр' }).click()
    await setTime(page, Number(third[1]) * 60 + Number(third[2]) + Number(third[3]) / 100 + 0.05)
    const karaoke = page.getByTestId('karaoke')
    await expect(karaoke.locator('.fs-lrc-line.active')).toHaveText(third[4] || '...')
    await expect(karaoke.locator('.fs-lrc-line.d1')).toHaveCount(2)
})

test('телефон: синхронизатор без горизонтальной прокрутки', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await openLrc(page, '#/lrc/faaa/0')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
})
