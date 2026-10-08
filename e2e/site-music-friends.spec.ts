import { test, expect, type Browser, type Page } from '@playwright/test'
import path from 'node:path'
import { ADMIN_USER, DEFAULT_USERS, FIXTURE_UPLOADS, PLAIN_USER, SECOND_USER, installMocks, loginAs, signInSite } from './mocks'
import { SocialBackend } from './socialMock'
import type { MockUser } from './accountsMock'

// «Музыка и друзья»: RPC выполняются настоящими SQL-функциями миграции на
// PGlite (e2e/socialMock.ts) — права, лимиты и видимость те же, что в проде.

test.describe.configure({ timeout: 60_000 })

async function newSocial(): Promise<SocialBackend> {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    return social
}

async function openAs(browser: Browser, social: SocialBackend, user: MockUser): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    await installMocks(page, { social })
    await signInSite(page, user)
    return page
}

const miniTitle = (page: Page) => page.locator('#player-track')
const row = (page: Page, title: string) => page.getByTestId('track-row').filter({ hasText: title })

test('избранное: сердечко в треклисте и плеере, страница «Избранное», воспроизведение', async ({ page }) => {
    const social = await newSocial()
    const mocks = await installMocks(page, { social })
    await signInSite(page)
    await page.goto('/#/release/most-venture-poopsicks')

    const releaseRow = page.locator('.track-row').filter({ hasText: 'BACK TO POOPSICKS 2' })
    const heart = releaseRow.getByTestId('favorite-btn')
    await heart.click()
    // Отклик сразу, без перезагрузки.
    await expect(heart).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => social.sql(`select track_id from public.favorites where user_id = '${PLAIN_USER.id}'`)).toEqual([{ track_id: 'most-venture-poopsicks/back-to-poopsicks-2' }])
    await page.locator('.track-row').filter({ hasText: 'Macan-Walker' }).getByTestId('favorite-btn').click()

    await page.getByTestId('user-menu').click()
    await page.getByRole('menuitem', { name: 'Избранное' }).click()
    await expect(page).toHaveURL(/#\/favorites$/)
    // Новые сверху.
    await expect(page.getByTestId('track-row')).toHaveText([/Macan-Walker/, /BACK TO POOPSICKS 2/])

    await page.getByRole('button', { name: 'Слушать' }).click()
    await expect(miniTitle(page)).toHaveText('Macan-Walker')
    const miniHeart = page.locator('#player').getByTestId('favorite-btn')
    await expect(miniHeart).toHaveAttribute('aria-pressed', 'true')
    await page.locator('#player').getByRole('button', { name: 'Следующий трек' }).click()
    await expect(miniTitle(page)).toHaveText('BACK TO POOPSICKS 2')

    // Убрать в мини-плеере — исчезает со страницы сразу.
    await miniHeart.click()
    await expect(miniHeart).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('track-row')).toHaveText([/Macan-Walker/])

    // Полноэкранный плеер: сердечко и перемешивание.
    await page.locator('#player-cover').hover()
    await page.getByRole('button', { name: 'Открыть на весь экран' }).click()
    const fs = page.locator('#fullscreen-player')
    await expect(fs.getByTestId('favorite-btn')).toHaveAttribute('aria-pressed', 'false')
    await fs.getByTestId('favorite-btn').click()
    await expect(row(page, 'BACK TO POOPSICKS 2')).toHaveCount(1)
    await expect(fs.getByText('Избранное', { exact: true })).toBeVisible()
    await fs.getByTestId('shuffle-btn').click()
    await expect(fs.getByTestId('shuffle-btn')).toHaveAttribute('aria-pressed', 'true')
    expect(mocks.unexpected).toEqual([])
})

test('недоступный трек в избранном: виден как «недоступен», очередь его пропускает', async ({ page }) => {
    const social = await newSocial()
    await social.sql(`insert into public.favorites (user_id, track_id, created_at) values
        ($1, 'faaa/faaa', now() - interval '1 minute'),
        ($1, 'gone-release/old-track', now() - interval '2 minutes'),
        ($1, 'boxik/boxik', now() - interval '3 minutes')`, [PLAIN_USER.id])
    await installMocks(page, { social })
    await signInSite(page)
    await page.goto('/#/favorites')
    await expect(page.getByTestId('track-row')).toHaveCount(3)
    await expect(page.getByTestId('track-row').nth(1)).toContainText('Трек недоступен')
    await expect(page.getByTestId('track-row').nth(1).getByRole('button', { name: /Трек недоступен/ })).toBeDisabled()
    await page.getByRole('button', { name: 'Слушать' }).click()
    await expect(miniTitle(page)).toHaveText('FAAA')
    await page.locator('#player').getByRole('button', { name: 'Следующий трек' }).click()
    await expect(miniTitle(page)).toHaveText('какой тебе боксик?')
})

test('плейлист: создать, добавить из треклиста, переставить, обложка, воспроизведение', async ({ page }) => {
    const social = await newSocial()
    const mocks = await installMocks(page, { social })
    await signInSite(page)

    await page.goto('/#/playlists')
    await page.getByLabel('Название нового плейлиста').fill('Дорога <b>домой</b>')
    await page.getByRole('button', { name: 'Создать' }).click()
    await expect(page).toHaveURL(/#\/playlist\/[0-9a-f-]{36}$/)
    // Текст пользователя — только текстом, без HTML.
    await expect(page.getByTestId('playlist-title')).toHaveText('Дорога <b>домой</b>')
    await expect(page.locator('[data-testid="playlist-title"] b')).toHaveCount(0)
    const playlistUrl = page.url()

    // «+ в плейлист» из треклиста двух релизов.
    for (const [release, title] of [['zlaya-nostalgia', 'Маканочки'], ['faaa', 'FAAA'], ['zlaya-nostalgia', 'Бильярд']] as const) {
        await page.goto(`/#/release/${release}`)
        await page.locator('.track-row').filter({ hasText: title }).hover()
        await page.locator('.track-row').filter({ hasText: title }).getByTestId('add-to-playlist-btn').click()
        const dialog = page.getByTestId('add-to-playlist')
        await dialog.getByRole('button', { name: /Дорога/ }).click()
        await expect(page.getByTestId('notice')).toContainText('Добавлено в «Дорога <b>домой</b>»')
        await expect(dialog).toHaveCount(0)
    }
    // Повторно тот же трек — сервер не даёт дубль.
    await page.locator('.track-row').filter({ hasText: 'Бильярд' }).getByTestId('add-to-playlist-btn').click()
    await page.getByTestId('add-to-playlist').getByRole('button', { name: /Дорога/ }).click()
    await expect(page.getByTestId('notice')).toHaveText('Трек уже в плейлисте')
    await page.getByTestId('add-to-playlist').getByRole('button', { name: 'Закрыть' }).click()

    await page.goto(playlistUrl)
    await expect(page.getByTestId('track-row')).toHaveText([/Маканочки/, /FAAA/, /Бильярд/])
    // Коллаж по умолчанию: одна обложка (разных меньше четырёх).
    await expect(page.locator('.pl-head-cover [data-testid="playlist-collage-img"]')).toHaveCount(1)

    // Кнопки (телефон) и перетаскивание (компьютер).
    await row(page, 'Бильярд').getByRole('button', { name: 'Выше' }).click()
    await expect(page.getByTestId('track-row')).toHaveText([/Маканочки/, /Бильярд/, /FAAA/])
    await row(page, 'FAAA').dragTo(row(page, 'Маканочки'))
    await expect(page.getByTestId('track-row')).toHaveText([/FAAA/, /Маканочки/, /Бильярд/])
    await page.reload()
    await expect(page.getByTestId('track-row')).toHaveText([/FAAA/, /Маканочки/, /Бильярд/])

    // Воспроизведение плейлиста: треки разных релизов подряд.
    await page.getByTestId('playlist-play').click()
    await expect(miniTitle(page)).toHaveText('FAAA')
    await page.locator('#player').getByRole('button', { name: 'Следующий трек' }).click()
    await expect(miniTitle(page)).toHaveText('Маканочки')
    await page.locator('#player').getByRole('button', { name: 'Следующий трек' }).click()
    await expect(miniTitle(page)).toHaveText('Бильярд')

    // Своя обложка: обрезка, 512×512, файл <владелец>/<плейлист>.
    const playlistId = playlistUrl.split('/').pop()!
    await page.getByTestId('playlist-cover-file').setInputFiles(path.join(FIXTURE_UPLOADS, 'tall.jpg'))
    const cropper = page.getByRole('dialog', { name: 'Обрезка обложки' })
    await cropper.getByRole('button', { name: 'Сохранить' }).click()
    await expect(cropper).toHaveCount(0)
    expect(mocks.coverUploads.map((u) => u.name)).toEqual([`${PLAIN_USER.id}/${playlistId}`])
    expect(['image/webp', 'image/jpeg']).toContain(mocks.coverUploads[0].contentType)
    const cover = page.locator('.pl-head-cover [data-testid="playlist-cover-img"]')
    await expect(cover).toHaveAttribute('src', /\/object\/sign\/playlist-covers\//)
    await expect.poll(() => cover.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([512, 512])

    // Замена перезаписывает тот же файл; «Вернуть коллаж» удаляет его.
    await page.getByTestId('playlist-cover-file').setInputFiles(path.join(FIXTURE_UPLOADS, 'square.jpg'))
    await page.getByRole('dialog', { name: 'Обрезка обложки' }).getByRole('button', { name: 'Сохранить' }).click()
    await expect.poll(() => social.covers.size).toBe(1)
    await page.getByRole('button', { name: 'Вернуть коллаж' }).click()
    await expect(page.locator('.pl-head-cover [data-testid="playlist-collage-img"]')).toHaveCount(1)
    await expect.poll(() => social.covers.size).toBe(0)

    // Удаление трека и плейлиста.
    await row(page, 'Маканочки').getByRole('button', { name: 'Убрать из плейлиста' }).click()
    await expect(page.getByTestId('track-row')).toHaveText([/FAAA/, /Бильярд/])
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Удалить плейлист' }).click()
    await expect(page).toHaveURL(/#\/playlists$/)
    await expect.poll(() => social.sql('select count(*)::int n from public.playlists')).toEqual([{ n: 0 }])
    expect(mocks.unexpected).toEqual([])
})

test('друзья: заявка, индикатор, принятие (двумя пользователями), страница друга', async ({ browser }) => {
    const social = await newSocial()
    await social.sql(`insert into public.favorites (user_id, track_id) values ($1, 'faaa/faaa')`, [SECOND_USER.id])
    await social.sql(`insert into public.play_events (track_key, user_id) values ('boxik-0', $1), ('boxik-0', $1), ('faaa-0', $1)`, [SECOND_USER.id])
    const a = await openAs(browser, social, PLAIN_USER)
    const b = await openAs(browser, social, SECOND_USER)

    // До дружбы: профиль открыт, закрытое — нет.
    await a.goto(`/#/u/${encodeURIComponent('второй')}`)
    await expect(a).toHaveURL(new RegExp(`#/u/${encodeURIComponent('Второй')}$`))
    await expect(a.getByTestId('friends-count')).toHaveText('0 друзей')
    await expect(a.getByText('видят только друзья')).toBeVisible()
    await expect(a.getByRole('heading', { name: 'Избранное' })).toHaveCount(0)

    // Поиск по нику и заявка.
    await a.goto('/#/friends')
    await a.getByTestId('friend-search').fill('ВТОР')
    await a.getByTestId('user-row').filter({ hasText: 'Второй' }).getByRole('button', { name: 'Добавить в друзья' }).click()
    await expect(a.getByTestId('notice')).toHaveText('Заявка отправлена')
    await expect(a.getByText('Отправленные заявки')).toBeVisible()

    // Индикатор у второго — после загрузки страницы.
    await b.goto('/#/')
    await expect(b.getByTestId('friend-requests-badge')).toHaveText('1')
    await b.getByTestId('user-menu').click()
    await b.getByRole('menuitem', { name: /Друзья/ }).click()
    await expect(b.getByTestId('incoming-count')).toHaveText('1')
    await b.getByTestId('user-row').filter({ hasText: PLAIN_USER.nick }).getByRole('button', { name: 'Принять' }).click()
    await expect(b.getByTestId('notice')).toHaveText('Теперь вы друзья')
    await expect(b.getByTestId('friend-requests-badge')).toHaveCount(0)

    // Второй слушает трек — первый видит это на странице друга.
    await b.goto('/#/release/boxik')
    await b.locator('.track-row').first().click()
    await expect(miniTitle(b)).toHaveText('какой тебе боксик?')
    await expect.poll(() => social.nowPlayingCalls).toContain('boxik/boxik')

    await a.goto(`/#/u/${encodeURIComponent('Второй')}`)
    await expect(a.getByTestId('friends-count')).toHaveText('1 друг')
    await expect(a.getByTestId('now-playing')).toContainText('какой тебе боксик?')
    await expect(a.getByRole('heading', { name: 'Избранное' })).toBeVisible()
    await expect(a.getByRole('list', { name: 'Избранное' }).getByTestId('track-row')).toHaveText([/FAAA/])
    await expect(a.getByRole('list', { name: 'Топ' }).getByTestId('track-row')).toHaveText([/какой тебе боксик\?.*2 прослушивания/, /FAAA.*1 прослушивание/])
    await a.getByRole('tab', { name: 'Всё время' }).click()
    await expect(a.getByRole('list', { name: 'Топ' }).getByTestId('track-row')).toHaveCount(2)

    // Поток по избранному друга.
    await a.getByRole('button', { name: 'Поток по избранному' }).click()
    await expect(miniTitle(a)).toHaveText('FAAA')

    // Удаление из друзей — закрытое снова скрыто.
    a.once('dialog', (d) => void d.accept())
    await a.getByRole('button', { name: 'Удалить из друзей' }).click()
    await expect(a.getByText('видят только друзья')).toBeVisible()
    await a.context().close()
    await b.context().close()
})

test('мой топ: заглушка, пока прослушиваний нет', async ({ page }) => {
    const social = await newSocial()
    await installMocks(page, { social })
    await signInSite(page)
    await page.goto(`/#/u/${encodeURIComponent(PLAIN_USER.nick)}`)
    // «Мой топ» (по прослушиваниям) — не путать с «Мой топ-4» (выбор самого человека).
    await expect(page.getByRole('heading', { name: 'Мой топ', exact: true })).toBeVisible()
    await expect(page.getByTestId('top-empty')).toContainText('после 10 секунд')
})

test('публичный плейлист виден всем вошедшим, приватный — нет', async ({ browser }) => {
    const social = await newSocial()
    const [pub] = await social.sql<{ id: string }>(`insert into public.playlists (owner_id, title, is_public) values ($1, 'Открытый', true) returning id`, [SECOND_USER.id])
    const [priv] = await social.sql<{ id: string }>(`insert into public.playlists (owner_id, title) values ($1, 'Закрытый') returning id`, [SECOND_USER.id])
    await social.sql(`insert into public.playlist_tracks (playlist_id, track_id, position) values ($1, 'faaa/faaa', 1)`, [pub.id])
    const a = await openAs(browser, social, PLAIN_USER)
    await a.goto(`/#/u/${encodeURIComponent('Второй')}`)
    await expect(a.getByTestId('playlist-card')).toHaveText([/Открытый/])
    await a.goto(`/#/playlist/${pub.id}`)
    await expect(a.getByTestId('playlist-title')).toHaveText('Открытый')
    // Чужой плейлист — без правки.
    await expect(a.getByRole('button', { name: 'Удалить плейлист' })).toHaveCount(0)
    await a.goto(`/#/playlist/${priv.id}`)
    await expect(a.getByText('Плейлист не найден или скрыт владельцем.')).toBeVisible()
    await a.context().close()
})

test('админка: плейлисты в карточке, переименовать, удалить обложку и плейлист', async ({ page }) => {
    const social = await newSocial()
    const [pl] = await social.sql<{ id: string }>(`insert into public.playlists (owner_id, title, cover_version) values ($1, 'Плохое название', 5) returning id`, [PLAIN_USER.id])
    await social.sql(`insert into public.playlist_tracks (playlist_id, track_id, position) values ($1, 'faaa/faaa', 1)`, [pl.id])
    await social.sql(`insert into public.favorites (user_id, track_id) values ($1, 'boxik/boxik')`, [PLAIN_USER.id])
    await social.sql(`insert into storage.objects (bucket_id, name) values ('playlist-covers', $1)`, [`${PLAIN_USER.id}/${pl.id}`])
    social.covers.set(`${PLAIN_USER.id}/${pl.id}`, { body: Buffer.from('x'), type: 'image/webp' })
    const mocks = await installMocks(page, { social })
    await loginAs(page, ADMIN_USER)
    await page.goto('/admin.html#/users')
    await page.getByTestId(`user-row-${PLAIN_USER.nick}`).click()

    const card = page.getByTestId('user-social')
    await expect(card).toContainText('Избранное · 1')
    const item = card.getByTestId('admin-playlist')
    await expect(item).toContainText('Плохое название')
    await expect(item).toContainText('своя обложка')

    await item.getByRole('textbox').fill('Нормальное')
    await item.getByRole('button', { name: 'Переименовать' }).click()
    await expect(page.getByTestId('user-notice')).toHaveText('Плейлист переименован в «Нормальное»')
    await expect(card.getByTestId('admin-playlist')).toContainText('Нормальное')

    await card.getByTestId('admin-playlist').getByRole('button', { name: 'Удалить обложку' }).click()
    await expect(page.getByTestId('user-notice')).toHaveText('Обложка удалена — вернулся коллаж')
    expect(mocks.accounts.coverRemovals).toEqual([`${PLAIN_USER.id}/${pl.id}`])
    await expect.poll(() => social.covers.size).toBe(0)
    await expect(card.getByTestId('admin-playlist')).not.toContainText('своя обложка')

    page.once('dialog', (d) => void d.accept())
    await card.getByTestId('admin-playlist').getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(page.getByTestId('user-notice')).toHaveText('Плейлист удалён')
    await expect(card.getByTestId('admin-playlist')).toHaveCount(0)
    await expect.poll(() => social.sql('select count(*)::int n from public.playlists')).toEqual([{ n: 0 }])
})
