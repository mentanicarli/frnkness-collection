import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, installMocks, loginAs } from './mocks'

async function openPromo(page: Page) {
    const mocks = await installMocks(page, {
        content: (call) => (call.action === 'commit' ? { body: { sha: 'd'.repeat(40), url: 'u', message: call.body.message } } : undefined)
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    await page.goto('/admin.html#/promo')
    await expect(page.getByRole('combobox', { name: 'Релиз в промо' })).toBeVisible()
    return mocks
}

test('текущее промо из site.json и превью карточки как на сайте', async ({ page }) => {
    await openPromo(page)
    await expect(page.getByRole('checkbox', { name: 'Показывать промо-блок на главной' })).toBeChecked()
    await expect(page.getByRole('combobox', { name: 'Релиз в промо' })).toHaveValue('zlaya-nostalgia')
    const preview = page.getByTestId('promo-preview')
    await expect(preview.locator('.promo-title')).toHaveText('Злая Ностальгия')
    await expect(preview.locator('.promo-badge')).toHaveText('последний релиз')
    await expect(preview.locator('img')).toHaveAttribute('src', 'images/album4-cover.jpg')

    await page.getByRole('combobox', { name: 'Релиз в промо' }).selectOption('boxik')
    await expect(preview.locator('.promo-title')).toHaveText('какой тебе боксик?')
    await expect(page.getByText('Есть несохранённые изменения')).toBeVisible()
    await page.getByRole('button', { name: 'Отменить изменения' }).click()
    await expect(preview.locator('.promo-title')).toHaveText('Злая Ностальгия')
})

test('сменить релиз и сохранить site.json одним коммитом', async ({ page }) => {
    const mocks = await openPromo(page)
    await page.getByRole('combobox', { name: 'Релиз в промо' }).selectOption('faaa')
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-message')).toHaveText('admin: промо на главной: «FAAA»')
    await expect(dialog.getByTestId('commit-files')).toHaveText(/изменён\s*src\/content\/site\.json/)
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)
    const files = mocks.calls.find((c) => c.action === 'commit')!.body.files as { path: string; content: string }[]
    expect(files).toEqual([
        { path: 'src/content/site.json', content: '{\n    "promo": {\n        "enabled": true,\n        "releaseId": "faaa"\n    }\n}\n' }
    ])
    await expect(page.getByText('Изменений нет')).toBeVisible()
})

test('выключить промо', async ({ page }) => {
    const mocks = await openPromo(page)
    await page.getByRole('checkbox', { name: 'Показывать промо-блок на главной' }).uncheck()
    await expect(page.getByTestId('promo-hidden')).toBeVisible()
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    await expect(page.getByRole('dialog').getByTestId('commit-message')).toHaveText('admin: промо на главной выключено')
    await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const content = (mocks.calls.find((c) => c.action === 'commit')!.body.files as { content: string }[])[0].content
    expect(JSON.parse(content)).toEqual({ promo: { enabled: false, releaseId: 'zlaya-nostalgia' } })
})

test('телефон: промо без горизонтальной прокрутки', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await openPromo(page)
    await expect(page.getByTestId('promo-preview')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
})
