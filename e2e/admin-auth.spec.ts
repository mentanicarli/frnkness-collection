import { test, expect } from '@playwright/test'
import { ADMIN_USER, OWNER_USER, PLAIN_USER, STORAGE_KEY, fakeSession, installMocks, loginAs, signInSite } from './mocks'

test('страница входа закрыта от индексации', async ({ page }) => {
    await installMocks(page)
    await page.goto('/admin.html')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
})

test('неверный пароль — понятная ошибка', async ({ page }) => {
    await installMocks(page)
    await loginAs(page, { nick: ADMIN_USER.nick, password: 'wrong' })
    await expect(page.getByRole('alert')).toHaveText('Неверный ник или пароль')
    // Несуществующий ник — та же ошибка: по форме не узнать, какие ники есть.
    await page.getByLabel('Ник').fill('нет-такого')
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page.getByRole('alert')).toHaveText('Неверный ник или пароль')
})

test('ник входит без учёта регистра и похожих букв; владелец тоже админ', async ({ page }) => {
    await installMocks(page)
    await loginAs(page, { nick: 'FRNKNЕSS', password: OWNER_USER.password }) // «Е» кириллическая
    await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible()
    await expect(page.getByTestId('admin-nick')).toHaveText('frnkness')
    await expect(page.getByRole('link', { name: 'Заявки' })).toBeVisible()
})

test('единый вход: вошёл на сайте админом — админка открывается без входа', async ({ page }) => {
    await installMocks(page)
    await signInSite(page, ADMIN_USER)
    await page.goto('/#/')
    await expect(page.getByTestId('user-menu')).toBeVisible()
    await page.getByTestId('user-menu').click()
    await page.getByRole('menuitem', { name: 'Админка' }).click()
    await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible()
    await expect(page.getByTestId('admin-nick')).toHaveText(ADMIN_USER.nick)
    // Админ (не владелец) заявок не видит.
    await expect(page.getByRole('link', { name: 'Заявки' })).toHaveCount(0)
})

test('вход админа: разделы и статус подключений', async ({ page }) => {
    const mocks = await installMocks(page)
    await loginAs(page, ADMIN_USER)
    await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible()
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli/frnkness-collection')
    await expect(page.getByTestId('status-deploy')).toContainText('опубликована')
    // Проверка подключений + загрузка site.json для подсказки об истёкшем анонсе.
    await expect.poll(() => mocks.calls.map((c) => c.action).sort()).toEqual(['deploy-status', 'head', 'head', 'ping', 'read'])
    expect(mocks.calls.every((c) => c.authorization?.startsWith('Bearer '))).toBe(true)
    expect(mocks.unexpected).toEqual([])

    // Сессия — под общим ключом сайта и админки, не под ключом supabase-js по умолчанию.
    const keys = await page.evaluate(() => Object.keys(localStorage))
    expect(keys).toContain(STORAGE_KEY)
    expect(keys.filter((k) => k.startsWith('sb-'))).toEqual([])

    await page.reload()
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli/frnkness-collection')
})

test('не-админ видит «Нет доступа» и не получает данных', async ({ page }) => {
    const mocks = await installMocks(page)
    await loginAs(page, PLAIN_USER)
    await expect(page.getByRole('heading', { name: 'Нет доступа' })).toBeVisible()
    await expect(page.getByTestId('no-access')).toContainText(PLAIN_USER.nick)
    await expect(page.getByRole('navigation')).toHaveCount(0)
    expect(mocks.calls).toEqual([])
    await page.getByRole('button', { name: 'Выйти' }).click()
    await page.getByTestId('logout-confirm-btn').click()
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
})

test('выход в админке: без подтверждения сессия остаётся, «Отмена» её не трогает', async ({ page }) => {
    await installMocks(page)
    await loginAs(page, ADMIN_USER)
    await page.getByTestId('admin-logout').click()
    const dialog = page.getByTestId('logout-confirm')
    await expect(dialog).toContainText('Выйти из аккаунта?')
    await dialog.getByTestId('logout-cancel').click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('admin-nick')).toBeVisible()
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).not.toBeNull()
    // Esc тоже закрывает окно, не выходя.
    await page.getByTestId('admin-logout').click()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('admin-nick')).toBeVisible()
})

test('выход очищает сессию', async ({ page }) => {
    await installMocks(page)
    await loginAs(page, ADMIN_USER)
    await page.getByRole('button', { name: 'Выйти' }).click()
    await page.getByTestId('logout-confirm-btn').click()
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0)
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBeNull()
})

test('функция ответила 401 — выход с сообщением об истёкшей сессии', async ({ page }) => {
    await installMocks(page, {
        content: () => ({ status: 401, body: { error: 'unauthorized', message: 'Сессия истекла — войди заново' } })
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByRole('status')).toHaveText('Сессия истекла — войди заново')
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
})

test('истёкшая сессия при открытии — сообщение и форма входа', async ({ page }) => {
    await installMocks(page, { refreshFails: true })
    await page.addInitScript(
        ([key, session]) => localStorage.setItem(key, JSON.stringify(session)),
        [STORAGE_KEY, fakeSession({ id: ADMIN_USER.id, email: ADMIN_USER.email, role: 'admin' }, -3600)] as const
    )
    await page.goto('/admin.html')
    await expect(page.getByRole('status')).toHaveText('Сессия истекла — войди заново')
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
})

test('недействительный токен GitHub — понятное сообщение', async ({ page }) => {
    await installMocks(page, {
        content: ({ action }) =>
            action === 'ping'
                ? { status: 502, body: { error: 'github_token_invalid', message: 'Токен GitHub недействителен — обнови его в секретах функции' } }
                : undefined
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toHaveText('GitHub: Токен GitHub недействителен — обнови его в секретах функции')
})

test('функция не задеплоена — подсказка вместо общей ошибки', async ({ page }) => {
    await installMocks(page, { content: () => ({ status: 404, body: { code: 'NOT_FOUND', message: 'Requested function was not found' } }) })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('Функция admin-content не найдена')
})

test('телефон: вход и обзор без горизонтальной прокрутки', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await installMocks(page)
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-deploy')).toContainText('опубликована')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
})
