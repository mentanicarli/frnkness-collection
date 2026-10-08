import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, installMocks, loginAs } from './mocks'

// Время в браузере фиксируем: «сегодня» — 2 октября 2026, 12:00 по Москве.
const NOW = new Date('2026-10-02T09:00:00Z')

async function openHome(page: Page, tokenExpiresAt: string | null | undefined) {
    await page.clock.setFixedTime(NOW)
    await installMocks(page, {
        content: ({ action }) => {
            if (action !== 'ping') return undefined
            const body: Record<string, unknown> = { user: { email: ADMIN_USER.email }, repo: 'mentanicarli/frnkness-collection', branch: 'main' }
            if (tokenExpiresAt !== undefined) body.tokenExpiresAt = tokenExpiresAt
            return { body }
        }
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
}

test('токен действует долго — зелёная строка без предупреждения', async ({ page }) => {
    await openHome(page, '2027-09-30T20:00:00Z')
    await expect(page.getByTestId('status-token')).toHaveText('Токен GitHub действует ещё 363 дня (до 30.09.2027)')
    await expect(page.getByTestId('status-token').locator('.adm-dot')).toHaveClass(/adm-dot-ok/)
    await expect(page.getByTestId('token-alert')).toHaveCount(0)
})

test('меньше 30 дней — жёлтое предупреждение со ссылкой на инструкцию', async ({ page }) => {
    await openHome(page, '2026-10-20T09:00:00Z')
    await expect(page.getByTestId('status-token')).toHaveText('Токен GitHub действует ещё 18 дней (до 20.10.2026)')
    const alert = page.getByTestId('token-alert')
    await expect(alert).toHaveClass(/adm-alert-warn/)
    await expect(alert).toContainText('истекает через 18 дней (20.10.2026)')
    await expect(alert.getByRole('link')).toHaveAttribute('href', /docs\/operations\.md#обновление-токена-github$/)
})

test('истёк — красное предупреждение', async ({ page }) => {
    await openHome(page, '2026-10-01T09:00:00Z')
    await expect(page.getByTestId('status-token')).toHaveText('Токен GitHub истёк 01.10.2026')
    await expect(page.getByTestId('token-alert')).toHaveClass(/adm-alert-error/)
})

test('токен без срока', async ({ page }) => {
    await openHome(page, null)
    await expect(page.getByTestId('status-token')).toHaveText('Токен GitHub без срока действия')
    await expect(page.getByTestId('token-alert')).toHaveCount(0)
})

test('старая версия функции — подсказка обновить функцию', async ({ page }) => {
    await openHome(page, undefined)
    await expect(page.getByTestId('status-token')).toContainText('обнови функцию admin-content')
})
