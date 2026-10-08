import { test, expect, type Browser, type Page } from '@playwright/test'
import { DEFAULT_USERS, PLAIN_USER, SECOND_USER, installMocks, signInSite } from './mocks'
import { FakeRealtime } from './realtimeMock'
import { SocialBackend } from './socialMock'
import type { MockUser } from './accountsMock'

// Реакции в комнатах. RPC — настоящие SQL-функции на PGlite, Realtime —
// общий поддельный сервер (e2e/realtimeMock.ts), доступ к каналам проверяет
// настоящая функция базы: для топика реакций roomfx:… пускает любого
// участника, для топика команд room:… пишет только хозяин.

test.describe.configure({ timeout: 90_000 })

async function openAs(browser: Browser, social: SocialBackend, realtime: FakeRealtime, user: MockUser): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    await installMocks(page, { social })
    await realtime.attach(page, social)
    await signInSite(page, user)
    return page
}

async function hostStartsRoom(page: Page): Promise<string> {
    await page.goto('/#/release/most-venture-poopsicks')
    await page.locator('.track-row').filter({ hasText: 'BACK TO POOPSICKS 2' }).click()
    await expect(page.locator('#player-track')).toHaveText('BACK TO POOPSICKS 2')
    await page.getByTestId('user-menu').click()
    await page.getByTestId('menu-create-room').click()
    await page.getByTestId('create-room-name').fill('Реакции')
    await page.getByTestId('create-room-submit').click()
    await expect(page).toHaveURL(/#\/room\/[0-9a-f-]{36}$/)
    return page.url().split('/room/')[1]
}

const items = (page: Page) => page.getByTestId('rx-item')
const button = (page: Page, emoji: string) => page.getByTestId('room-reactions').getByRole('button', { name: `Реакция ${emoji}` })

test('реакции: шлёт любой участник, всплывает у всех с ником, не больше 2 в секунду, нигде не сохраняется', async ({ browser }) => {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const guest = await openAs(browser, social, realtime, SECOND_USER)
    const id = await hostStartsRoom(host)
    await guest.goto(`/#/room/${id}`)
    await guest.getByTestId('room-connect').click()
    await expect(guest.getByTestId('room-now-title')).toHaveText('BACK TO POOPSICKS 2')

    // Ряд из восьми эмодзи под плеером — у обоих; кнопки включаются, когда канал реакций открыт.
    for (const page of [host, guest]) {
        await expect(page.getByTestId('rx-btn')).toHaveCount(8)
        await expect(page.getByTestId('rx-btn')).toHaveText(['🔥', '❤️', '😭', '😂', '👏', '🤯', '🫶', '💀'])
        await expect(button(page, '🔥')).toBeEnabled()
    }

    // Гость (не хозяин) нажимает: у хозяина и у него самого эмодзи с ником отправителя.
    // Сначала оба видят друг друга в списке участников (ник берётся оттуда).
    for (const page of [host, guest]) await expect(page.locator('section[aria-labelledby="room-people"] [data-testid="user-row"]')).toHaveCount(2)
    await button(guest, '🔥').click()
    await expect(items(host)).toHaveCount(1)
    await expect(items(host).first()).toContainText('🔥')
    await expect(items(host).first()).toContainText(SECOND_USER.nick)
    await expect(items(guest).first()).toContainText(SECOND_USER.nick)
    // Хозяин тоже может — и гость видит.
    await button(host, '🫶').click()
    await expect(items(guest).filter({ hasText: PLAIN_USER.nick })).toHaveCount(1)
    await expect(items(guest).filter({ hasText: '🫶' })).toHaveCount(1)

    // Эмодзи улетают сами.
    await expect(items(host)).toHaveCount(0, { timeout: 6000 })
    await expect(items(guest)).toHaveCount(0)

    // Шесть нажатий подряд — на экране у других не больше двух (2 в секунду на человека).
    for (let i = 0; i < 6; i++) await button(guest, '😂').click({ delay: 0 })
    await expect(items(host).first()).toBeVisible()
    expect(await items(host).count()).toBeLessThanOrEqual(2)
    expect(await items(guest).count()).toBeLessThanOrEqual(2)

    // По проводу прошли только реакции с канала реакций; команды плеера гость не отправлял.
    const fromGuest = realtime.log.filter((l) => l.from === SECOND_USER.id)
    expect(fromGuest.length).toBeGreaterThan(0)
    expect(fromGuest.every((l) => l.topic.startsWith('roomfx:') && l.event === 'reaction')).toBe(true)
    expect(fromGuest.length).toBeLessThanOrEqual(3)
    expect(realtime.log.some((l) => l.topic.startsWith('room:') && l.from === SECOND_USER.id)).toBe(false)
    expect(realtime.log.some((l) => l.topic.startsWith('room:') && l.event === 'state' && l.from === PLAIN_USER.id)).toBe(true)

    // Нигде не сохраняется: ни в состоянии комнаты, ни в базе.
    const rooms = await social.sql<{ state: unknown }>('select state from public.rooms')
    expect(JSON.stringify(rooms)).not.toMatch(/🔥|🫶|😂|reaction/)
    const tables = await social.sql<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' and tablename ilike '%react%'`)
    expect(tables).toEqual([])
    await host.context().close()
    await guest.context().close()
})

test('реакции: не участник в канал не попадёт, а выгнанный теряет реакции', async ({ browser }) => {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const guest = await openAs(browser, social, realtime, SECOND_USER)
    const id = await hostStartsRoom(host)
    await guest.goto(`/#/room/${id}`)
    // Пока не подключился: кнопок реакций нет вовсе.
    await expect(guest.getByTestId('room-reactions')).toHaveCount(0)
    await guest.getByTestId('room-connect').click()
    await expect(button(guest, '👏')).toBeEnabled()

    host.once('dialog', (d) => void d.accept())
    await host.locator('section[aria-labelledby="room-people"] [data-testid="user-row"]').filter({ hasText: SECOND_USER.nick }).getByTestId('room-kick').click()
    await expect(guest.getByTestId('room-kicked')).toBeVisible()
    await expect(guest.getByTestId('room-reactions')).toHaveCount(0)

    // Хозяин жмёт — выгнанному ничего не прилетает, а в канале на старой эпохе реакций больше нет.
    const before = realtime.stats.denied
    await button(host, '🔥').click()
    await expect(items(host)).toHaveCount(1)
    expect(realtime.stats.denied).toBe(before)
    await expect(items(guest)).toHaveCount(0)
    await host.context().close()
    await guest.context().close()
})
