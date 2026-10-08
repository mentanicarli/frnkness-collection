import { test, expect, type Page } from '@playwright/test'
import { PLAIN_USER, installMocks, signInSite } from './mocks'
import { buildPreviewPages } from '../scripts/previews'
import { fixtureReleases, fixtureTree } from '../tests/fixtures/catalog'

// Превью ссылок: страницы /r/<релиз>/ и /t/<релиз>/<слаг>/ строит та же функция,
// что и сборка (scripts/previews.ts), но из фикстуры каталога. Отдаём их по тем
// же адресам, что на frnkness.ru, вместе с их собственным CSP: если бы хеш не
// совпал со скриптом, перенаправление не сработало бы — и тест упал.

const ORIGIN = 'http://localhost:4317'
const tree = new Set(fixtureTree().map((f) => f.path))
const pages = new Map(buildPreviewPages(fixtureReleases(), { siteUrl: ORIGIN, fileExists: (rel) => tree.has(rel) || rel === 'og-default.png' }).map((p) => [p.file, p.html]))

async function servePreviews(page: Page): Promise<string[]> {
    const csp: string[] = []
    page.on('console', (m) => {
        if (/content security policy/i.test(m.text())) csp.push(m.text())
    })
    await page.route(/^http:\/\/localhost:\d+\/(r|t)\/[^?#]*$/, (route) => {
        const file = new URL(route.request().url()).pathname.slice(1) + 'index.html'
        const html = pages.get(file)
        return html ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : route.fulfill({ status: 404, body: 'нет страницы превью' })
    })
    return csp
}

test('ссылка на трек: страница превью сразу перенаправляет на #/track/…, CSP не мешает', async ({ page }) => {
    const mocks = await installMocks(page)
    await signInSite(page, PLAIN_USER)
    const csp = await servePreviews(page)
    await page.goto('/t/zlaya-nostalgia/makanochki/')
    await expect(page).toHaveURL(/\/#\/track\/zlaya-nostalgia\/makanochki$/)
    await expect(page.locator('.track-hero-title')).toHaveText('Маканочки')
    expect(csp).toEqual([])
    expect(mocks.unexpected).toEqual([])
})

test('ссылка на релиз: перенаправляет на #/release/…', async ({ page }) => {
    await installMocks(page)
    await signInSite(page, PLAIN_USER)
    const csp = await servePreviews(page)
    await page.goto('/r/most-venture-poopsicks/')
    await expect(page).toHaveURL(/\/#\/release\/most-venture-poopsicks$/)
    await expect(page.locator('#release-title')).toContainText('Most Venture Poopsicks')
    expect(csp).toEqual([])
})

test('гость по ссылке /t/…: стена, после входа — именно этот трек (?next=)', async ({ page }) => {
    const mocks = await installMocks(page)
    const csp = await servePreviews(page)
    await page.goto('/t/zlaya-nostalgia/makanochki/')
    await expect(page.getByTestId('welcome')).toBeVisible()
    await expect(page).toHaveURL(/#\/welcome\?next=\/track\/zlaya-nostalgia\/makanochki$/)

    await page.getByRole('link', { name: 'Войти' }).click()
    await page.getByLabel('Ник').fill(PLAIN_USER.nick)
    await page.getByLabel('Пароль', { exact: true }).fill(PLAIN_USER.password)
    await page.getByRole('button', { name: 'Войти' }).click()
    await expect(page).toHaveURL(/\/#\/track\/zlaya-nostalgia\/makanochki$/)
    await expect(page.locator('.track-hero-title')).toHaveText('Маканочки')
    expect(csp).toEqual([])
    expect(mocks.unexpected).toEqual([])
})

test('старые ссылки с # продолжают работать: и для вошедшего, и для гостя', async ({ page }) => {
    await installMocks(page)
    await signInSite(page, PLAIN_USER)
    await page.goto('/#/track/zlaya-nostalgia/makanochki')
    await expect(page.locator('.track-hero-title')).toHaveText('Маканочки')
    await page.goto('/#/release/zlaya-nostalgia')
    await expect(page.locator('#release-title')).toBeVisible()

    const guest = await page.context().browser()!.newContext({ serviceWorkers: 'block' })
    const guestPage = await guest.newPage()
    await installMocks(guestPage)
    await guestPage.goto('/#/track/zlaya-nostalgia/makanochki')
    await expect(guestPage).toHaveURL(/#\/welcome\?next=\/track\/zlaya-nostalgia\/makanochki$/)
    await guest.close()
})

test('«Скопировать ссылку» на треке и релизе даёт адреса страниц превью, а не «#/…»', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await installMocks(page)
    await signInSite(page, PLAIN_USER)

    await page.goto('/#/track/zlaya-nostalgia/makanochki')
    await page.getByTestId('track-copy-link').click()
    await expect(page.getByTestId('track-copy-link')).toContainText('Ссылка скопирована')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ORIGIN}/t/zlaya-nostalgia/makanochki/`)

    await page.goto('/#/release/zlaya-nostalgia')
    await page.getByTestId('release-copy-link').click()
    await expect(page.getByTestId('release-copy-link')).toContainText('Ссылка скопирована')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${ORIGIN}/r/zlaya-nostalgia/`)
})

test('«Поделиться» вызывает системное окно со ссылкой на страницу превью', async ({ page }) => {
    await page.addInitScript(() => {
        ;(window as unknown as { __shared: unknown[] }).__shared = []
        navigator.share = async (data) => void (window as unknown as { __shared: unknown[] }).__shared.push(data)
    })
    await installMocks(page)
    await signInSite(page, PLAIN_USER)
    await page.goto('/#/track/zlaya-nostalgia/makanochki')
    await page.getByTestId('track-share').click()
    const shared = (await page.evaluate(() => (window as unknown as { __shared: { url: string; title: string }[] }).__shared))[0]
    expect(shared.url).toBe(`${ORIGIN}/t/zlaya-nostalgia/makanochki/`)
    expect(shared.title).toContain('frnk ness')
})
