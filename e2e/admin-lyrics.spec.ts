import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, HEAD_SHA, installMocks, loginAs, type ContentCall } from './mocks'

const NEW_SHA = 'b'.repeat(40)

interface Opts {
    commit?: (call: ContentCall) => { status?: number; body: unknown } | undefined
    deploy?: string
}

async function openEditor(page: Page, hash: string, opts: Opts = {}) {
    const mocks = await installMocks(page, {
        content: (call) => {
            if (call.action === 'commit') {
                return opts.commit?.(call) ?? { body: { sha: NEW_SHA, url: 'https://github.com/x/commit/b', message: call.body.message } }
            }
            if (call.action === 'deploy-status' && call.body.sha === NEW_SHA) {
                return { body: { state: opts.deploy ?? 'published', url: 'https://github.com/x/actions/runs/42' } }
            }
            return undefined
        }
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    await page.goto('/admin.html' + hash)
    return mocks
}

const lyricsInput = (page: Page) => page.getByRole('textbox', { name: 'Текст песни' })

test('загрузка текста и разборов, предпросмотр как на сайте', async ({ page }) => {
    const mocks = await openEditor(page, '#/lyrics/most-venture-poopsicks/0')
    await expect(lyricsInput(page)).toHaveValue(/^\[Припев\]\nПупсики \(смешное имя\),/)
    await expect(page.getByRole('textbox', { name: 'О треке' })).toHaveValue(/Трек, с которого началась/)
    await expect(page.getByTestId('lines').locator('.adm-line.has-note').first()).toContainText('Пупсики (смешное имя),')
    await expect(page.getByTestId('dangling')).toHaveCount(0)
    await expect(page.getByText('Изменений нет')).toBeVisible()

    await page.getByRole('tab', { name: 'Предпросмотр' }).click()
    const preview = page.getByTestId('preview')
    await expect(preview.locator('.track-section-title').first()).toHaveText('О треке')
    const noted = preview.locator('.lyric-line.has-note').first()
    await noted.click()
    await expect(preview.locator('.lyric-note').first()).toBeVisible()
    // Метки секций не принимают разборы и рендерятся как на сайте.
    await expect(preview.locator('.lyric-section').first()).toHaveText('[Припев]')

    const read = mocks.calls.find((c) => c.action === 'read' && (c.body.paths as string[]).includes('lyrics/album1/01-poopsicks.txt'))!
    expect(read.body).toEqual({ action: 'read', ref: HEAD_SHA, paths: ['lyrics/album1/01-poopsicks.txt', 'lyrics/album1/01-poopsicks.notes.json'] })
})

test('добавить разбор и сохранить: подтверждение, один коммит, статус публикации', async ({ page }) => {
    const mocks = await openEditor(page, '#/lyrics/most-venture-poopsicks/0')
    const line = page.getByTestId('lines').locator('.adm-line', { hasText: 'Темки, темки, темки —' }).first()
    await line.click()
    await page.getByRole('textbox', { name: 'Разбор строки' }).fill('Новый разбор')
    await page.getByRole('button', { name: 'Готово' }).click()
    await expect(line).toContainText('Новый разбор')
    await expect(page.getByText('Есть несохранённые изменения')).toBeVisible()

    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-message')).toHaveText('admin: описание и разборы «POOPSICKS» (Most Venture Poopsicks / Last Over V)')
    await expect(dialog.getByTestId('commit-files')).toHaveText(/изменён\s*lyrics\/album1\/01-poopsicks\.notes\.json/)
    await expect(dialog.getByTestId('commit-files').locator('li')).toHaveCount(1)
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)

    const commit = mocks.calls.find((c) => c.action === 'commit')!
    expect(commit.body.baseSha).toBe(HEAD_SHA)
    const files = commit.body.files as { path: string; content: string }[]
    expect(files.map((f) => f.path)).toEqual(['lyrics/album1/01-poopsicks.notes.json'])
    const saved = JSON.parse(files[0].content)
    expect(saved.annotations.some((a: { line: string; note: string }) => a.line === 'Темки, темки, темки —' && a.note === 'Новый разбор')).toBe(true)
    expect(files[0].content.endsWith('\n')).toBe(true)

    await expect(page.getByTestId('publish-status')).toContainText('Публикуется')
    await expect(page.getByTestId('publish-status')).toContainText('Опубликовано', { timeout: 15_000 })
    await expect(page.getByText('Изменений нет')).toBeVisible()
})

test('правка текста: висящий разбор, текст и разборы — одним коммитом', async ({ page }) => {
    const mocks = await openEditor(page, '#/lyrics/most-venture-poopsicks/0')
    const input = lyricsInput(page)
    const value = await input.inputValue()
    // Строка повторяется в припеве — меняем все вхождения.
    await input.fill(value.replaceAll('Пупсики (смешное имя)', 'Пупсики (новое имя)'))
    await expect(page.getByTestId('dangling')).toContainText('«Пупсики (смешное имя),»')

    await page.getByTestId('dangling').getByRole('button', { name: 'Удалить разбор' }).first().click()
    await expect(page.getByTestId('dangling')).toHaveCount(0)

    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-files').locator('li')).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)
    const commits = mocks.calls.filter((c) => c.action === 'commit')
    expect(commits).toHaveLength(1)
    const paths = (commits[0].body.files as { path: string }[]).map((f) => f.path)
    expect(paths).toEqual(['lyrics/album1/01-poopsicks.txt', 'lyrics/album1/01-poopsicks.notes.json'])
    expect(commits[0].body.message).toBe('текст, описание и разборы «POOPSICKS» (Most Venture Poopsicks / Last Over V)')
})

test('пустой трек: «Текст будет позже», .notes.json не создаётся без разборов', async ({ page }) => {
    const mocks = await openEditor(page, '#/lyrics/born-to-be-deluxe/2')
    await expect(lyricsInput(page)).toHaveValue('')
    await page.getByRole('tab', { name: 'Предпросмотр' }).click()
    await expect(page.getByTestId('preview')).toContainText('Текст будет позже...')
    await lyricsInput(page).fill('[Куплет 1]\nПервая строка\n')
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    await expect(page.getByRole('dialog').getByTestId('commit-files').locator('li')).toHaveCount(1)
    await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const files = mocks.calls.find((c) => c.action === 'commit')!.body.files as { path: string; content: string }[]
    expect(files).toEqual([{ path: 'lyrics/album3/03-come-n-team.txt', content: '[Куплет 1]\nПервая строка\n' }])
})

test('конфликт: ветка ушла вперёд — понятная ошибка, правки не теряются', async ({ page }) => {
    await openEditor(page, '#/lyrics/singles/0'.replace('singles', 'faaa'), {
        commit: () => ({ status: 409, body: { error: 'conflict', message: 'Данные на сайте изменились, пока ты редактировал. Обнови страницу и повтори правку.' } })
    })
    await lyricsInput(page).fill('Новый текст')
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Данные на сайте изменились')
    await expect(dialog.getByRole('button', { name: 'обнови страницу' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Опубликовать' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(lyricsInput(page)).toHaveValue('Новый текст')
})

test('ошибка сборки — ссылка на запуск в GitHub Actions', async ({ page }) => {
    await openEditor(page, '#/lyrics/faaa/0', { deploy: 'failed' })
    await lyricsInput(page).fill('Другой текст')
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click()
    const toast = page.getByTestId('publish-status')
    await expect(toast).toContainText('Ошибка сборки', { timeout: 15_000 })
    await expect(toast.getByRole('link', { name: 'Открыть запуск в GitHub Actions' })).toHaveAttribute('href', 'https://github.com/x/actions/runs/42')
})

test('переход на другой трек с несохранёнными правками — спрашивает', async ({ page }) => {
    await openEditor(page, '#/lyrics/faaa/0')
    await lyricsInput(page).fill('Черновик')
    page.once('dialog', (d) => d.dismiss())
    await page.getByRole('combobox', { name: 'Релиз' }).selectOption('boxik')
    await expect(page).toHaveURL(/#\/lyrics\/faaa\/0$/)
    await expect(lyricsInput(page)).toHaveValue('Черновик')
    page.once('dialog', (d) => d.accept())
    await page.getByRole('combobox', { name: 'Релиз' }).selectOption('boxik')
    await expect(page).toHaveURL(/#\/lyrics\/boxik\/0$/)
    await expect(lyricsInput(page)).not.toHaveValue('Черновик')
})

test('телефон: вкладки текст / разборы / предпросмотр', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await openEditor(page, '#/lyrics/most-venture-poopsicks/0')
    await expect(lyricsInput(page)).toBeVisible()
    await page.getByRole('tab', { name: /Разборы/ }).click()
    await expect(lyricsInput(page)).toBeHidden()
    await expect(page.getByTestId('lines')).toBeVisible()
    await page.getByRole('tab', { name: 'Предпросмотр' }).click()
    await expect(page.getByTestId('preview')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
})
