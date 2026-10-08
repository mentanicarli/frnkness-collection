import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, OWNER_USER, installMocks, loginAs } from './mocks'

// Админка: боковая панель разделов вместо вкладок сверху.
// Компьютер — колонка слева; телефон — за кнопкой ☰.

const sidebar = (page: Page) => page.getByTestId('admin-sidebar')
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('компьютер: слева все разделы по группам, выбранный подсвечен, вбок листать не нужно', async ({ page }) => {
    await installMocks(page)
    await loginAs(page, OWNER_USER)
    const nav = page.getByRole('navigation', { name: 'Разделы' })
    await expect(nav).toBeVisible()
    await expect(page.getByTestId('admin-menu-btn')).toBeHidden()

    // Группы и их заголовки.
    await expect(nav.getByRole('group', { name: 'Контент' })).toBeVisible()
    await expect(nav.getByRole('group', { name: 'Статистика' })).toBeVisible()
    await expect(nav.getByRole('group', { name: 'Люди' })).toBeVisible()
    await expect(nav.getByRole('group', { name: 'Контент' }).getByRole('link')).toHaveText(['Тексты', 'Караоке', 'Промо', 'Каталог', 'Релизы', 'История', 'Новый релиз'])
    await expect(nav.getByRole('group', { name: 'Люди' }).getByRole('link')).toHaveText(['Пользователи', 'Заявки', 'Обращения', 'Теги'])
    await expect(nav.getByRole('group', { name: 'Статистика' }).getByRole('link')).toHaveText(['Статистика', 'Итоги года', 'Ошибки'])
    // Все 15 разделов видны сразу, без прокрутки панели.
    await expect(nav.getByRole('link')).toHaveCount(15)
    for (const link of await nav.getByRole('link').all()) await expect(link).toBeInViewport()
    expect(await noSideScroll(page)).toBe(true)

    // Панель слева, содержимое справа.
    const side = (await sidebar(page).boundingBox())!
    const main = (await page.locator('main.adm-shell').boundingBox())!
    expect(side.x + side.width).toBeLessThanOrEqual(main.x + 1)

    // Выбор раздела: подсветка и содержимое.
    await expect(page.getByTestId('nav-home')).toHaveAttribute('aria-current', 'page')
    await page.getByTestId('nav-users').click()
    await expect(page).toHaveURL(/admin\.html#\/users$/)
    await expect(page.getByTestId('nav-users')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('nav-users')).toHaveClass(/active/)
    await expect(page.getByTestId('nav-home')).not.toHaveAttribute('aria-current', 'page')
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
    await page.getByTestId('nav-promo').click()
    await expect(page.getByTestId('nav-promo')).toHaveAttribute('aria-current', 'page')
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1)
    // Прямой адрес тоже подсвечивает раздел.
    await page.goto('/admin.html#/stats')
    await expect(page.getByTestId('nav-stats')).toHaveAttribute('aria-current', 'page')
})

test('«Заявки» только у владельца; у админа остаётся группа «Люди» с «Пользователями»', async ({ page }) => {
    await installMocks(page)
    await loginAs(page, ADMIN_USER)
    const nav = page.getByRole('navigation', { name: 'Разделы' })
    await expect(nav.getByRole('link', { name: 'Заявки' })).toHaveCount(0)
    await expect(nav.getByRole('group', { name: 'Люди' }).getByRole('link')).toHaveText(['Пользователи', 'Обращения'])
    await expect(nav.getByRole('link')).toHaveCount(13)
})

test.describe('телефон', () => {
    test.use({ viewport: { width: 390, height: 780 } })

    test('панель спрятана за ☰: открывается, закрывается выбором раздела, нажатием мимо и Esc; вбок не листается', async ({ page }) => {
        await installMocks(page)
        await loginAs(page, OWNER_USER)
        const button = page.getByTestId('admin-menu-btn')
        await expect(button).toBeVisible()
        await expect(button).toHaveAttribute('aria-expanded', 'false')
        await expect(sidebar(page)).toBeHidden()
        expect(await noSideScroll(page)).toBe(true)

        await button.click()
        await expect(button).toHaveAttribute('aria-expanded', 'true')
        await expect(sidebar(page)).toBeVisible()
        await expect(page.getByTestId('nav-users')).toBeVisible()
        expect(await noSideScroll(page)).toBe(true)

        // Выбор раздела закрывает панель и открывает раздел.
        await page.getByTestId('nav-users').click()
        await expect(page).toHaveURL(/#\/users$/)
        await expect(sidebar(page)).toBeHidden()
        await expect(button).toHaveAttribute('aria-expanded', 'false')

        // Нажатие мимо панели.
        await button.click()
        await expect(sidebar(page)).toBeVisible()
        await page.getByTestId('admin-backdrop').click({ position: { x: 370, y: 300 } })
        await expect(sidebar(page)).toBeHidden()

        // Esc.
        await button.click()
        await expect(sidebar(page)).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(sidebar(page)).toBeHidden()

        // В открытой панели подсвечен текущий раздел.
        await button.click()
        await expect(page.getByTestId('nav-users')).toHaveAttribute('aria-current', 'page')
    })
})
