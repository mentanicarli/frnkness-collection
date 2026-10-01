import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, HEAD_SHA, installMocks, loginAs, type ContentCall } from './mocks'

const ADMIN_SHA = '1'.repeat(40)
const CODE_SHA = '2'.repeat(40)
const BLOCKED_SHA = '3'.repeat(40)

const HISTORY = {
    head: HEAD_SHA,
    commits: [
        {
            sha: ADMIN_SHA,
            message: 'admin: релиз «FAAA»: обложка',
            date: '2026-10-02T09:30:00Z',
            author: 'Max',
            source: 'admin',
            files: [
                { path: 'src/content/releases.json', status: 'modified', previous: null },
                { path: 'images/single6-cover-20261002.jpg', status: 'added', previous: null },
                { path: 'images/single6-cover.jpg', status: 'removed', previous: null }
            ]
        },
        { sha: CODE_SHA, message: 'feat(site): Media Session', date: '2026-10-02T08:00:00Z', author: 'Max', source: 'code', files: [{ path: 'src/main.ts', status: 'modified', previous: null }] },
        { sha: BLOCKED_SHA, message: 'admin: текст «FAAA» (FAAA)', date: '2026-10-01T12:00:00Z', author: 'Max', source: 'admin', files: [{ path: 'lyrics/singles/faaa.txt', status: 'modified', previous: null }] }
    ]
}

async function openHistory(page: Page) {
    const mocks = await installMocks(page, {
        content: (call: ContentCall) => {
            if (call.action === 'history') return { body: HISTORY }
            if (call.action === 'revert-preview' && call.body.sha === ADMIN_SHA) {
                return {
                    body: {
                        head: HEAD_SHA,
                        message: 'admin: релиз «FAAA»: обложка',
                        revertMessage: 'admin: откат «релиз «FAAA»: обложка»',
                        ok: true,
                        files: [
                            { path: 'src/content/releases.json', action: 'restore' },
                            { path: 'images/single6-cover-20261002.jpg', action: 'delete' },
                            { path: 'images/single6-cover.jpg', action: 'recreate' }
                        ],
                        conflicts: [],
                        blocked: []
                    }
                }
            }
            if (call.action === 'revert-preview' && call.body.sha === BLOCKED_SHA) {
                return {
                    body: {
                        head: HEAD_SHA,
                        message: 'admin: текст «FAAA» (FAAA)',
                        revertMessage: 'admin: откат «текст «FAAA» (FAAA)»',
                        ok: false,
                        files: [{ path: 'lyrics/singles/faaa.txt', action: 'restore' }],
                        conflicts: [{ path: 'lyrics/singles/faaa.txt', commits: [{ sha: '4'.repeat(40), message: 'admin: текст «FAAA» ещё раз' }] }],
                        blocked: []
                    }
                }
            }
            if (call.action === 'revert') return { body: { sha: '5'.repeat(40), url: 'u', message: 'admin: откат «релиз «FAAA»: обложка»' } }
            return undefined
        }
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    await page.goto('/admin.html#/history')
    await expect(page.getByTestId('history').locator('li[data-sha]')).toHaveCount(3)
    return mocks
}

const row = (page: Page, sha: string) => page.locator(`li[data-sha="${sha}"]`)

test('список: источник, файлы; «Откатить» только у правок из админки', async ({ page }) => {
    await openHistory(page)
    await expect(row(page, ADMIN_SHA)).toContainText('админка')
    await expect(row(page, CODE_SHA)).toContainText('код')
    await expect(row(page, CODE_SHA).getByRole('button', { name: 'Откатить' })).toHaveCount(0)
    await row(page, ADMIN_SHA).getByText('3 файла').click()
    await expect(row(page, ADMIN_SHA).locator('.adm-file-list li')).toHaveCount(3)
})

test('откат: подтверждение со списком файлов, затем коммит и статус публикации', async ({ page }) => {
    const mocks = await openHistory(page)
    await row(page, ADMIN_SHA).getByRole('button', { name: 'Откатить' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-message')).toHaveText('admin: откат «релиз «FAAA»: обложка»')
    const files = dialog.getByTestId('commit-files')
    await expect(files.locator('li').nth(0)).toContainText('изменён')
    await expect(files.locator('li').nth(1)).toContainText('удалён')
    await expect(files.locator('li').nth(2)).toContainText('восстановлен')
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)
    const revert = mocks.calls.find((c) => c.action === 'revert')!
    expect(revert.body).toEqual({ action: 'revert', sha: ADMIN_SHA, baseSha: HEAD_SHA })
    // Обычного коммита файлов при откате нет.
    expect(mocks.calls.filter((c) => c.action === 'commit')).toEqual([])
    await expect(page.getByTestId('publish-status')).toContainText('Публикуется')
})

test('файлы менялись позже — объяснение вместо отката', async ({ page }) => {
    const mocks = await openHistory(page)
    await row(page, BLOCKED_SHA).getByRole('button', { name: 'Откатить' }).click()
    const conflicts = page.getByTestId('revert-conflicts')
    await expect(conflicts).toContainText('lyrics/singles/faaa.txt')
    await expect(conflicts).toContainText('«admin: текст «FAAA» ещё раз» 4444444')
    await page.getByRole('button', { name: 'Понятно' }).click()
    expect(mocks.calls.filter((c) => c.action === 'revert')).toEqual([])
})
