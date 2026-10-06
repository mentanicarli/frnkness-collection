import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { ADMIN_USER, FIXTURE_UPLOADS, installMocks, loginAs, repoFile, signInSite, type ContentCall } from './mocks'

const COVER = { name: 'announce.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(FIXTURE_UPLOADS, 'square.jpg')) }
// «Сейчас» в браузере — 2 октября 2026, 12:00 МСК.
const NOW = new Date('2026-10-02T09:00:00Z')

const EXISTING = {
    enabled: true,
    title: 'Тестовый анонс',
    cover: 'images/album3-cover.jpg',
    releaseAt: '2026-10-05T18:30:00+03:00',
    text: 'Пресейв открыт',
    url: 'https://example.com/presave'
}

async function openPromo(page: Page, announce?: object) {
    await page.clock.install({ time: NOW })
    // До первого коммита «репозиторий» отдаёт site.json с этим анонсом,
    // после — то, что закоммитили (как GitHub). Иначе фоновая перезагрузка
    // после сохранения возвращала бы прежний site.json.
    let committed = false
    const mocks = await installMocks(page, {
        content: (call: ContentCall) => {
            if (call.action === 'read' && announce && !committed && (call.body.paths as string[]).includes('src/content/site.json')) {
                const site = { promo: { enabled: true, releaseId: 'zlaya-nostalgia' }, announce }
                const files: Record<string, string | null> = {}
                for (const p of call.body.paths as string[]) files[p] = p === 'src/content/site.json' ? JSON.stringify(site, null, 4) + '\n' : null
                if ((call.body.paths as string[]).includes('src/content/releases.json')) {
                    files['src/content/releases.json'] = repoFile('src/content/releases.json')
                }
                return { body: { files } }
            }
            if (call.action === 'stage-blob') return { body: { sha: 'e'.repeat(40), path: call.body.path, size: 10, token: 't'.repeat(64) } }
            if (call.action === 'commit') {
                committed = true
                return { body: { sha: '8'.repeat(40), url: 'u', message: call.body.message } }
            }
            return undefined
        }
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    return mocks
}

test('создать анонс: превью с живым отсчётом, сохранение site.json и обложки одним коммитом', async ({ page }) => {
    const mocks = await openPromo(page)
    await page.goto('/admin.html#/promo')
    await page.getByRole('button', { name: 'Создать анонс' }).click()
    await page.getByRole('textbox', { name: 'Название анонса' }).fill('Новый альбом')
    await page.getByLabel('Время выхода').fill('2026-10-03T18:00')
    await expect(page.getByText('В site.json: 2026-10-03T18:00:00+03:00')).toBeVisible()
    await page.getByLabel('Обложка анонса').setInputFiles(COVER)
    await page.getByRole('textbox', { name: 'Текст анонса' }).fill('Пресейв уже открыт')

    // Превью: анонс над последним релизом, отсчёт до 3 октября 18:00 МСК.
    // Часы останавливаем на 12:10 МСК, чтобы сверять точные цифры.
    await page.clock.pauseAt(new Date('2026-10-02T09:10:00Z'))
    const preview = page.getByTestId('announce-preview')
    await expect(preview.locator('.announce-countdown')).toHaveText('1 дн. 05:50:00')
    await expect(preview.locator('.announce-when')).toHaveText('Выйдет 3 октября в 18:00 по Москве')
    await page.clock.runFor(2000)
    await expect(preview.locator('.announce-countdown')).toHaveText('1 дн. 05:49:58')
    await page.clock.resume()
    const order = await page.locator('.adm-promo-preview .promo-release-card').evaluateAll((els) => els.map((e) => e.classList.contains('announce-card')))
    expect(order).toEqual([true, false])

    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-message')).toHaveText('admin: анонс «Новый альбом»')
    await expect(dialog.getByTestId('commit-files')).toContainText('images/announce-novy-albom-20261002.jpg')
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)

    const files = mocks.calls.find((c) => c.action === 'commit')!.body.files as { path: string; content?: string; blob?: object }[]
    expect(files.map((f) => f.path)).toEqual(['src/content/site.json', 'images/announce-novy-albom-20261002.jpg'])
    expect(JSON.parse(files[0].content!)).toEqual({
        promo: { enabled: true, releaseId: 'zlaya-nostalgia' },
        announce: {
            enabled: true,
            title: 'Новый альбом',
            cover: 'images/announce-novy-albom-20261002.jpg',
            releaseAt: '2026-10-03T18:00:00+03:00',
            text: 'Пресейв уже открыт'
        }
    })
})

test('анонс без даты: превью «Скоро» без таймера, в site.json нет releaseAt', async ({ page }) => {
    const mocks = await openPromo(page)
    await page.goto('/admin.html#/promo')
    await page.getByRole('button', { name: 'Создать анонс' }).click()
    await page.getByRole('textbox', { name: 'Название анонса' }).fill('Новый альбом')
    await page.getByLabel('Обложка анонса').setInputFiles(COVER)
    await expect(page.getByTestId('announce-no-date')).toBeVisible()
    const preview = page.getByTestId('announce-preview')
    await expect(preview.locator('.announce-countdown')).toHaveText('Скоро')
    await expect(preview.locator('[role="timer"]')).toHaveCount(0)
    await expect(preview.locator('.announce-when')).toHaveCount(0)
    await expect(page.getByTestId('promo-errors')).toHaveCount(0)

    // Дату можно поставить и снова убрать.
    await page.getByLabel('Время выхода').fill('2026-10-03T18:00')
    await expect(preview.locator('[role="timer"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Без даты' }).click()
    await expect(preview.locator('.announce-countdown')).toHaveText('Скоро')

    await page.getByRole('button', { name: 'Сохранить…' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const files = mocks.calls.find((c) => c.action === 'commit')!.body.files as { path: string; content?: string }[]
    expect(JSON.parse(files[0].content!).announce).toEqual({
        enabled: true,
        title: 'Новый альбом',
        cover: 'images/announce-novy-albom-20261002.jpg'
    })
})

test('анонс без даты не истекает — подсказки нет', async ({ page }) => {
    const { releaseAt: _r, ...noDate } = EXISTING
    await openPromo(page, noDate)
    await page.goto('/admin.html#/promo')
    await expect(page.getByRole('textbox', { name: 'Название анонса' })).toHaveValue('Тестовый анонс')
    await expect(page.getByLabel('Время выхода')).toHaveValue('')
    await expect(page.getByTestId('announce-preview').locator('.announce-countdown')).toHaveText('Скоро')
    await expect(page.getByTestId('announce-expired')).toHaveCount(0)
    await expect(page.getByText('Изменений нет')).toBeVisible()
})

test('время выхода в прошлом — сохранить нельзя', async ({ page }) => {
    await openPromo(page)
    await page.goto('/admin.html#/promo')
    await page.getByRole('button', { name: 'Создать анонс' }).click()
    await page.getByRole('textbox', { name: 'Название анонса' }).fill('Поздно')
    await page.getByLabel('Время выхода').fill('2026-10-01T18:00')
    await page.getByLabel('Обложка анонса').setInputFiles(COVER)
    await expect(page.getByTestId('promo-errors')).toContainText('Время выхода уже прошло')
    await expect(page.getByRole('button', { name: 'Сохранить…' })).toBeDisabled()
})

test('удалить анонс — обложка удаляется тем же коммитом', async ({ page }) => {
    const mocks = await openPromo(page, EXISTING)
    await page.goto('/admin.html#/promo')
    await expect(page.getByRole('textbox', { name: 'Название анонса' })).toHaveValue('Тестовый анонс')
    await page.getByRole('button', { name: 'Удалить анонс' }).click()
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-message')).toHaveText('admin: анонс удалён')
    await expect(dialog.getByTestId('commit-files')).toContainText('удалён')
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)
    const files = mocks.calls.find((c) => c.action === 'commit')!.body.files as { path: string; content?: string; delete?: boolean }[]
    expect(files.find((f) => f.delete)?.path).toBe('images/album3-cover.jpg')
    expect(JSON.parse(files[0].content!)).toEqual({ promo: { enabled: true, releaseId: 'zlaya-nostalgia' } })
})

test('анонс истёк — подсказка на «Промо» и «Обзоре»', async ({ page }) => {
    await openPromo(page, { ...EXISTING, releaseAt: '2026-10-01T18:00:00+03:00' })
    await expect(page.getByTestId('announce-expired')).toContainText('Анонс истёк — добавьте релиз и выключите анонс')
    await page.goto('/admin.html#/promo')
    await expect(page.getByTestId('announce-expired')).toContainText('Анонс истёк — добавьте релиз и выключите анонс')
    await expect(page.getByTestId('announce-hidden')).toContainText('время выхода прошло')
    // Выключить анонс — подсказка уходит после сохранения.
    await page.getByRole('checkbox', { name: 'Показывать анонс на главной' }).uncheck()
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    await expect(page.getByRole('dialog').getByTestId('commit-message')).toHaveText('admin: анонс «Тестовый анонс» выключен')
    await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByTestId('announce-expired')).toHaveCount(0)
})

// ── Основной сайт ───────────────────────────────────────────────────

async function openSiteWithAnnounce(page: Page, announce: object | null, promoEnabled = true) {
    await page.clock.install({ time: NOW })
    await installMocks(page)
    await signInSite(page)
    // Dev-сервер отдаёт site.json как JS-модуль — подменяем его для теста.
    await page.route(/\/src\/content\/site\.json/, (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `export default ${JSON.stringify({ promo: { enabled: promoEnabled, releaseId: 'zlaya-nostalgia' }, ...(announce ? { announce } : {}) })}`
        })
    )
    await page.goto('/#/')
}

test('главная: анонс первым, под ним последний релиз, живой отсчёт', async ({ page }) => {
    await openSiteWithAnnounce(page, EXISTING)
    const cards = page.locator('#home-promo .promo-release-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toHaveClass(/announce-card/)
    await expect(cards.nth(0).locator('.promo-title')).toHaveText('Тестовый анонс')
    // Часы в тесте идут: допускаем несколько секунд от 12:00 МСК.
    const countdown = cards.nth(0).locator('.announce-countdown')
    await expect(countdown).toHaveText(/^3 дн\. 06:(30:00|29:[45]\d)$/)
    await expect(cards.nth(0).getByRole('link', { name: 'Подробнее' })).toHaveAttribute('href', 'https://example.com/presave')
    await expect(cards.nth(1).locator('.promo-title')).toHaveText('Злая Ностальгия')
    const before = await countdown.textContent()
    await page.clock.runFor(5000)
    await expect(countdown).not.toHaveText(before!)
    await expect(countdown).toHaveText(/^3 дн\. 06:29:\d\d$/)
})

test('главная: когда время вышло, анонс исчезает сам', async ({ page }) => {
    // Запас 20 с: часы в тесте идут, загрузка под нагрузкой бывает долгой.
    await openSiteWithAnnounce(page, { ...EXISTING, releaseAt: '2026-10-02T12:00:20+03:00' })
    const announce = page.locator('#home-promo .announce-card')
    await expect(announce.locator('.announce-countdown')).toHaveText(/^0 дн\. 00:00:\d\d$/)
    await page.clock.runFor(25_000)
    await expect(announce).toHaveCount(0)
    await expect(page.locator('#home-promo .promo-release-card')).toHaveCount(1)
})

test('главная: истёкший анонс не показывается вовсе', async ({ page }) => {
    await openSiteWithAnnounce(page, { ...EXISTING, releaseAt: '2026-10-01T12:00:00+03:00' })
    await expect(page.locator('#home-promo .promo-release-card')).toHaveCount(1)
    await expect(page.locator('#home-promo .announce-card')).toHaveCount(0)
})

test('главная: анонс без даты — «Скоро» без таймера и не исчезает', async ({ page }) => {
    const { releaseAt: _r, ...noDate } = EXISTING
    await openSiteWithAnnounce(page, noDate)
    const announce = page.locator('#home-promo .announce-card')
    await expect(announce.locator('.announce-countdown')).toHaveText('Скоро')
    await expect(announce.locator('[role="timer"]')).toHaveCount(0)
    await expect(announce.locator('.promo-title')).toHaveText('Тестовый анонс')
    await page.clock.runFor(60_000)
    await expect(announce).toHaveCount(1)
    await expect(page.locator('#home-promo .promo-release-card')).toHaveCount(2)
})

test('главная: только анонс, если последний релиз выключен', async ({ page }) => {
    await openSiteWithAnnounce(page, EXISTING, false)
    await expect(page.locator('#home-promo .announce-card')).toHaveCount(1)
    await expect(page.locator('#home-promo .promo-release-card')).toHaveCount(1)
})
