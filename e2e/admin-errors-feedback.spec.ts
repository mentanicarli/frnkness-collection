import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, DEFAULT_USERS, OWNER_USER, PLAIN_USER, SECOND_USER, installMocks, loginAs } from './mocks'
import { SocialBackend } from './socialMock'

// Админка: «Ошибки» (группа «Статистика») и «Обращения» (группа «Люди»).
// RPC — настоящие SQL-функции миграции на PGlite (e2e/socialMock.ts).

test.describe.configure({ timeout: 90_000 })

const err = (social: SocialBackend, message: string, browser: string, user: string | null, ago = '1 minute', build = 'abc1234') =>
    social.sql(
        `insert into public.client_errors (fingerprint, message, stack, page, browser, build, user_id, created_at)
         values (md5($1), $1, 'at f (a.js:1:1)', '/#/track/a/b', $2, $3, $4, now() - $5::interval)`,
        [message, browser, build, user, ago]
    )
const report = (social: SocialBackend, userId: string, nick: string, message: string, status = 'new') =>
    social.sql(
        `insert into public.feedback_reports (user_id, nick, message, page, browser, build, status, closed_at)
         values ($1, $2, $3, '/#/friends', 'Chrome 126 / Windows', 'abc1234', $4, case when $4 = 'done' then now() else null end)`,
        [userId, nick, message, status]
    )

async function open(page: Page, as = OWNER_USER) {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    const mocks = await installMocks(page, { social })
    await loginAs(page, as)
    return { social, mocks }
}

test('«Ошибки»: группы с счётчиком, последним появлением и браузерами; «Отметить решённой»; старше 30 дней удаляются', async ({ page }) => {
    const { social, mocks } = await (async () => {
        const social = new SocialBackend(DEFAULT_USERS)
        await social.ready()
        await err(social, 'TypeError: x is undefined', 'Chrome 126 / Windows', PLAIN_USER.id)
        await err(social, 'TypeError: x is undefined', 'Chrome 126 / Windows', SECOND_USER.id, '5 minutes')
        await err(social, 'TypeError: x is undefined', 'Safari 17 / iOS', null, '10 minutes')
        await err(social, 'Другая ошибка', 'Firefox 127 / Linux', null, '2 hours')
        await err(social, 'Очень старая ошибка', 'Chrome 100', null, '31 days')
        const mocks = await installMocks(page, { social })
        await loginAs(page, OWNER_USER)
        return { social, mocks }
    })()

    await page.getByTestId('nav-errors').click()
    await expect(page.getByRole('navigation', { name: 'Разделы' }).getByRole('group', { name: 'Статистика' }).getByTestId('nav-errors')).toBeVisible()
    const groups = page.getByTestId('error-group')
    await expect(groups).toHaveCount(2)
    const main = groups.filter({ hasText: 'TypeError: x is undefined' })
    await expect(main.getByTestId('error-count')).toHaveText('3×')
    await expect(main.getByTestId('error-last')).not.toHaveText('')
    await expect(main.getByTestId('error-browsers')).toContainText('Chrome 126 / Windows (2)')
    await expect(main.getByTestId('error-browsers')).toContainText('Safari 17 / iOS (1)')
    // Старше 30 дней — удалено при обращении к разделу.
    await expect(page.getByText('Очень старая ошибка')).toHaveCount(0)
    expect(await social.sql('select 1 from public.client_errors where message = $1', ['Очень старая ошибка'])).toHaveLength(0)

    await main.getByTestId('error-resolve').click()
    await expect(groups).toHaveCount(1)
    await page.getByTestId('errors-resolved').click()
    await expect(groups).toHaveCount(1)
    await expect(groups.first()).toContainText('TypeError: x is undefined')
    await groups.first().getByTestId('error-reopen').click()
    await expect(page.getByTestId('errors-empty')).toBeVisible()
    await page.getByTestId('errors-open').click()
    await expect(groups).toHaveCount(2)
    expect(mocks.unexpected).toEqual([])
})

test('«Ошибки»: текст ошибки выводится как текст, разметка не выполняется', async ({ page }) => {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    await err(social, '<img src=x onerror="window.__xss=1"> <b>жирный</b>', 'Chrome 126', null)
    await installMocks(page, { social })
    await loginAs(page, ADMIN_USER)
    await page.getByTestId('nav-errors').click()
    await expect(page.getByTestId('error-message')).toHaveText('<img src=x onerror="window.__xss=1"> <b>жирный</b>')
    await expect(page.getByTestId('error-group').locator('img, b')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
})

test('«Обращения»: ник, текст, страница, дата, статус; значок с числом новых; «решено» уменьшает значок', async ({ page }) => {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    await report(social, PLAIN_USER.id, PLAIN_USER.nick, 'Не играет трек')
    await report(social, SECOND_USER.id, SECOND_USER.nick, 'Кнопка <b>сломалась</b>')
    await report(social, PLAIN_USER.id, PLAIN_USER.nick, 'Уже починили', 'done')
    await installMocks(page, { social })
    await loginAs(page, ADMIN_USER)

    const badge = page.getByTestId('nav-badge-feedback')
    await expect(badge).toHaveText('2')
    await expect(page.getByRole('navigation', { name: 'Разделы' }).getByRole('group', { name: 'Люди' }).getByTestId('nav-feedback')).toContainText('Обращения')

    await page.getByTestId('nav-feedback').click()
    const rows = page.getByTestId('feedback-row')
    await expect(rows).toHaveCount(2)
    const first = rows.filter({ hasText: 'Не играет трек' })
    await expect(first.getByTestId('feedback-nick')).toHaveText(PLAIN_USER.nick)
    await expect(first.getByTestId('feedback-page')).toHaveText('/#/friends')
    await expect(first.getByTestId('feedback-status')).toHaveText('новое')
    await expect(first.getByTestId('feedback-date')).not.toHaveText('')
    // Текст обращения — только текстом.
    await expect(rows.filter({ hasText: 'Кнопка' }).getByTestId('feedback-text')).toHaveText('Кнопка <b>сломалась</b>')
    await expect(rows.locator('b')).toHaveCount(0)

    await first.getByTestId('feedback-done').click()
    await expect(rows).toHaveCount(1)
    await expect(badge).toHaveText('1')
    await page.getByTestId('feedback-tab-done').click()
    await expect(rows).toHaveCount(2)
    await page.getByTestId('feedback-tab-all').click()
    await expect(rows).toHaveCount(3)
    await rows.filter({ hasText: 'Уже починили' }).getByTestId('feedback-reopen').click()
    await expect(badge).toHaveText('2')
})

test('«Обращения»: без новых значка нет', async ({ page }) => {
    await open(page, ADMIN_USER)
    await expect(page.getByTestId('nav-feedback')).toBeVisible()
    await expect(page.getByTestId('nav-badge-feedback')).toHaveCount(0)
})
