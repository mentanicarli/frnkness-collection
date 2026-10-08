import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_USERS, FIXTURE_UPLOADS, PLAIN_USER, SECOND_USER, installMocks, signInSite } from './mocks'
import { SocialBackend } from './socialMock'
import type { MockUser } from './accountsMock'

// Страница плейлиста: настройки за «⋯», обложка (своя и коллаж), общий принцип
// закрытия окон. Каталог — фикстура: шесть релизов с разными обложками.

test.describe.configure({ timeout: 60_000 })

const FOUR = ['most-venture-poopsicks/poopsicks', 'six-senses-pupsiks/still-ballin', 'boxik/boxik', 'faaa/faaa']
const MORE = ['born-to-be-deluxe/zal', 'zlaya-nostalgia/makanochki']

async function newSocial(): Promise<SocialBackend> {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    return social
}

async function openAs(browser: Browser, social: SocialBackend, user: MockUser, mobile = false): Promise<Page> {
    const context = await browser.newContext(
        mobile
            ? { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' }
            : { viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' }
    )
    const page = await context.newPage()
    await installMocks(page, { social })
    await signInSite(page, user)
    return page
}

async function seed(social: SocialBackend, tracks: string[], opts: { cover?: boolean; owner?: MockUser; isPublic?: boolean } = {}): Promise<string> {
    const owner = opts.owner ?? PLAIN_USER
    const [pl] = await social.sql<{ id: string }>(
        `insert into public.playlists (owner_id, title, is_public, cover_version) values ($1, 'Сборник', $2, $3) returning id`,
        [owner.id, opts.isPublic ?? false, opts.cover ? 7 : null]
    )
    for (const [i, t] of tracks.entries()) await social.sql(`insert into public.playlist_tracks (playlist_id, track_id, position) values ($1, $2, $3)`, [pl.id, t, i + 1])
    if (opts.cover) {
        await social.sql(`insert into storage.objects (bucket_id, name) values ('playlist-covers', $1)`, [`${owner.id}/${pl.id}`])
        social.covers.set(`${owner.id}/${pl.id}`, { body: fs.readFileSync(path.join(FIXTURE_UPLOADS, 'square.jpg')), type: 'image/jpeg' })
    }
    return pl.id
}

/** Дождаться конца анимации появления панели и вернуть её положение. */
async function settledBox(l: Locator): Promise<Box> {
    let prev = JSON.stringify(await boxOf(l))
    for (let i = 0; i < 40; i++) {
        await l.page().waitForTimeout(50)
        const cur = JSON.stringify(await boxOf(l))
        if (cur === prev) return JSON.parse(cur)
        prev = cur
    }
    return boxOf(l)
}

type Box = { x: number; y: number; width: number; height: number }
const boxOf = async (l: Locator): Promise<Box> => (await l.boundingBox())!
const near = (a: number, b: number, eps = 1.5) => Math.abs(a - b) <= eps

async function loaded(l: Locator): Promise<boolean[]> {
    return l.evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0))
}

// ── Обложка ─────────────────────────────────────────────────────────────

test('коллаж: 0 треков — заглушка; 1–3 релиза — одна обложка на весь квадрат; 4+ — сетка 2×2 без пустых клеток', async ({ browser }) => {
    const social = await newSocial()
    const id = await seed(social, [])
    const page = await openAs(browser, social, PLAIN_USER)
    const cover = page.locator('.pl-head-cover')

    await page.goto(`/#/playlist/${id}`)
    await expect(page.getByTestId('playlist-cover-empty')).toBeVisible()
    await expect(cover.locator('img')).toHaveCount(0)

    // 2 трека одного релиза и 3 разных релиза — по-прежнему одна картинка.
    for (const [tracks, expectCount] of [[['faaa/faaa'], 1], [FOUR.slice(0, 3), 1]] as const) {
        await social.sql(`delete from public.playlist_tracks`)
        for (const [i, t] of tracks.entries()) await social.sql(`insert into public.playlist_tracks (playlist_id, track_id, position) values ($1, $2, $3)`, [id, t, i + 1])
        await page.reload()
        await expect(page.getByTestId('track-row')).toHaveCount(tracks.length)
        const imgs = cover.locator('img')
        await expect(imgs).toHaveCount(expectCount)
        const c = await boxOf(cover)
        const i = await boxOf(imgs.first())
        expect(near(i.width, c.width) && near(i.height, c.height)).toBe(true)
        await expect.poll(() => loaded(imgs)).toEqual([true])
    }

    // Четыре разных релиза: четыре картинки, каждая — своя четверть, все загружены.
    await social.sql(`delete from public.playlist_tracks`)
    for (const [i, t] of FOUR.entries()) await social.sql(`insert into public.playlist_tracks (playlist_id, track_id, position) values ($1, $2, $3)`, [id, t, i + 1])
    await page.reload()
    const imgs = cover.locator('img')
    await expect(imgs).toHaveCount(4)
    await expect.poll(() => loaded(imgs)).toEqual([true, true, true, true])
    const c = await boxOf(cover)
    const cells = await Promise.all([0, 1, 2, 3].map((n) => boxOf(imgs.nth(n))))
    for (const [n, b] of cells.entries()) {
        expect(near(b.width, c.width / 2) && near(b.height, c.height / 2)).toBe(true)
        expect(near(b.x, c.x + (n % 2) * (c.width / 2)) && near(b.y, c.y + Math.floor(n / 2) * (c.height / 2))).toBe(true)
    }
    expect(new Set(await imgs.evaluateAll((l) => l.map((i) => (i as HTMLImageElement).currentSrc))).size).toBe(4)
})

test('своя обложка: на весь квадрат и не меняется при добавлении и удалении треков', async ({ browser }) => {
    const social = await newSocial()
    const id = await seed(social, FOUR.slice(0, 2), { cover: true })
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto(`/#/playlist/${id}`)

    const cover = page.locator('.pl-head-cover')
    const img = cover.locator('img')
    const fills = async () => {
        await expect(img).toHaveCount(1)
        await expect(img).toHaveAttribute('data-testid', 'playlist-cover-img')
        const c = await boxOf(cover)
        const i = await boxOf(img)
        expect(near(i.width, c.width) && near(i.height, c.height) && near(i.x, c.x) && near(i.y, c.y)).toBe(true)
        expect(await cover.evaluate((el) => el.classList.contains('grid'))).toBe(false)
        expect(await img.evaluate((i) => getComputedStyle(i).objectFit)).toBe('cover')
    }
    await fills()
    const src = await img.getAttribute('src')

    // Добавляем треки до четырёх+ разных релизов через окно «Добавить треки».
    await page.getByTestId('playlist-add-tracks').click()
    const search = page.getByTestId('playlist-picker-search')
    for (const q of ['боксик', 'faaa', 'zal', 'Маканочки']) {
        await search.fill(q)
        await page.getByTestId('playlist-picker-row').first().click()
        await expect(page.locator('[data-testid="playlist-picker-row"][data-added="true"]').first()).toBeVisible()
    }
    await page.getByTestId('playlist-picker-done').click()
    await expect(page.getByTestId('track-row')).toHaveCount(6)
    await fills()
    expect(await img.getAttribute('src')).toBe(src)

    // Убираем треки.
    for (let n = 0; n < 4; n++) await page.getByTestId('track-row').last().getByRole('button', { name: 'Убрать из плейлиста' }).click()
    await expect(page.getByTestId('track-row')).toHaveCount(2)
    await fills()

    // Тот же плейлист в списке «Мои плейлисты».
    await page.goto('/#/playlists')
    const card = page.getByTestId('playlist-card').first().locator('.pl-cover')
    await expect(card.locator('img')).toHaveCount(1)
    await expect(card.locator('img')).toHaveAttribute('data-testid', 'playlist-cover-img')
})

// ── Настройки за «⋯» ────────────────────────────────────────────────────

test('настройки плейлиста спрятаны за «⋯»; у чужого плейлиста кнопки нет', async ({ browser }) => {
    const social = await newSocial()
    const id = await seed(social, FOUR, { isPublic: true })
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto(`/#/playlist/${id}`)

    await expect(page.getByTestId('playlist-settings-dialog')).toHaveCount(0)
    await expect(page.getByLabel('Название', { exact: true })).toHaveCount(0)
    await page.getByTestId('playlist-settings').click()
    const dialog = page.getByRole('dialog', { name: 'Настройки плейлиста' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue('Сборник')
    await expect(dialog.getByTestId('playlist-public')).toBeChecked()
    await expect(dialog.getByText('Своя картинка…')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Удалить плейлист' })).toBeVisible()

    // Переименование из окна.
    await dialog.getByLabel('Название', { exact: true }).fill('Новое имя')
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByTestId('playlist-title')).toHaveText('Новое имя')

    const other = await openAs(browser, social, SECOND_USER)
    await other.goto(`/#/playlist/${id}`)
    await expect(other.getByTestId('playlist-title')).toHaveText('Новое имя')
    await expect(other.getByTestId('playlist-settings')).toHaveCount(0)
    await expect(other.getByTestId('playlist-add-tracks')).toHaveCount(0)
})

// ── Закрытие окон: фон, крестик, Esc, свайп ─────────────────────────────

async function clickBackdrop(page: Page) {
    const backdrop = page.getByTestId('modal-backdrop')
    const b = await boxOf(backdrop)
    await page.mouse.click(b.x + 4, b.y + 4)
}

for (const [name, openIt, dialogName] of [
    ['настройки плейлиста', async (p: Page) => p.getByTestId('playlist-settings').click(), 'Настройки плейлиста'],
    ['«Добавить треки»', async (p: Page) => p.getByTestId('playlist-add-tracks').click(), 'Добавить треки']
] as const) {
    test(`${name}: закрывается фоном, крестиком и Esc`, async ({ browser }) => {
        const social = await newSocial()
        const id = await seed(social, FOUR)
        const page = await openAs(browser, social, PLAIN_USER)
        await page.goto(`/#/playlist/${id}`)
        const dialog = page.getByRole('dialog', { name: dialogName })

        await openIt(page)
        await expect(dialog).toBeVisible()
        // Нажатие внутри окна не закрывает.
        await dialog.click({ position: { x: 20, y: 60 } })
        await expect(dialog).toBeVisible()
        await clickBackdrop(page)
        await expect(dialog).toHaveCount(0)

        await openIt(page)
        await dialog.getByTestId('modal-x').click()
        await expect(dialog).toHaveCount(0)

        await openIt(page)
        await page.keyboard.press('Escape')
        await expect(dialog).toHaveCount(0)
    })
}

test('телефон: нижняя панель закрывается свайпом вниз, короткий свайп и прокрутка списка — нет', async ({ browser }) => {
    const social = await newSocial()
    const id = await seed(social, FOUR)
    const page = await openAs(browser, social, PLAIN_USER, true)
    await page.goto(`/#/playlist/${id}`)
    const cdp = await page.context().newCDPSession(page)

    async function swipe(from: { x: number; y: number }, dy: number, steps = 8) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
        for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + (dy * i) / steps }] })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }

    await page.getByTestId('playlist-settings').tap()
    const dialog = page.getByRole('dialog', { name: 'Настройки плейлиста' })
    await expect(dialog).toBeVisible()
    // Панель прижата к низу экрана.
    const box = await settledBox(dialog)
    expect(near(box.y + box.height, 780, 2)).toBe(true)

    await swipe({ x: 195, y: box.y + 14 }, 25)
    await expect(dialog).toBeVisible()
    expect(near((await settledBox(dialog)).y, box.y, 2)).toBe(true)

    await swipe({ x: 195, y: box.y + 14 }, 220)
    await expect(dialog).toHaveCount(0)

    // «Добавить треки»: свайп по прокручиваемому списку не закрывает панель.
    await page.getByTestId('playlist-add-tracks').tap()
    const picker = page.getByRole('dialog', { name: 'Добавить треки' })
    await expect(picker).toBeVisible()
    await settledBox(picker)
    const list = page.locator('.pick-list')
    await list.evaluate((el) => { el.scrollTop = 40 })
    const lb = await boxOf(list)
    await swipe({ x: 195, y: lb.y + 30 }, 200)
    await expect(picker).toBeVisible()
    await swipe({ x: 195, y: (await settledBox(picker)).y + 14 }, 240)
    await expect(picker).toHaveCount(0)
})

// ── Остальные окна сайта — тот же принцип ───────────────────────────────

test('все окна сайта закрываются фоном, крестиком и Esc', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto('/#/release/most-venture-poopsicks')
    await expect(page.getByTestId('user-menu')).toBeVisible()

    async function checkDismiss(open: () => Promise<void>, dialog: Locator) {
        for (const how of ['backdrop', 'x', 'esc'] as const) {
            await open()
            await expect(dialog).toBeVisible()
            if (how === 'backdrop') await clickBackdrop(page)
            else if (how === 'x') await dialog.getByTestId('modal-x').click()
            else await page.keyboard.press('Escape')
            await expect(dialog).toHaveCount(0)
        }
    }

    const menu = () => page.getByTestId('user-menu').click()
    await checkDismiss(async () => { await menu(); await page.getByTestId('menu-logout').click() }, page.getByTestId('logout-confirm'))
    await checkDismiss(async () => { await menu(); await page.getByTestId('menu-feedback').click() }, page.getByTestId('feedback-dialog'))
    await checkDismiss(async () => { await menu(); await page.getByTestId('menu-create-room').click() }, page.getByTestId('create-room'))

    const row = page.locator('.track-row').first()
    await checkDismiss(async () => { await row.hover(); await row.getByTestId('add-to-playlist-btn').click() }, page.getByTestId('add-to-playlist'))

    // Топ-4 в своём профиле.
    await page.goto(`/#/u/${encodeURIComponent(PLAIN_USER.nick)}`)
    await checkDismiss(() => page.getByTestId('top4-edit').click(), page.getByTestId('top4-editor'))
})

test('телефон: меню трека «⋯» закрывается фоном, крестиком, Esc и свайпом вниз', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER, true)
    await page.goto('/#/release/most-venture-poopsicks')
    const cdp = await page.context().newCDPSession(page)
    const more = page.getByTestId('track-more').first()
    const sheet = page.getByTestId('track-sheet')

    await more.tap()
    await expect(sheet).toBeVisible()
    await clickBackdrop(page)
    await expect(sheet).toHaveCount(0)

    await more.tap()
    await sheet.getByTestId('modal-x').tap()
    await expect(sheet).toHaveCount(0)

    await more.tap()
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)

    await more.tap()
    const b = await settledBox(sheet)
    const from = { x: 195, y: b.y + 12 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + 30 * i }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(sheet).toHaveCount(0)
})
