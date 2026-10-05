import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { ADMIN_USER, FIXTURE_UPLOADS, HEAD_SHA, installMocks, loginAs, repoFile, type ContentCall } from './mocks'

const SQUARE_COVER = { name: 'cover.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(FIXTURE_UPLOADS, 'square.jpg')) }
const TALL_COVER = { name: 'tall.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(FIXTURE_UPLOADS, 'tall.jpg')) }
// Браузеры иногда называют mp3 «audio/mp3» — админка всё равно отправит audio/mpeg.
const mp3 = (name: string, size = 2048) => ({ name, mimeType: 'audio/mp3', buffer: Buffer.concat([Buffer.from('ID3'), Buffer.alloc(size)]) })
const pdf = { name: 'book.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }

interface Opts {
    stageFails?: boolean
}

async function openForm(page: Page, opts: Opts = {}) {
    let blobN = 0
    const mocks = await installMocks(page, {
        content: (call: ContentCall) => {
            if (call.action === 'stage-blob') {
                if (opts.stageFails) return { status: 422, body: { error: 'validation', message: 'Содержимое не похоже на mp3: audio/album5/vtoroy.mp3' } }
                const sha = (++blobN).toString(16).padStart(40, 'e')
                return { body: { sha, path: call.body.path, size: 100, token: 't'.repeat(64) } }
            }
            if (call.action === 'commit') return { body: { sha: 'f'.repeat(40), url: 'u', message: call.body.message } }
            return undefined
        }
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    await page.goto('/admin.html#/new-release')
    await expect(page.getByRole('textbox', { name: 'Название релиза' })).toBeVisible()
    return mocks
}

test('альбом: форма → подтверждение → загрузка медиа → один коммит', async ({ page }) => {
    const mocks = await openForm(page)
    await page.getByRole('textbox', { name: 'Название релиза' }).fill('Тестовый альбом')
    await expect(page.getByRole('textbox', { name: 'ID релиза' })).toHaveValue('testovy-albom')
    await page.getByRole('textbox', { name: 'Дата релиза' }).fill('2026-10-15')
    await expect(page.getByText('В реестре: «15 октября 2026»')).toBeVisible()
    await page.getByLabel('Обложка').setInputFiles(SQUARE_COVER)
    await expect(page.getByTestId('cover-info')).toContainText('1254×1254')
    await page.getByLabel('PDF с текстами').setInputFiles(pdf)

    await page.getByLabel('Добавить mp3 файлами').setInputFiles([mp3('Первый.mp3'), mp3('Второй.mp3')])
    const tracks = page.getByTestId('tracklist').locator('li')
    await expect(tracks).toHaveCount(2)
    await expect(page.getByRole('textbox', { name: 'Slug трека 1' })).toHaveValue('pervy')
    // Порядок: «Второй» наверх.
    await page.getByRole('button', { name: 'Трек 1 ниже' }).click()
    await expect(page.getByRole('textbox', { name: 'Название трека 1' })).toHaveValue('Второй')
    await expect(tracks.nth(0)).toContainText('vtoroy.mp3 · 01-vtoroy.txt')
    await page.getByRole('checkbox', { name: 'Сделать промо на главной' }).check()

    await page.getByRole('button', { name: 'Проверить и опубликовать…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-message')).toHaveText('admin: новый альбом «Тестовый альбом»')
    const listed = await dialog.getByTestId('commit-files').locator('li b').allTextContents()
    expect(listed).toEqual([
        'src/content/releases.json',
        'src/content/site.json',
        'images/album5-cover.jpg',
        'lyrics-books/testovy-albom.pdf',
        'audio/album5/vtoroy.mp3',
        'audio/album5/pervy.mp3',
        'lyrics/album5/01-vtoroy.txt',
        'lyrics/album5/02-pervy.txt'
    ])
    await expect(dialog).toContainText('существующие 7 релизов не меняются')
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByTestId('done')).toContainText('Релиз «Тестовый альбом» отправлен на публикацию')

    // Медиа: staging → stage-blob, по одному.
    expect(mocks.uploads.map((u) => u.name.split('.').pop())).toEqual(['jpg', 'pdf', 'mp3', 'mp3'])
    expect(mocks.uploads.every((u) => /^[0-9a-f-]{36}\.(jpg|pdf|mp3)$/.test(u.name))).toBe(true)
    expect(mocks.uploads.map((u) => u.contentType)).toEqual(['image/jpeg', 'application/pdf', 'audio/mpeg', 'audio/mpeg'])
    const staged = mocks.calls.filter((c) => c.action === 'stage-blob')
    expect(staged.map((c) => c.body.path)).toEqual(['images/album5-cover.jpg', 'lyrics-books/testovy-albom.pdf', 'audio/album5/vtoroy.mp3', 'audio/album5/pervy.mp3'])
    expect(staged.map((c) => c.body.stagingPath)).toEqual(mocks.uploads.map((u) => u.name))

    // Один коммит: реестр, промо, пустые тексты, медиа по подписанным blob.
    const commits = mocks.calls.filter((c) => c.action === 'commit')
    expect(commits).toHaveLength(1)
    expect(commits[0].body.baseSha).toBe(HEAD_SHA)
    const files = commits[0].body.files as { path: string; content?: string; blob?: { sha: string } }[]
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]))
    const before = JSON.parse(repoFile('src/content/releases.json')!)
    const after = JSON.parse(byPath['src/content/releases.json'].content!)
    expect(Object.keys(after)).toEqual([...Object.keys(before), 'testovy-albom'])
    for (const id of Object.keys(before)) expect(after[id]).toEqual(before[id])
    expect(after['testovy-albom']).toEqual({
        type: 'album',
        title: 'Тестовый альбом',
        year: '2026',
        releaseDate: '15 октября 2026',
        cover: 'images/album5-cover.jpg',
        audioPath: 'audio/album5/',
        lyricsPath: 'lyrics/album5/',
        lyricsBookPath: 'lyrics-books/testovy-albom.pdf',
        tracks: [
            { num: 1, title: 'Второй', file: 'vtoroy.mp3', lyricsFile: '01-vtoroy.txt', id: 'testovy-albom/vtoroy' },
            { num: 2, title: 'Первый', file: 'pervy.mp3', lyricsFile: '02-pervy.txt', id: 'testovy-albom/pervy' }
        ]
    })
    // Формат файла реестра — как у текущего (4 пробела, перевод строки в конце).
    expect(byPath['src/content/releases.json'].content!.endsWith('\n    }\n}\n')).toBe(true)
    expect(JSON.parse(byPath['src/content/site.json'].content!)).toEqual({ promo: { enabled: true, releaseId: 'testovy-albom' } })
    expect(byPath['lyrics/album5/01-vtoroy.txt'].content).toBe('')
    expect(byPath['audio/album5/pervy.mp3'].blob?.sha).toMatch(/^e+4$/)
    expect(mocks.unexpected).toEqual([])
})

test('сингл: общие папки, slug.txt, ссылка YouTube в embed', async ({ page }) => {
    const mocks = await openForm(page)
    await page.getByRole('radio', { name: 'Сингл' }).click()
    await page.getByRole('textbox', { name: 'Название релиза' }).fill('Новый сингл')
    await expect(page.getByRole('textbox', { name: 'Название трека 1' })).toHaveValue('Новый сингл')
    await page.getByRole('textbox', { name: 'Ссылка на YouTube' }).fill('https://www.youtube.com/watch?v=vI_8FLsAn50')
    await expect(page.getByText('https://www.youtube.com/embed/vI_8FLsAn50')).toBeVisible()
    await page.getByLabel('Обложка').setInputFiles(SQUARE_COVER)
    await page.getByLabel('mp3 трека 1').setInputFiles(mp3('track.mp3'))
    await expect(page.getByTestId('tracklist')).toContainText('novy-singl.mp3 · novy-singl.txt')
    await page.getByRole('button', { name: 'Проверить и опубликовать…' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByTestId('done')).toBeVisible()
    const files = mocks.calls.find((c) => c.action === 'commit')!.body.files as { path: string; content?: string }[]
    const reg = JSON.parse(files.find((f) => f.path === 'src/content/releases.json')!.content!)
    expect(reg['novy-singl']).toMatchObject({
        type: 'single',
        cover: 'images/single7-cover.jpg',
        audioPath: 'audio/singles/',
        lyricsPath: 'lyrics/singles/',
        videoUrl: 'https://www.youtube.com/embed/vI_8FLsAn50',
        tracks: [{ num: 1, title: 'Новый сингл', file: 'novy-singl.mp3', lyricsFile: 'novy-singl.txt', id: 'novy-singl/novy-singl' }]
    })
    expect(files.map((f) => f.path)).not.toContain('src/content/site.json')
})

test('проверки до публикации: обложка, mp3, занятый id', async ({ page }) => {
    const mocks = await openForm(page)
    await page.getByRole('textbox', { name: 'Название релиза' }).fill('FAAA')
    // Авто-ID не совпадает с существующим.
    await expect(page.getByRole('textbox', { name: 'ID релиза' })).toHaveValue('faaa-2')
    await page.getByRole('textbox', { name: 'ID релиза' }).fill('faaa')
    await expect(page.getByText('ID «faaa» уже занят')).toBeVisible()
    await page.getByLabel('Обложка').setInputFiles(TALL_COVER)
    await page.getByRole('textbox', { name: 'Название трека 1' }).fill('Трек')
    await page.getByRole('button', { name: 'Проверить и опубликовать…' }).click()
    const errors = page.getByTestId('errors')
    await expect(errors).toContainText('Релиз с ID «faaa» уже есть')
    await expect(errors).toContainText('Обложка должна быть квадратной (сейчас 737×810)')
    await expect(errors).toContainText('Трек 1: нет mp3')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(mocks.calls.filter((c) => c.action === 'commit' || c.action === 'stage-blob')).toEqual([])
})

test('ошибка загрузки медиа — коммита нет, форма остаётся', async ({ page }) => {
    const mocks = await openForm(page, { stageFails: true })
    await page.getByRole('textbox', { name: 'Название релиза' }).fill('Альбом с ошибкой')
    await page.getByLabel('Обложка').setInputFiles(SQUARE_COVER)
    await page.getByLabel('mp3 трека 1').setInputFiles(mp3('Второй.mp3'))
    await page.getByRole('button', { name: 'Проверить и опубликовать…' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Содержимое не похоже на mp3')
    expect(mocks.calls.filter((c) => c.action === 'commit')).toEqual([])
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(page.getByRole('textbox', { name: 'Название релиза' })).toHaveValue('Альбом с ошибкой')
})

test('телефон: форма без горизонтальной прокрутки', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await openForm(page)
    await page.getByRole('button', { name: '+ Трек' }).click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
})
