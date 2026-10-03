import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, HEAD_SHA, installMocks, loginAs, repoTree } from './mocks'

async function openCatalog(page: Page, extraFiles: { path: string; size: number }[] = []) {
    const mocks = await installMocks(page, {
        content: (call) =>
            call.action === 'head' && extraFiles.length
                ? { body: { sha: HEAD_SHA, truncated: false, files: [...repoTree(), ...extraFiles] } }
                : undefined
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    await page.goto('/admin.html#/catalog')
    await expect(page.getByTestId('summary')).toBeVisible({ timeout: 15_000 })
    return mocks
}

test('таблица по трекам и релизам по фикстурному каталогу', async ({ page }) => {
    // Пустых текстов в фикстуре нет, поэтому пустоту одного трека подменяем
    // в дереве: размер 0 — это и есть признак пустого текста.
    const mocks = await openCatalog(page, [{ path: 'lyrics/album3/03-come-n-team.txt', size: 0 }])
    const poopsicks = page.getByTestId('track-most-venture-poopsicks-0')
    await expect(poopsicks).toContainText('POOPSICKS')
    await expect(poopsicks).toContainText('всё на месте')

    // Пустой текст ведёт в редактор текстов.
    const empty = page.getByTestId('track-born-to-be-deluxe-2')
    await expect(empty).toContainText('пустой')
    const fix = empty.getByRole('link', { name: /Тексты: текст пустой/ })
    await expect(fix).toHaveAttribute('href', '#/lyrics/born-to-be-deluxe/2')

    // Текст есть, караоке нет — кнопка синхронизатора.
    const zal = page.getByTestId('track-born-to-be-deluxe-0')
    await expect(zal.getByRole('link', { name: /Караоке: нет караоке/ })).toHaveAttribute('href', '#/lrc/born-to-be-deluxe/0')

    // Релизы: обложка и PDF.
    await expect(page.getByTestId('release-most-venture-poopsicks')).toContainText('PDF есть')
    await expect(page.getByTestId('release-faaa')).toContainText('без PDF')

    // Разборы читаются пачками не больше 60 путей.
    const reads = mocks.calls.filter((c) => c.action === 'read' && (c.body.paths as string[]).some((p) => p.endsWith('.notes.json')))
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every((c) => (c.body.paths as string[]).length <= 60)).toBe(true)
    expect(mocks.unexpected).toEqual([])
})

test('кнопка проблемы открывает нужный редактор', async ({ page }) => {
    await openCatalog(page)
    await page.getByTestId('track-born-to-be-deluxe-0').getByRole('link', { name: /Караоке/ }).click()
    await expect(page).toHaveURL(/#\/lrc\/born-to-be-deluxe\/0$/)
    await expect(page.getByRole('heading', { name: 'Караоке' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Трек' })).toHaveValue('0')
})

test('файлы без ссылок и фильтр «только проблемы»', async ({ page }) => {
    await openCatalog(page, [
        { path: 'audio/album4/old-demo.mp3', size: 2 * 1024 * 1024 },
        { path: 'images/unused.png', size: 1200 }
    ])
    const orphans = page.getByTestId('orphans')
    await expect(orphans).toContainText('audio/album4/old-demo.mp3 · 2.0 МБ')
    await expect(orphans).toContainText('images/unused.png')

    await page.getByRole('button', { name: 'Только проблемы' }).click()
    await expect(page.getByTestId('track-most-venture-poopsicks-0')).toHaveCount(0)
    await expect(page.getByTestId('track-born-to-be-deluxe-2')).toBeVisible()
})

test('телефон: отчёт без горизонтальной прокрутки страницы', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await openCatalog(page)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
})
