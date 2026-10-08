import { test, expect, type Browser, type Page } from '@playwright/test'
import { ADMIN_USER, DEFAULT_USERS, OWNER_USER, PLAIN_USER, SECOND_USER, installMocks, loginAs, signInSite } from './mocks'
import { SocialBackend } from './socialMock'
import type { MockUser } from './accountsMock'

// «Топ-4» и «Лента друзей»: RPC выполняются настоящими SQL-функциями миграции
// на PGlite (e2e/socialMock.ts) — права, приватность и окно в 7 дней те же,
// что в проде. Каталог — только фикстура tests/fixtures/catalog.

test.describe.configure({ timeout: 90_000 })

async function newSocial(): Promise<SocialBackend> {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    return social
}

async function openAs(browser: Browser, social: SocialBackend, user: MockUser, viewport = { width: 1280, height: 720 }): Promise<Page> {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    const page = await context.newPage()
    await installMocks(page, { social })
    await signInSite(page, user)
    return page
}

const befriend = (social: SocialBackend, a: MockUser, b: MockUser) =>
    social.sql(`insert into public.friendships (requester, addressee, status, accepted_at) values ($1, $2, 'accepted', now())`, [a.id, b.id])
const listen = (social: SocialBackend, user: MockUser, trackKey: string, ago = '1 minute') =>
    social.sql(`insert into public.play_events (track_key, user_id, created_at) values ($1, $2, now() - $3::interval)`, [trackKey, user.id, ago])
const profileUrl = (user: MockUser) => `/#/u/${encodeURIComponent(user.nick)}`
const miniTitle = (page: Page) => page.locator('#player-track')
const slotTitles = (page: Page) => page.getByTestId('top4-slot').getByTestId('top4-title')

test('топ-4: выбрать, переставить, убрать; все вошедшие видят, не только друзья; клик играет', async ({ browser }) => {
    const social = await newSocial()
    const me = await openAs(browser, social, PLAIN_USER)
    await me.goto(profileUrl(PLAIN_USER))

    // Пока пусто: четыре свободных места и подсказка.
    await expect(me.getByTestId('top4-slot')).toHaveCount(4)
    await expect(me.getByTestId('top4-empty')).toBeVisible()

    await me.getByTestId('top4-edit').click()
    const editor = me.getByTestId('top4-editor')
    const add = async (query: string, title: string) => {
        await editor.getByTestId('top4-search').fill(query)
        await editor.getByTestId('top4-hit').filter({ hasText: title }).first().click()
    }
    await add('faaa', 'FAAA')
    await add('боксик', 'какой тебе боксик?')
    await add('macan', 'Macan-Walker')
    await add('hulk', "Hulk's Reflections")
    // Четыре — предел: поиск закрыт, подсказка про лишний трек.
    await expect(editor.getByTestId('top4-draft-row')).toHaveCount(4)
    await expect(editor.getByTestId('top4-search')).toBeDisabled()

    // Порядок: «Macan-Walker» кнопками ↑ на первое место, потом перетаскиванием «FAAA» вниз.
    const draft = editor.getByTestId('top4-draft-row')
    await expect(draft.locator('.tl-title')).toHaveText(['FAAA', 'какой тебе боксик?', 'Macan-Walker', "Hulk's Reflections"])
    await draft.nth(2).getByTestId('top4-up').click()
    await expect(draft.locator('.tl-title')).toHaveText(['FAAA', 'Macan-Walker', 'какой тебе боксик?', "Hulk's Reflections"])
    await draft.nth(1).getByTestId('top4-up').click()
    await expect(draft.locator('.tl-title')).toHaveText(['Macan-Walker', 'FAAA', 'какой тебе боксик?', "Hulk's Reflections"])
    await draft.nth(1).dragTo(draft.nth(3))
    await expect(draft.locator('.tl-title')).toHaveText(['Macan-Walker', 'какой тебе боксик?', "Hulk's Reflections", 'FAAA'])
    // Убрать один, добавить другой.
    await draft.nth(2).getByTestId('top4-remove').click()
    await expect(draft).toHaveCount(3)
    await add('disinvolto', 'Disinvolto: Danilovsky')
    await editor.getByTestId('top4-save').click()

    await expect(me.getByTestId('top4-editor')).toHaveCount(0)
    await expect(slotTitles(me)).toHaveText(['Macan-Walker', 'какой тебе боксик?', 'FAAA', 'Disinvolto: Danilovsky'])
    expect(await social.sql('select position, track_id from public.profile_top4 where user_id = $1 order by position', [PLAIN_USER.id])).toEqual([
        { position: 1, track_id: 'most-venture-poopsicks/macan-walker' },
        { position: 2, track_id: 'boxik/boxik' },
        { position: 3, track_id: 'faaa/faaa' },
        { position: 4, track_id: 'disinvolto/disinvolto' }
    ])

    // Чужой, не друг, видит топ-4 на странице профиля; своего «Изменить» у него нет.
    expect(await social.sql('select count(*)::int n from public.friendships')).toEqual([{ n: 0 }])
    const stranger = await openAs(browser, social, SECOND_USER)
    await stranger.goto(profileUrl(PLAIN_USER))
    await expect(slotTitles(stranger)).toHaveText(['Macan-Walker', 'какой тебе боксик?', 'FAAA', 'Disinvolto: Danilovsky'])
    await expect(stranger.getByTestId('top4-edit')).toHaveCount(0)
    // Закрытое (избранное и топ по прослушиваниям) видно только друзьям.
    await expect(stranger.getByText('видят только друзья')).toBeVisible()
    // Нажатие на обложку — трек играет.
    await stranger.getByTestId('top4-slot').nth(2).getByRole('button').click()
    await expect(miniTitle(stranger)).toHaveText('FAAA')
    await stranger.context().close()

    // Очистить топ совсем.
    await me.reload()
    await me.getByTestId('top4-edit').click()
    for (let i = 0; i < 4; i++) await me.getByTestId('top4-editor').getByTestId('top4-remove').first().click()
    await me.getByTestId('top4-save').click()
    await expect(me.getByTestId('top4-empty')).toBeVisible()
    expect(await social.sql('select count(*)::int n from public.profile_top4')).toEqual([{ n: 0 }])
    await me.context().close()
})

test('топ-4: трек пропал из каталога — пустое место без ошибки, остальные на местах; в редакторе его можно убрать', async ({ browser }) => {
    const social = await newSocial()
    await social.sql(`insert into public.profile_top4 (user_id, position, track_id) values
        ($1, 1, 'faaa/faaa'), ($1, 2, 'gone-release/old-track'), ($1, 3, 'boxik/boxik')`, [PLAIN_USER.id])
    await social.sql(`insert into public.profile_top4_saves (user_id) values ($1)`, [PLAIN_USER.id])
    const me = await openAs(browser, social, PLAIN_USER)
    const errors: string[] = []
    me.on('pageerror', (e) => errors.push(e.message))
    await me.goto(profileUrl(PLAIN_USER))
    await expect(me.getByTestId('top4-slot')).toHaveCount(4)
    await expect(me.getByTestId('top4-slot').nth(0)).toHaveAttribute('data-empty', 'false')
    await expect(me.getByTestId('top4-slot').nth(1)).toHaveAttribute('data-empty', 'true')
    await expect(me.getByTestId('top4-slot').nth(2)).toHaveAttribute('data-empty', 'false')
    await expect(me.getByTestId('top4-slot').nth(3)).toHaveAttribute('data-empty', 'true')
    await expect(me.getByRole('alert')).toHaveCount(0)

    await me.getByTestId('top4-edit').click()
    const draft = me.getByTestId('top4-draft-row')
    await expect(draft).toHaveCount(3)
    await expect(draft.nth(1)).toContainText('Его больше нет в каталоге')
    await draft.nth(1).getByTestId('top4-remove').click()
    await me.getByTestId('top4-save').click()
    await expect(me.getByTestId('top4-slot').nth(1)).toHaveAttribute('data-empty', 'false')
    await expect(slotTitles(me)).toHaveText(['FAAA', 'какой тебе боксик?'])
    expect(errors).toEqual([])
    await me.context().close()
})

test('админка: топ-4 пользователя в его карточке', async ({ page }) => {
    const social = await newSocial()
    await social.sql(`insert into public.profile_top4 (user_id, position, track_id) values
        ($1, 1, 'boxik/boxik'), ($1, 2, 'gone-release/old-track'), ($1, 3, 'faaa/faaa')`, [PLAIN_USER.id])
    await installMocks(page, { social })
    await loginAs(page, ADMIN_USER)
    await page.goto('/admin.html#/users')
    await page.getByTestId(`user-row-${PLAIN_USER.nick}`).click()
    const top4 = page.getByTestId('user-top4')
    await expect(top4.locator('li')).toHaveCount(3)
    await expect(top4.locator('li').nth(0)).toContainText('какой тебе боксик?')
    await expect(top4.locator('li').nth(1)).toContainText('нет в каталоге')
    await expect(top4.locator('li').nth(2)).toContainText('FAAA')
    // У пользователя без топа — «Не заполнен».
    await page.getByTestId(`user-row-${SECOND_USER.nick}`).click()
    await expect(page.getByTestId('user-top4-empty')).toBeVisible()
})

test('лента: события друзей, сворачивание прослушиваний, комната только по приглашению, чужой не друг видит пустоту', async ({ browser }) => {
    const social = await newSocial()
    await befriend(social, PLAIN_USER, SECOND_USER)
    // Три прослушивания подряд → одна строка «и ещё 2»; одно старше недели — не видно.
    await listen(social, SECOND_USER, 'faaa-0', '1 minute')
    await listen(social, SECOND_USER, 'boxik-0', '2 minutes')
    await listen(social, SECOND_USER, 'faaa-0', '3 minutes')
    await listen(social, SECOND_USER, 'boxik-0', '8 days')
    await social.sql(`insert into public.favorites (user_id, track_id, created_at) values ($1, 'disinvolto/disinvolto', now() - interval '10 minutes')`, [SECOND_USER.id])
    await social.sql(`insert into public.playlists (owner_id, title, is_public, created_at) values ($1, 'Ночное', true, now() - interval '20 minutes'), ($1, 'Тайный', false, now() - interval '21 minutes')`, [SECOND_USER.id])
    await social.sql(`insert into public.profile_top4 (user_id, position, track_id) values ($1, 1, 'faaa/faaa'), ($1, 2, 'boxik/boxik')`, [SECOND_USER.id])
    await social.sql(`insert into public.profile_top4_saves (user_id, saved_at) values ($1, now() - interval '30 minutes')`, [SECOND_USER.id])
    const [room] = await social.sql<{ id: string }>(`insert into public.rooms (owner_id, title) values ($1, 'Секретная вечеринка') returning id`, [SECOND_USER.id])
    await social.sql(`insert into public.room_members (room_id, user_id, joined_at) values ($1, $2, now() - interval '40 minutes')`, [room.id, SECOND_USER.id])

    const me = await openAs(browser, social, PLAIN_USER)
    await me.goto('/#/')
    await me.getByTestId('user-menu').click()
    await me.getByTestId('menu-feed').click()
    await expect(me).toHaveURL(/#\/feed$/)

    const items = me.getByTestId('feed-item')
    await expect(items).toHaveCount(5)
    await expect(items.nth(0)).toContainText('Второй слушал(а) FAAA')
    await expect(items.nth(0).getByTestId('feed-more')).toHaveText('и ещё 2')
    await expect(items.nth(0)).toContainText('мин назад')
    await expect(items.nth(1)).toContainText('добавил(а) в избранное Disinvolto: Danilovsky')
    await expect(items.nth(2)).toContainText('создал(а) публичный плейлист Ночное')
    await expect(items.nth(3)).toContainText('обновил(а) топ-4')
    await expect(items.nth(3).locator('img')).toHaveCount(2)
    await expect(items.nth(4)).toContainText('слушает в комнате')
    // Закрытый плейлист и старое прослушивание не показаны; комната без приглашения — без названия и кнопки.
    await expect(me.getByText('Тайный')).toHaveCount(0)
    await expect(me.getByText('Секретная вечеринка')).toHaveCount(0)
    await expect(me.getByTestId('feed-join')).toHaveCount(0)
    expect(await me.content()).not.toContain(room.id)

    // Нажатие на трек в ленте играет его.
    await items.nth(0).getByTestId('feed-track').click()
    await expect(miniTitle(me)).toHaveText('FAAA')

    // Пригласили — после обновления страницы появляются название и «Зайти».
    await social.sql(`insert into public.room_invites (room_id, to_user, from_user) values ($1, $2, $3)`, [room.id, PLAIN_USER.id, SECOND_USER.id])
    await me.reload()
    await expect(me.getByTestId('feed-item').filter({ hasText: 'в комнате «Секретная вечеринка»' })).toHaveCount(1)
    await me.getByTestId('feed-join').click()
    await expect(me).toHaveURL(new RegExp(`#/room/${room.id}$`))
    await me.context().close()

    // Не друг: ни одного события.
    const stranger = await openAs(browser, social, OWNER_USER)
    await stranger.goto('/#/feed')
    await expect(stranger.getByTestId('feed-empty')).toBeVisible()
    await expect(stranger.getByTestId('feed-item')).toHaveCount(0)
    await stranger.context().close()
})

test('лента: «Не показывать мои прослушивания» скрывает только прослушивания', async ({ browser }) => {
    const social = await newSocial()
    await befriend(social, PLAIN_USER, SECOND_USER)
    await listen(social, SECOND_USER, 'faaa-0')
    await social.sql(`insert into public.favorites (user_id, track_id) values ($1, 'boxik/boxik')`, [SECOND_USER.id])

    const friend = await openAs(browser, social, SECOND_USER)
    await friend.goto('/#/me')
    const toggle = friend.getByTestId('feed-hide-listens')
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    await toggle.check()
    await expect.poll(() => social.sql('select hide_listens from public.feed_prefs where user_id = $1', [SECOND_USER.id])).toEqual([{ hide_listens: true }])
    // Настройка живёт в базе: после перезагрузки включена.
    await friend.reload()
    await expect(friend.getByTestId('feed-hide-listens')).toBeChecked()

    const me = await openAs(browser, social, PLAIN_USER)
    await me.goto('/#/feed')
    await expect(me.getByTestId('feed-item')).toHaveCount(1)
    await expect(me.getByTestId('feed-item')).toContainText('добавил(а) в избранное какой тебе боксик?')
    await expect(me.locator('[data-kind="listen"]')).toHaveCount(0)

    // Выключил — прослушивания вернулись.
    await friend.getByTestId('feed-hide-listens').uncheck()
    await expect.poll(() => social.sql('select hide_listens from public.feed_prefs where user_id = $1', [SECOND_USER.id])).toEqual([{ hide_listens: false }])
    await me.reload()
    await expect(me.locator('[data-kind="listen"]')).toHaveCount(1)
    await friend.context().close()
    await me.context().close()
})

test('лента: «Показать ещё» подгружается по прокрутке и по кнопке; без входа лента закрыта', async ({ browser }) => {
    const social = await newSocial()
    await befriend(social, PLAIN_USER, SECOND_USER)
    await befriend(social, PLAIN_USER, ADMIN_USER)
    // 60 прослушиваний вперемешку от двух друзей: сворачиваться нечему.
    await social.sql(
        `insert into public.play_events (track_key, user_id, created_at)
         select 'faaa-0', case when n % 2 = 0 then $1::uuid else $2::uuid end, now() - (n || ' seconds')::interval
         from generate_series(1, 60) n`,
        [SECOND_USER.id, ADMIN_USER.id]
    )
    const me = await openAs(browser, social, PLAIN_USER)
    await me.goto('/#/feed')
    await expect(me.getByTestId('feed-item')).toHaveCount(40)
    // Прокрутка до конца подгружает остальное без нажатия.
    await me.getByTestId('feed-more-btn').scrollIntoViewIfNeeded()
    await expect(me.getByTestId('feed-item')).toHaveCount(60)
    await expect(me.getByTestId('feed-more-btn')).toHaveCount(0)
    await me.context().close()

    const guest = await browser.newContext({ serviceWorkers: 'block' })
    const guestPage = await guest.newPage()
    await installMocks(guestPage, { social })
    await guestPage.goto('/#/feed')
    await expect(guestPage).toHaveURL(/#\/welcome/)
    await guest.close()
})

test('лента: чужой текст выводится как текст, а не как разметка', async ({ browser }) => {
    const social = await newSocial()
    await befriend(social, PLAIN_USER, SECOND_USER)
    const evil = '<img src=x onerror="window.__xss=1">'
    await social.sql(`insert into public.playlists (owner_id, title, is_public) values ($1, $2, true)`, [SECOND_USER.id, evil])
    const me = await openAs(browser, social, PLAIN_USER)
    await me.goto('/#/feed')
    await expect(me.getByTestId('feed-item')).toContainText(evil)
    await expect(me.locator('.feed-list img[src="x"]')).toHaveCount(0)
    expect(await me.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
    await me.context().close()
})
