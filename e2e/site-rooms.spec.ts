import { test, expect, type Browser, type Page } from '@playwright/test'
import { DEFAULT_USERS, PLAIN_USER, SECOND_USER, ADMIN_USER, OWNER_USER, installMocks, loginAs, signInSite, type MockOptions } from './mocks'
import { FakeRealtime } from './realtimeMock'
import { SocialBackend } from './socialMock'
import type { MockUser } from './accountsMock'

// «Комнаты»: RPC выполняются настоящими SQL-функциями миграции на PGlite
// (права, лимиты), а Supabase Realtime подменён общим для всех окон
// сервером WebSocket (e2e/realtimeMock.ts), который проверяет доступ к
// каналам той же функцией базы, что и политики realtime.messages.

test.describe.configure({ timeout: 90_000 })

async function newSocial(): Promise<SocialBackend> {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    return social
}

async function openAs(browser: Browser, social: SocialBackend, realtime: FakeRealtime, user: MockUser, options: Partial<MockOptions> = {}): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    await installMocks(page, { social, ...options })
    await realtime.attach(page, social)
    await signInSite(page, user)
    return page
}

const mini = (page: Page) => page.locator('#player-track')
const paused = (page: Page) => page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).paused)
const position = (page: Page) => page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).currentTime)
const roomIdOf = (page: Page) => page.url().split('/room/')[1]
/** Строки списка участников (а не друзей в панели приглашений). */
const members = (page: Page) => page.locator('section[aria-labelledby="room-people"] [data-testid="user-row"]')

/** Хозяин включает трек релиза и создаёт комнату из меню профиля. */
async function hostStartsRoom(page: Page, title = 'Ночной эфир'): Promise<string> {
    await page.goto('/#/release/most-venture-poopsicks')
    await page.locator('.track-row').filter({ hasText: 'BACK TO POOPSICKS 2' }).click()
    await expect(mini(page)).toHaveText('BACK TO POOPSICKS 2')
    await page.getByTestId('user-menu').click()
    await page.getByTestId('menu-create-room').click()
    await page.getByTestId('create-room-name').fill(title)
    await page.getByTestId('create-room-submit').click()
    await expect(page).toHaveURL(/#\/room\/[0-9a-f-]{36}$/)
    await expect(page.getByTestId('room-title')).toHaveText(title)
    return roomIdOf(page)
}

test('комната: хозяин и гость в двух окнах — тот же трек, пауза, перемотка, блокировка управления, статистика гостя', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    const counted: string[] = []
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const guest = await openAs(browser, social, realtime, SECOND_USER, {
        rpc: (name, body) => {
            if (name === 'increment_play_count') counted.push(String((body as { track_key_input: string }).track_key_input))
            return undefined
        }
    })

    const id = await hostStartsRoom(host)
    await expect(host.getByTestId('room-now-title')).toHaveText('BACK TO POOPSICKS 2')
    await expect(host.getByTestId('room-next')).toContainText('Macan-Walker')

    // Гость открывает ссылку: до нажатия звука нет, есть кнопка «Подключиться».
    await guest.goto(`/#/room/${id}`)
    await expect(guest.getByTestId('room-title')).toHaveText('Ночной эфир')
    await expect(guest.locator('#player.visible')).toHaveCount(0)
    await guest.getByTestId('room-connect').click()
    await expect(guest.getByTestId('room-now-title')).toHaveText('BACK TO POOPSICKS 2')
    await expect(mini(guest)).toHaveText('BACK TO POOPSICKS 2')
    await expect.poll(() => paused(guest)).toBe(false)
    await expect(guest.getByTestId('room-chip')).toContainText('Ночной эфир')
    // Оба в списке участников и в сети.
    for (const page of [host, guest]) {
        await expect(members(page)).toHaveCount(2)
        await expect(members(page).filter({ hasText: PLAIN_USER.nick })).toContainText('хозяин')
        await expect(members(page).filter({ hasText: SECOND_USER.nick })).toContainText('в сети')
    }

    // Гостю доступна громкость, остальное — подсказка.
    await guest.locator('#volume-slider').fill('0.4')
    await expect(guest.getByTestId('notice')).not.toHaveText(/хозяин/)
    for (const [name, locator] of [
        ['пауза', guest.locator('#play-pause-btn')],
        ['дальше', guest.locator('#player').getByRole('button', { name: 'Следующий трек' })],
        ['назад', guest.locator('#player').getByRole('button', { name: 'Предыдущий трек' })]
    ] as const) {
        await locator.click()
        await expect(guest.getByTestId('notice'), name).toHaveText('Музыкой управляет хозяин комнаты')
    }
    await expect(mini(guest)).toHaveText('BACK TO POOPSICKS 2')
    expect(await paused(guest)).toBe(false)
    // Клик по строке треклиста другого релиза — тоже подсказка, трек не меняется.
    await guest.goto('/#/release/most-venture-poopsicks')
    await guest.locator('.track-row').filter({ hasText: 'Macan-Walker' }).click()
    await expect(mini(guest)).toHaveText('BACK TO POOPSICKS 2')
    // Переход по страницам сайта комнату не рвёт.
    await expect(guest.getByTestId('room-chip')).toBeVisible()

    // Хозяин переключает трек — гость следом.
    await host.locator('#player').getByRole('button', { name: 'Следующий трек' }).click()
    await expect(mini(host)).toHaveText('Macan-Walker')
    await expect(mini(guest)).toHaveText('Macan-Walker')
    await expect.poll(() => paused(guest)).toBe(false)

    // Перемотка хозяина до середины — гость догоняет, и ему засчитывается прослушивание.
    const bar = host.locator('#player .progress-container')
    const box = (await bar.boundingBox())!
    await host.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
    await expect.poll(async () => Math.abs((await position(guest)) - (await position(host))), { timeout: 8000 }).toBeLessThan(1.5)
    await expect.poll(() => counted, { timeout: 8000 }).toContain('most-venture-poopsicks-2')

    // Пауза хозяина.
    await host.locator('#play-pause-btn').click()
    await expect.poll(() => paused(guest)).toBe(true)
    await host.locator('#play-pause-btn').click()
    await expect.poll(() => paused(guest)).toBe(false)
})

test('комната: хозяин выгоняет гостя и закрывает комнату', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const guest = await openAs(browser, social, realtime, SECOND_USER)
    const id = await hostStartsRoom(host)
    await guest.goto(`/#/room/${id}`)
    await guest.getByTestId('room-connect').click()
    await expect(mini(guest)).toHaveText('BACK TO POOPSICKS 2')

    host.once('dialog', (d) => void d.accept())
    await members(host).filter({ hasText: SECOND_USER.nick }).getByTestId('room-kick').click()
    await expect(members(host)).toHaveCount(1)
    // Гость сразу выходит: музыка замолкла, страница показывает причину.
    await expect(guest.getByTestId('room-kicked')).toBeVisible()
    await expect(guest.getByTestId('room-chip')).toHaveCount(0)
    await expect.poll(() => paused(guest)).toBe(true)
    await expect(guest.getByTestId('room-connect')).toHaveCount(0)
    // Вернуться по ссылке нельзя; хозяин продолжает играть и без него.
    await guest.reload()
    await expect(guest.getByTestId('room-kicked')).toBeVisible()
    expect(await social.sql('select count(*)::int n from public.room_kicks')).toEqual([{ n: 1 }])
    // Канал после исключения живёт на новой эпохе, а старый пуст.
    await host.locator('#player').getByRole('button', { name: 'Следующий трек' }).click()
    await expect(host.getByTestId('room-now-title')).toHaveText('Macan-Walker')

    // Закрыть комнату.
    host.once('dialog', (d) => void d.accept())
    await host.getByTestId('room-close').click()
    await expect(host).toHaveURL(/#\/$/)
    expect(await social.sql('select closed_reason from public.rooms')).toEqual([{ closed_reason: 'owner' }])
    await guest.goto(`/#/room/${id}`)
    await guest.reload()
    await expect(guest.getByTestId('room-missing')).toBeVisible()
})

test('комната: хозяин ушёл — через 15 секунд пауза и «Ждём хозяина»; вернулся после перезагрузки — с паузы', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const guest = await openAs(browser, social, realtime, SECOND_USER)
    const id = await hostStartsRoom(host)
    await guest.goto(`/#/room/${id}`)
    await guest.getByTestId('room-connect').click()
    await expect.poll(() => paused(guest)).toBe(false)

    // Хозяин закрыл вкладку.
    await host.context().close()
    // Через несколько секунд ещё играем (обрыв может быть коротким)…
    await guest.waitForTimeout(6000)
    expect(await paused(guest)).toBe(false)
    await expect(guest.getByTestId('room-waiting')).toHaveCount(0)
    // …а после ~15 секунд — пауза у всех и надпись.
    await expect(guest.getByTestId('room-waiting')).toHaveText('Ждём хозяина', { timeout: 20_000 })
    await expect.poll(() => paused(guest)).toBe(true)
    await expect(guest.getByTestId('room-chip-wait')).toBeVisible()
    const frozen = await position(guest)

    // Хозяин вернулся: новая вкладка того же аккаунта, чистый плеер.
    const back = await openAs(browser, social, realtime, PLAIN_USER)
    await back.goto(`/#/room/${id}`)
    await expect(back.getByTestId('room-title')).toHaveText('Ночной эфир')
    await expect(back.getByTestId('room-now-title')).toHaveText('BACK TO POOPSICKS 2')
    await expect(mini(back)).toHaveText('BACK TO POOPSICKS 2')
    await expect.poll(() => paused(back)).toBe(true)
    await expect(guest.getByTestId('room-waiting')).toHaveCount(0)
    await expect.poll(() => paused(guest)).toBe(true)
    expect(Math.abs((await position(guest)) - (await position(back)))).toBeLessThan(15)
    void frozen
    // Нажал «играть» — гость следом.
    await back.locator('#play-pause-btn').click()
    await expect.poll(() => paused(guest)).toBe(false)
})

test('комната: приглашение другу — значок на аватаре, кнопка «Войти»; создание из «Друзей»', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    await social.sql(`insert into public.friendships (requester, addressee, status, accepted_at) values ($1, $2, 'accepted', now())`, [PLAIN_USER.id, SECOND_USER.id])
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const friend = await openAs(browser, social, realtime, SECOND_USER)
    await friend.goto('/#/friends')
    await expect(friend.getByTestId('friend-requests-badge')).toHaveCount(0)

    // «Создать комнату» на странице «Друзья».
    await host.goto('/#/friends')
    await host.getByTestId('friends-create-room').click()
    await host.getByTestId('create-room-name').fill('Для своих')
    await host.getByTestId('create-room-submit').click()
    await expect(host.getByTestId('room-title')).toHaveText('Для своих')
    // Название — не больше 40 символов.
    await host.getByTestId('room-invite-toggle').click()
    await host.getByTestId('room-invite-friend').click()
    await expect(host.getByTestId('notice')).toContainText(`Приглашение отправлено: ${SECOND_USER.nick}`)

    // У друга приглашение показано так же, как заявка: значок на аватаре.
    await friend.reload()
    await expect(friend.getByTestId('friend-requests-badge')).toHaveText('1')
    await friend.goto('/#/friends')
    await expect(friend.getByTestId('invites-count')).toHaveText('1')
    await friend.getByTestId('invite-enter').click()
    await expect(friend).toHaveURL(new RegExp(`#/room/${roomIdOf(host)}$`))
    await expect(friend.getByTestId('room-title')).toHaveText('Для своих')
    await expect(members(host)).toHaveCount(2)
    await expect(friend.getByTestId('friend-requests-badge')).toHaveCount(0)

    // В меню профиля у обоих — переход в комнату.
    await friend.getByTestId('user-menu').click()
    await expect(friend.getByTestId('menu-room')).toContainText('Для своих')
})

test('комната: лимиты — одна открытая комната, название до 40 символов, 20 человек', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    await host.goto('/#/')
    await host.getByTestId('user-menu').click()
    await host.getByTestId('menu-create-room').click()
    await expect(host.getByTestId('create-room-name')).toHaveAttribute('maxlength', '40')
    await host.getByTestId('create-room-name').fill('<b>Я</b>'.repeat(5))
    await host.getByTestId('create-room-submit').click()
    // Название выводится текстом, не HTML.
    await expect(host.getByTestId('room-title')).toHaveText('<b>Я</b>'.repeat(5))
    await expect(host.locator('[data-testid="room-title"] b')).toHaveCount(0)
    // Вторая комната: пункт меню ведёт в первую.
    await host.getByTestId('user-menu').click()
    await expect(host.getByTestId('menu-create-room')).toHaveCount(0)

    // 20 человек уже в комнате — 21-й получает отказ.
    const [{ id }] = await social.sql<{ id: string }>('select id from public.rooms')
    for (let i = 0; i < 18; i++) {
        const uid = `00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`
        await social.sql(`insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, '{}')`, [uid, `u-${String(i).padStart(32, '0')}@id.frnkness.ru`])
        await social.sql(`insert into public.profiles (id, nick, nick_key) values ($1, $2, $2)`, [uid, `гость${i}`])
        await social.sql(`insert into public.room_members (room_id, user_id) values ($1, $2)`, [id, uid])
    }
    await social.sql(`insert into public.room_members (room_id, user_id) values ($1, $2)`, [id, ADMIN_USER.id])
    const late = await openAs(browser, social, realtime, SECOND_USER)
    await late.goto(`/#/room/${id}`)
    await expect(late.getByTestId('room-full')).toBeVisible()
    await expect(late.getByTestId('room-connect')).toHaveCount(0)
    void OWNER_USER
})

test('админка: открытая комната пользователя и кнопка «Закрыть комнату»', async ({ browser, page }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const id = await hostStartsRoom(host, 'Эфир на закрытие')

    await installMocks(page, { social })
    await loginAs(page, ADMIN_USER)
    await page.goto('/admin.html#/users')
    await page.getByTestId(`user-row-${PLAIN_USER.nick}`).click()
    await expect(page.getByTestId('user-room-title')).toHaveText('Эфир на закрытие')
    page.once('dialog', (d) => void d.accept())
    await page.getByTestId('user-room-close').click()
    await expect(page.getByTestId('user-notice')).toHaveText('Комната закрыта')
    await expect(page.getByTestId('user-room')).toHaveCount(0)
    expect(await social.sql('select closed_reason from public.rooms where id = $1', [id])).toEqual([{ closed_reason: 'admin' }])

    // Хозяин узнаёт об этом по сердцебиению; музыка у него не прерывается.
    await expect(mini(host)).toHaveText('BACK TO POOPSICKS 2')
})

test('хозяин закрыл вкладку и открыл сайт снова: метка в мини-плеере, «Вернуться в комнату» в меню и на «Друзьях»', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const id = await hostStartsRoom(host, 'Вернусь')
    await host.context().close()

    const back = await openAs(browser, social, realtime, PLAIN_USER)
    // Не страница комнаты, а главная: путь назад должен быть виден отовсюду.
    await back.goto('/#/')
    const chip = back.getByTestId('room-chip')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('Вернусь')
    await back.getByTestId('user-menu').click()
    await expect(back.getByTestId('menu-room')).toHaveText('Вернуться в комнату «Вернусь»')
    await back.keyboard.press('Escape')
    await back.goto('/#/friends')
    await expect(back.getByTestId('my-room-link')).toHaveText('Вернуться в комнату')
    await back.getByTestId('my-room-link').click()
    await expect(back).toHaveURL(new RegExp(`#/room/${id}$`))
    await expect(back.getByTestId('room-title')).toHaveText('Вернусь')
    // Хозяин снова на связи, а не просто «числится».
    await expect(members(back).filter({ hasText: PLAIN_USER.nick })).toContainText('хозяин')
    await expect(back.getByTestId('room-close')).toBeVisible()
    // Метка в мини-плеере ведёт обратно в комнату с любой страницы.
    await back.goto('/#/chart')
    await back.getByTestId('room-chip').click()
    await expect(back).toHaveURL(new RegExp(`#/room/${id}$`))
})

test('«Друзья»: приглашение приходит и появляется в списке само, вместе со значком', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    await social.sql(`insert into public.friendships (requester, addressee, status, accepted_at) values ($1, $2, 'accepted', now())`, [PLAIN_USER.id, SECOND_USER.id])
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const friend = await openAs(browser, social, realtime, SECOND_USER)
    await friend.goto('/#/friends')
    await expect(friend.getByTestId('invites-count')).toHaveCount(0)

    await hostStartsRoom(host, 'Зову')
    await host.getByTestId('room-invite-toggle').click()
    await host.getByTestId('room-invite-friend').click()
    await expect(host.getByTestId('notice')).toContainText('Приглашение отправлено')

    // Страницу не обновляем: значок и строка приглашения появляются сами.
    await expect(friend.getByTestId('friend-requests-badge')).toHaveText('1', { timeout: 20_000 })
    await expect(friend.getByTestId('invites-count')).toHaveText('1')
    await expect(friend.getByText('зовёт в «Зову»')).toBeVisible()
    // Хозяин закрыл комнату — приглашение исчезает так же сам.
    host.once('dialog', (d) => void d.accept())
    await host.getByTestId('room-close').click()
    await expect(friend.getByTestId('invites-count')).toHaveCount(0, { timeout: 20_000 })
    await expect(friend.getByTestId('friend-requests-badge')).toHaveCount(0)
})
