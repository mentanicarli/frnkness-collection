import { test, expect, type Browser, type Page } from '@playwright/test'
import fs from 'node:fs'
import { ADMIN_USER, DEFAULT_USERS, PLAIN_USER, SECOND_USER, installMocks, loginAs, signInSite } from './mocks'
import { SocialBackend } from './socialMock'
import type { MockUser } from './accountsMock'

// «Итоги года»: подсчёт и права выполняют настоящие SQL-функции миграции на
// PGlite (e2e/socialMock.ts). Каталог — только фикстура tests/fixtures/catalog.
// Год 2025 уже закончился, поэтому итоги зафиксированы и не зависят от даты запуска.

test.describe.configure({ timeout: 90_000 })

const YEAR = 2025

async function newSocial(): Promise<SocialBackend> {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    // Слушатель: 12 прослушиваний, сессии, избранное и комната вместе со вторым.
    const keys = ['zlaya-nostalgia-0', 'zlaya-nostalgia-0', 'zlaya-nostalgia-0', 'faaa-0', 'faaa-0', 'boxik-0', 'zlaya-nostalgia-1', 'zlaya-nostalgia-1', 'faaa-0', 'boxik-0', 'zlaya-nostalgia-0', 'disinvolto-0']
    for (const [i, key] of keys.entries()) {
        const hour = [8, 13, 19, 23][i % 4]
        await social.sql(`insert into public.play_events (track_key, user_id, created_at) values ($1, $2, $3::timestamptz)`, [key, PLAIN_USER.id, `2025-06-${String(1 + (i % 5)).padStart(2, '0')} ${String(hour).padStart(2, '0')}:00:00+03`])
        await social.sql(
            `insert into public.listen_sessions (session_id, track_key, listened_seconds, max_position, duration, user_id, created_at) values (gen_random_uuid(), $1, 180, 180, 200, $2, $3::timestamptz)`,
            [key, PLAIN_USER.id, `2025-06-${String(1 + (i % 5)).padStart(2, '0')} ${String(hour).padStart(2, '0')}:00:00+03`]
        )
    }
    await social.sql(`update public.profiles set created_at = '2025-01-01 00:00:00+03'`)
    await social.sql(`insert into public.favorites (user_id, track_id, created_at) values ($1, 'faaa/faaa', '2025-07-01 12:00:00+03')`, [PLAIN_USER.id])
    const room = '11111111-1111-4111-8111-111111111111'
    await social.sql(`insert into public.room_visits (user_id, room_id, role, joined_at, left_at) values ($1, $3, 'owner', '2025-08-01 10:00:00+03', '2025-08-01 11:00:00+03'), ($2, $3, 'guest', '2025-08-01 10:00:00+03', '2025-08-01 11:00:00+03')`, [PLAIN_USER.id, SECOND_USER.id, room])
    // Второй слушал совсем немного.
    for (let i = 0; i < 3; i++) await social.sql(`insert into public.play_events (track_key, user_id, created_at) values ('faaa-0', $1, '2025-06-10 12:00:00+03')`, [SECOND_USER.id])
    return social
}

async function openSite(browser: Browser, social: SocialBackend, user: MockUser, viewport = { width: 1280, height: 720 }, touch = false): Promise<Page> {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', hasTouch: touch, isMobile: touch })
    const page = await context.newPage()
    await installMocks(page, { social })
    await signInSite(page, user)
    return page
}

async function openAdmin(browser: Browser, social: SocialBackend): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    await installMocks(page, { social })
    await loginAs(page, ADMIN_USER)
    await page.goto('/admin.html#/recap')
    await page.getByTestId('recap-year').selectOption(String(YEAR))
    return page
}

const publishTo = async (admin: Page, nick: string) => {
    await admin.getByTestId('recap-search').fill(nick)
    await admin.getByTestId(`recap-pick-${nick}`).check()
    await admin.getByTestId('recap-show-selected').click()
    await expect(admin.getByTestId('recap-admin-notice')).toContainText('выбранным')
}

const next = (page: Page) => page.getByTestId('recap-next').click()

test('пока итоги не открыты: ни плашки, ни ссылок, страница недоступна', async ({ browser }) => {
    const social = await newSocial()
    const page = await openSite(browser, social, PLAIN_USER)
    await page.goto('/#/')
    await expect(page.getByTestId('user-menu')).toBeVisible()
    await expect(page.getByTestId('recap-banner')).toHaveCount(0)
    await page.getByTestId('user-menu').click()
    await expect(page.getByTestId('menu-recap')).toHaveCount(0)
    await page.goto(`/#/recap/${YEAR}`)
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByTestId('recap-story')).toHaveCount(0)
    // И прямой вызов базы отвечает «Недоступно».
    const res = await social.rpc('year_recap', { p_year: YEAR, p_user: null }, PLAIN_USER.id)
    expect(res && (await res).status).toBe(403)
    const other = await social.rpc('year_recap', { p_year: YEAR, p_user: PLAIN_USER.id }, SECOND_USER.id)
    expect(other && (await other).status).toBe(403)
})

test('админ открывает итоги выбранному: плашка, просмотр, закрытие, ссылки; остальные ничего не видят', async ({ browser }) => {
    const social = await newSocial()
    const admin = await openAdmin(browser, social)

    // Общие цифры.
    await expect(admin.getByTestId('recap-overview')).toContainText('Прослушиваний')
    await expect(admin.getByTestId('recap-status')).toContainText('Закрыто для всех')
    await publishTo(admin, PLAIN_USER.nick)
    await expect(admin.getByTestId('recap-status')).toContainText('Открыто выбранным')
    await expect(admin.getByTestId('recap-grants')).toContainText(PLAIN_USER.nick)
    await expect(admin.getByTestId(`recap-vis-${PLAIN_USER.nick}`)).toHaveText('открыто')

    // Слушатель: плашка при входе.
    const page = await openSite(browser, social, PLAIN_USER)
    await page.goto('/#/')
    const banner = page.getByTestId('recap-banner')
    await expect(banner).toContainText(`Твои итоги ${YEAR} готовы`)
    await page.getByTestId('recap-banner-open').click()

    // Карточки: прогресс, клавиши, кнопки, клик.
    const story = page.getByTestId('recap-story')
    await expect(story).toBeVisible()
    await expect(page.getByTestId('recap-card-intro')).toContainText(String(YEAR))
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('recap-card-minutes')).toContainText('36')
    await next(page)
    const top = page.getByTestId('recap-top-track')
    await expect(top).toHaveCount(5)
    await expect(top.first()).toContainText('4×')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('recap-card-minutes')).toBeVisible()
    await story.click({ position: { x: 600, y: 300 } })
    await expect(page.getByTestId('recap-card-top')).toBeVisible()

    // До последней карточки: сводка и сохранение.
    for (let i = 0; i < 12 && (await page.getByTestId('recap-card-summary').count()) === 0; i++) await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('recap-card-summary')).toContainText(PLAIN_USER.nick)
    await expect(page.getByTestId('recap-card-summary')).toContainText('frnkness.ru')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('recap-save').click()])
    expect(download.suggestedFilename()).toBe(`frnkness-recap-${YEAR}.png`)
    const file = await download.path()
    const png = fs.readFileSync(file!)
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(1080)
    expect(png.readUInt32BE(20)).toBe(1920)
    await expect(page.getByTestId('recap-save-status')).toContainText('сохранена')

    // Закрыть: на главную; плашка сама больше не появляется, ссылки остаются.
    await page.getByTestId('recap-close').click()
    await expect(story).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('user-menu')).toBeVisible()
    await expect(page.getByTestId('recap-banner')).toHaveCount(0)
    await page.getByTestId('user-menu').click()
    await expect(page.getByTestId('menu-recap')).toHaveText(`Итоги ${YEAR}`)
    await page.getByTestId('menu-recap').click()
    await expect(page.getByTestId('recap-story')).toBeVisible()

    // Второй пользователь итогов не видит, чужой адрес не открывается.
    const other = await openSite(browser, social, SECOND_USER)
    await other.goto('/#/')
    await expect(other.getByTestId('user-menu')).toBeVisible()
    await expect(other.getByTestId('recap-banner')).toHaveCount(0)
    await other.goto(`/#/recap/${YEAR}`)
    await expect(other).toHaveURL(/#\/$/)
})

test('админ смотрит итоги любого пользователя теми же карточками, потом скрывает и открывает всем', async ({ browser }) => {
    const social = await newSocial()
    const admin = await openAdmin(browser, social)
    await admin.getByTestId(`recap-view-${PLAIN_USER.nick}`).click()
    const preview = admin.getByTestId('recap-preview')
    await expect(preview.getByTestId('recap-card-intro')).toContainText(PLAIN_USER.nick)
    await preview.getByTestId('recap-story').focus()
    await preview.getByTestId('recap-story').press('ArrowRight')
    await expect(preview.getByTestId('recap-card-minutes')).toContainText('36')

    // У второго данных мало — те же правила показа, что на сайте.
    await admin.getByTestId(`recap-view-${SECOND_USER.nick}`).click()
    await preview.getByTestId('recap-story').focus()
    await preview.getByTestId('recap-story').press('ArrowRight')
    await expect(preview.getByTestId('recap-card-sparse')).toBeVisible()

    // Показать всем: подтверждение; новый человек тоже увидит.
    await admin.getByTestId('recap-show-all').click()
    await admin.getByTestId('recap-confirm').click()
    await expect(admin.getByTestId('recap-status')).toContainText('Открыто всем')
    await expect(admin.getByTestId('recap-status')).toContainText('зарегистрируется позже')
    const second = await openSite(browser, social, SECOND_USER)
    await second.goto('/#/')
    await expect(second.getByTestId('recap-banner')).toBeVisible()

    // Скрыть выбранным (второму) — при режиме «всем» это личное исключение.
    await admin.getByTestId('recap-search').fill(SECOND_USER.nick)
    await admin.getByTestId(`recap-pick-${SECOND_USER.nick}`).check()
    await admin.getByTestId('recap-hide-selected').click()
    await expect(admin.getByTestId('recap-grants')).toContainText('скрыто')
    await second.reload()
    await expect(second.getByTestId('user-menu')).toBeVisible()
    await expect(second.getByTestId('recap-banner')).toHaveCount(0)

    // Скрыть у всех.
    await admin.getByTestId('recap-hide-all').click()
    await admin.getByTestId('recap-confirm').click()
    await expect(admin.getByTestId('recap-status')).toContainText('Закрыто для всех')
})

test('телефон: свайп листает, карточка помещается в экран', async ({ browser }) => {
    const social = await newSocial()
    await social.sql(`insert into public.recap_settings (year, mode) values ($1, 'all')`, [YEAR])
    const page = await openSite(browser, social, PLAIN_USER, { width: 390, height: 780 }, true)
    await page.goto(`/#/recap/${YEAR}`)
    const stage = page.locator('.rs-stage')
    await expect(page.getByTestId('recap-card-intro')).toBeVisible()
    const swipe = async (from: number, to: number) => {
        await stage.dispatchEvent('pointerdown', { clientX: from, clientY: 400, pointerId: 1, pointerType: 'touch', isPrimary: true })
        await stage.dispatchEvent('pointerup', { clientX: to, clientY: 410, pointerId: 1, pointerType: 'touch', isPrimary: true })
    }
    await swipe(320, 60)
    await expect(page.getByTestId('recap-card-minutes')).toBeVisible()
    await swipe(60, 320)
    await expect(page.getByTestId('recap-card-intro')).toBeVisible()
    // Ничего не вылезает за экран по горизонтали.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflow).toBe(false)
    // На телефоне сохранение — тоже скачивание (Android); на iOS — окно «Поделиться» (покрыто юнит-тестами).
    for (let i = 0; i < 12 && (await page.getByTestId('recap-card-summary').count()) === 0; i++) await swipe(320, 60)
    await expect(page.getByTestId('recap-save')).toBeVisible()
})
