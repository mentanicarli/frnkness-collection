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
    await expect(lyricsInput(page)).toHaveValue(/^\[Припев\]\nПупсики \(смешное имя\)\n/)
    await expect(page.getByRole('textbox', { name: 'О треке' })).toHaveValue(/Трек, с которого началась/)
    await expect(page.getByTestId('lines').locator('.adm-line.has-note').first()).toContainText('Пупсики (смешное имя)')
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
    expect(read.body).toEqual({ action: 'read', ref: HEAD_SHA, paths: ['lyrics/album1/01-poopsicks.txt', 'lyrics/album1/01-poopsicks.notes.json', 'lyrics/album1/01-poopsicks.lrc'] })
})

test('добавить разбор и сохранить: подтверждение, один коммит, статус публикации', async ({ page }) => {
    const mocks = await openEditor(page, '#/lyrics/most-venture-poopsicks/0')
    const line = page.getByTestId('lines').locator('.adm-line', { hasText: 'Темки, темки, темки' }).first()
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
    expect(saved.annotations.some((a: { line: string; note: string }) => a.line === 'Темки, темки, темки' && a.note === 'Новый разбор')).toBe(true)
    expect(files[0].content.endsWith('\n')).toBe(true)

    await expect(page.getByTestId('publish-status')).toContainText('Публикуется')
    await expect(page.getByTestId('publish-status')).toContainText('Опубликовано', { timeout: 15_000 })
    await expect(page.getByText('Изменений нет')).toBeVisible()
})

test('правка текста: висящий разбор — подтверждение со списком, удаление, текст и разборы одним коммитом', async ({ page }) => {
    const mocks = await openEditor(page, '#/lyrics/most-venture-poopsicks/0')
    const input = lyricsInput(page)
    const value = await input.inputValue()
    // Строку переписали целиком (во всех вхождениях припева) — разбор не угадываем.
    await input.fill(value.replaceAll('Пупсики (смешное имя)', 'Совсем другая строка про утро'))
    await expect(page.getByTestId('dangling')).toContainText('«Пупсики (смешное имя),»')
    await expect(page.getByTestId('relink-notice')).toHaveCount(0)
    // .lrc этого трека и раньше не совпадал с текстом построчно — только предупреждение.
    await expect(page.getByTestId('lrc-follow')).toContainText('и раньше не совпадало с текстом')

    // Сохранить можно, но только через явное подтверждение со списком.
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const confirm = page.getByTestId('dangling-confirm')
    await expect(confirm).toContainText('«Пупсики (смешное имя),»')
    await confirm.getByRole('button', { name: 'Удалить его и сохранить' }).click()
    await expect(page.getByTestId('dangling')).toHaveCount(0)

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-files').locator('li')).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)
    const commits = mocks.calls.filter((c) => c.action === 'commit')
    expect(commits).toHaveLength(1)
    const files = commits[0].body.files as { path: string; content: string }[]
    expect(files.map((f) => f.path)).toEqual(['lyrics/album1/01-poopsicks.txt', 'lyrics/album1/01-poopsicks.notes.json'])
    expect(JSON.parse(files[1].content).annotations.some((a: { line: string }) => a.line.startsWith('Пупсики (смешное'))).toBe(false)
    expect(commits[0].body.message).toBe('текст, описание и разборы «POOPSICKS» (Most Venture Poopsicks / Last Over V)')
})

test('пустой текст: «Текст будет позже», .notes.json не создаётся без разборов', async ({ page }) => {
    // У COMЁ N TEAM нет .notes.json, так что на нём и проверяем, что без
    // разборов файл не создаётся. Текст очищаем руками: пустых треков в
    // репозитории больше нет.
    const mocks = await openEditor(page, '#/lyrics/born-to-be-deluxe/2')
    await lyricsInput(page).fill('')
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

test('конфликт: тот же файл изменили — кто и что, скачать свой вариант, черновик после перезагрузки', async ({ page }) => {
    // Трек без разборов: текст заменяется целиком, висящих разборов не будет.
    const path = 'lyrics/album3/03-come-n-team.txt'
    let conflict = true
    await openEditor(page, '#/lyrics/born-to-be-deluxe/2', {
        commit: () =>
            conflict
                ? {
                      status: 409,
                      body: {
                          error: 'conflict',
                          message: 'Пока ты редактировал, этот файл изменили в main',
                          details: [`${path} (anna@example.com)`],
                          conflicts: [{ path, commits: [{ sha: '7'.repeat(40), message: 'admin: текст «come n team»', user: 'anna@example.com', date: '2026-10-05T10:00:00Z' }] }],
                          head: HEAD_SHA
                      }
                  }
                : undefined
    })
    await lyricsInput(page).fill('Новый текст')
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog.getByRole('alert')).toContainText('этот файл изменили в main')
    const panel = dialog.getByTestId('conflict')
    await expect(panel).toContainText(path)
    await expect(panel).toContainText('admin: текст «come n team» — anna@example.com')
    await expect(panel).toContainText('черновик сохранён в этом браузере')
    await expect(dialog.getByRole('button', { name: 'Опубликовать' })).toBeDisabled()

    // Скачать свой вариант.
    const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Скачать мой вариант' }).click()])
    expect(download.suggestedFilename()).toBe('03-come-n-team.txt')
    const fs = await import('node:fs')
    expect(fs.readFileSync((await download.path())!, 'utf8')).toBe('Новый текст')

    // Что изменилось: «−» — сейчас в main, «+» — свой вариант.
    await panel.getByRole('button', { name: 'Что изменилось' }).click()
    await expect(panel.getByTestId('conflict-diff').locator('.add')).toHaveText(['+Новый текст'])
    await expect(panel.getByTestId('conflict-diff').locator('.del').first()).toBeVisible()

    await dialog.getByRole('button', { name: 'Закрыть' }).click()
    await expect(lyricsInput(page)).toHaveValue('Новый текст')

    // Перезагрузка: работа не потеряна — черновик предлагается восстановить.
    conflict = false
    await page.reload()
    await expect(page.getByTestId('draft-offer')).toContainText('Есть несохранённый черновик (admin@example.com)')
    await expect(lyricsInput(page)).not.toHaveValue('Новый текст')
    await page.getByRole('button', { name: 'Восстановить черновик' }).click()
    await expect(lyricsInput(page)).toHaveValue('Новый текст')
    await expect(page.getByText('Есть несохранённые изменения')).toBeVisible()
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // После успешного сохранения черновика нет.
    expect(await page.evaluate((p) => localStorage.getItem(`adm-draft:lyrics:${p}`), path)).toBeNull()
})

test('ошибка сборки — ссылка на запуск в GitHub Actions', async ({ page }) => {
    await openEditor(page, '#/lyrics/born-to-be-deluxe/2', { deploy: 'failed' })
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
