import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { ADMIN_USER, installMocks, loginAs, repoFile, type ContentCall } from './mocks'

const ROOT = path.resolve(__dirname, '..')
const SQUARE = { name: 'new.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(ROOT, 'images/album3-cover.jpg')) }
const TALL = { name: 'tall.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(ROOT, 'images/album2-cover.jpg')) }

async function openRelease(page: Page, id: string) {
    await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'))
    const mocks = await installMocks(page, {
        content: (call: ContentCall) => {
            if (call.action === 'stage-blob') return { body: { sha: 'e'.repeat(40), path: call.body.path, size: 10, token: 't'.repeat(64) } }
            if (call.action === 'commit') return { body: { sha: '9'.repeat(40), url: 'u', message: call.body.message } }
            return undefined
        }
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    await page.goto(`/admin.html#/releases/${id}`)
    await expect(page.getByRole('textbox', { name: 'Название' })).toBeVisible()
    return mocks
}

const committed = (mocks: Awaited<ReturnType<typeof installMocks>>) =>
    mocks.calls.find((c) => c.action === 'commit')!.body.files as { path: string; content?: string; delete?: boolean; blob?: object }[]

test('название и дата: меняется только запись релиза, id и треки — только для чтения', async ({ page }) => {
    const mocks = await openRelease(page, 'zlaya-nostalgia')
    const ro = page.getByTestId('readonly')
    await expect(ro).toContainText('zlaya-nostalgia')
    await expect(ro).toContainText('audio/album4/, lyrics/album4/')
    await expect(ro.locator('li')).toHaveCount(7)
    await expect(ro.locator('input, select, textarea')).toHaveCount(0)

    await page.getByRole('textbox', { name: 'Название' }).fill('Злая Ностальгия (Deluxe)')
    await page.getByRole('textbox', { name: 'Дата релиза' }).fill('2026-09-01')
    await expect(page.getByText('В реестре: «1 сентября 2026», год 2026')).toBeVisible()
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-message')).toHaveText('admin: релиз «Злая Ностальгия (Deluxe)»: название, дата')
    await expect(dialog.getByTestId('commit-files').locator('li')).toHaveCount(1)
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)

    const files = committed(mocks)
    expect(files.map((f) => f.path)).toEqual(['src/content/releases.json'])
    const before = JSON.parse(repoFile('src/content/releases.json')!)
    const after = JSON.parse(files[0].content!)
    expect(Object.keys(after)).toEqual(Object.keys(before))
    for (const id of Object.keys(before)) if (id !== 'zlaya-nostalgia') expect(after[id]).toEqual(before[id])
    expect(after['zlaya-nostalgia']).toEqual({ ...before['zlaya-nostalgia'], title: 'Злая Ностальгия (Deluxe)', releaseDate: '1 сентября 2026' })
})

test('новая обложка — под новым именем, старая удаляется тем же коммитом', async ({ page }) => {
    const mocks = await openRelease(page, 'zlaya-nostalgia')
    await page.getByLabel('Новая обложка').setInputFiles(SQUARE)
    await expect(page.getByText('Новая: 1254×1254')).toBeVisible()
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const list = page.getByRole('dialog').getByTestId('commit-files')
    await expect(list).toContainText('новый')
    await expect(list).toContainText('images/album4-cover-20261002.jpg')
    await expect(list).toContainText('удалён')
    await expect(list).toContainText('images/album4-cover.jpg')
    await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const files = committed(mocks)
    expect(files.map((f) => [f.path, f.delete ? 'delete' : f.blob ? 'blob' : 'text'])).toEqual([
        ['src/content/releases.json', 'text'],
        ['images/album4-cover-20261002.jpg', 'blob'],
        ['images/album4-cover.jpg', 'delete']
    ])
    expect(JSON.parse(files[0].content!)['zlaya-nostalgia'].cover).toBe('images/album4-cover-20261002.jpg')
    expect(mocks.calls.find((c) => c.action === 'stage-blob')!.body.path).toBe('images/album4-cover-20261002.jpg')
})

test('убрать PDF', async ({ page }) => {
    const mocks = await openRelease(page, 'disinvolto')
    await page.getByRole('radio', { name: 'Убрать' }).click()
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    await expect(page.getByRole('dialog').getByTestId('commit-message')).toHaveText('admin: релиз «Disinvolto: Danilovsky»: PDF убран')
    await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const files = committed(mocks)
    expect(files.find((f) => f.delete)!.path).toBe('lyrics-books/disinvolto.pdf')
    expect(JSON.parse(files[0].content!).disinvolto.lyricsBookPath).toBeUndefined()
})

test('неквадратная обложка — сохранение недоступно', async ({ page }) => {
    await openRelease(page, 'faaa')
    await page.getByLabel('Новая обложка').setInputFiles(TALL)
    await expect(page.getByTestId('edit-errors')).toContainText('Обложка должна быть квадратной (сейчас 737×810)')
    await expect(page.getByRole('button', { name: 'Сохранить…' })).toBeDisabled()
})

test('телефон: без горизонтальной прокрутки', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await openRelease(page, 'born-to-be-deluxe')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
})
