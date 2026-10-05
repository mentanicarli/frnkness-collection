import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, HEAD_SHA, installMocks, loginAs, repoFile, type ContentCall } from './mocks'

/**
 * Работа вдвоём: черновики в браузере, база коммита — версия, на которой
 * загружен файл, вставка готового .lrc, автор правки.
 */
const SHA_1 = 'd'.repeat(40)
const SHA_2 = 'e'.repeat(40)

async function openLrc(page: Page, hash: string) {
    const shas = [SHA_1, SHA_2]
    const mocks = await installMocks(page, {
        content: (call: ContentCall) => {
            if (call.action === 'commit') {
                const sha = shas.shift() ?? 'f'.repeat(40)
                return { body: { sha, url: 'u', message: `admin: ${call.body.message}` } }
            }
            return undefined
        }
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    await page.goto('/admin.html' + hash)
    await expect(page.getByTestId('lrc-lines')).toBeVisible()
    return mocks
}

const commits = (mocks: { calls: ContentCall[] }) => mocks.calls.filter((c) => c.action === 'commit')

async function publish(page: Page) {
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-author')).toContainText(ADMIN_USER.email)
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)
}

test('караоке: черновик переживает перезагрузку, удаляется после сохранения', async ({ page }) => {
    await openLrc(page, '#/lrc/faaa/0')
    const first = page.getByTestId('lrc-lines').locator('.adm-lrc-stamp').first()
    const before = await first.textContent()
    await page.getByRole('button', { name: 'Строка 1: позже на 0.1 с' }).click()
    const after = await first.textContent()
    expect(after).not.toBe(before)
    // Черновик пишется с небольшой задержкой.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('adm-draft:lrc:lyrics/singles/faaa.lrc'))).not.toBeNull()

    await page.reload()
    await expect(page.getByTestId('lrc-lines')).toBeVisible()
    await expect(page.getByTestId('draft-offer')).toBeVisible()
    await expect(first).toHaveText(before!)
    await page.getByRole('button', { name: 'Восстановить черновик' }).click()
    await expect(first).toHaveText(after!)
    await expect(page.getByTestId('draft-offer')).toHaveCount(0)

    await publish(page)
    await page.reload()
    await expect(page.getByTestId('lrc-lines')).toBeVisible()
    await expect(page.getByTestId('draft-offer')).toHaveCount(0)
})

test('караоке: «Удалить черновик» — больше не предлагается', async ({ page }) => {
    await openLrc(page, '#/lrc/faaa/0')
    await page.getByRole('button', { name: 'Строка 1: позже на 0.1 с' }).click()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('adm-draft:lrc:lyrics/singles/faaa.lrc'))).not.toBeNull()
    await page.reload()
    await page.getByRole('button', { name: 'Удалить черновик' }).click()
    await page.reload()
    await expect(page.getByTestId('lrc-lines')).toBeVisible()
    await expect(page.getByTestId('draft-offer')).toHaveCount(0)
})

test('база коммита — версия, на которой загружен файл; после сохранения — свой коммит', async ({ page }) => {
    const mocks = await openLrc(page, '#/lrc/faaa/0')
    await page.getByRole('button', { name: 'Строка 1: позже на 0.1 с' }).click()
    await publish(page)
    await page.getByRole('button', { name: 'Строка 1: позже на 0.1 с' }).click()
    await publish(page)
    expect(commits(mocks).map((c) => c.body.baseSha)).toEqual([HEAD_SHA, SHA_1])
})

test('вставка готового .lrc: разбор, сводка, сохранение в формате сайта', async ({ page }) => {
    // ZAL — трек без .lrc в фикстуре.
    const mocks = await openLrc(page, '#/lrc/born-to-be-deluxe/0')
    const text = repoFile('lyrics/album3/01-zal.txt')!
        .replace(/\r/g, '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^\[.+\]$/.test(l))
    const lrc = ['[ar:frnk ness]', ...text.map((l, i) => `[00:${String(10 + i).padStart(2, '0')}.${i % 2 ? '5' : '125'}]${l}`), 'без метки'].join('\n')

    await page.getByRole('tab', { name: 'Вставить .lrc' }).click()
    await page.getByRole('textbox', { name: 'Текст .lrc' }).fill(lrc)
    await expect(page.getByTestId('paste-summary')).toHaveText(`Строк с метками: ${text.length}, пропущено без метки или текста: 1`)
    await page.getByRole('button', { name: 'Применить' }).click()
    await expect(page.getByTestId('progress')).toHaveText(`Отмечено ${text.length} из ${text.length}`)
    await publish(page)
    const saved = (commits(mocks)[0].body.files as { path: string; content: string }[])[0]
    expect(saved.path).toBe('lyrics/album3/01-zal.lrc')
    const first = saved.content.split('\n')[0]
    expect(first).toBe(`[00:10.13]${text[0]}`)
    expect(saved.content.split('\n')[1]).toBe(`[00:11.50]${text[1]}`)
})

test('история: кто сделал правку', async ({ page }) => {
    await installMocks(page, {
        content: (call: ContentCall) =>
            call.action === 'history'
                ? {
                      body: {
                          head: HEAD_SHA,
                          commits: [
                              { sha: '1'.repeat(40), message: 'admin: караоке «FAAA» (FAAA)', date: '2026-10-05T09:30:00Z', author: 'bot', user: 'anna@example.com', source: 'admin', files: [] },
                              { sha: '2'.repeat(40), message: 'feat: код', date: '2026-10-05T08:00:00Z', author: 'Max', user: null, source: 'code', files: [] }
                          ]
                      }
                  }
                : undefined
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    await page.goto('/admin.html#/history')
    const items = page.getByTestId('history').locator('li')
    await expect(items.nth(0).getByTestId('history-user')).toHaveText('anna@example.com ·')
    await expect(items.nth(1).getByTestId('history-user')).toHaveCount(0)
})
