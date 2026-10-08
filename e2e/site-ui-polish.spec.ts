import { test, expect, type Browser, type Page } from '@playwright/test'
import { ADMIN_USER, DEFAULT_USERS, OWNER_USER, PLAIN_USER, SECOND_USER, installMocks, loginAs, signInSite } from './mocks'
import { FakeRealtime } from './realtimeMock'
import { SocialBackend } from './socialMock'
import type { MockUser } from './accountsMock'

// Интерфейс сайта: единый значок-тег, подтверждение выхода, меню профиля,
// «Добавить треки» в плейлисте, комнаты (мини-плеер без трека, «Включить»,
// «Сейчас играет», реакции). RPC — настоящие SQL-функции на PGlite.

test.describe.configure({ timeout: 90_000 })

const DESKTOP = { width: 1280, height: 720 }
const PHONE = { width: 375, height: 700 }

async function newSocial(): Promise<SocialBackend> {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    return social
}

async function openAs(browser: Browser, social: SocialBackend, user: MockUser, viewport = DESKTOP, realtime?: FakeRealtime): Promise<Page> {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    const page = await context.newPage()
    await installMocks(page, { social })
    if (realtime) await realtime.attach(page, social)
    await signInSite(page, user)
    return page
}

const miniTitle = (page: Page) => page.locator('#player-track')

async function createRoomFromMenu(page: Page, title = 'Комната') {
    await page.getByTestId('user-menu').click()
    await page.getByTestId('menu-create-room').click()
    await page.getByTestId('create-room-name').fill(title)
    await page.getByTestId('create-room-submit').click()
    await expect(page).toHaveURL(/#\/room\/[0-9a-f-]{36}$/)
    await expect(page.getByTestId('room-title')).toHaveText(title)
}

// ── Значок-тег ──────────────────────────────────────────────────────────

/** Все значки на странице: по ширине текста, одной высоты и радиуса, на одной строке с ником. */
async function expectTagsCompact(page: Page, expectedCount: number) {
    const tags = page.getByTestId('user-tag')
    await expect(tags).toHaveCount(expectedCount)
    const info = await tags.evaluateAll((els) =>
        els.map((el) => {
            const box = el.getBoundingClientRect()
            const style = getComputedStyle(el)
            const text = el.querySelector('.user-tag-text') as HTMLElement
            const group = el.closest('.nick-tag')!.getBoundingClientRect()
            const name = el.parentElement!.querySelector('.nick-tag-name')!.getBoundingClientRect()
            return {
                display: style.display,
                // Размеры — по раскладке (offset*), а не по рамке на экране: меню при появлении слегка масштабируется.
                height: (el as HTMLElement).offsetHeight,
                radius: style.borderTopLeftRadius,
                paddingLeft: style.paddingLeft,
                // Ширина значка = ширина текста + отступы, ни пикселя «растяжения».
                slack: Math.round((el as HTMLElement).offsetWidth - text.offsetWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
                width: (el as HTMLElement).offsetWidth,
                // Тег — на одной строке с ником: вертикальные диапазоны пересекаются.
                sameLine: box.top < name.bottom && box.bottom > name.top && box.top >= group.top - 1 && box.bottom <= group.bottom + 1
            }
        })
    )
    expect(info.length).toBe(expectedCount)
    for (const t of info) {
        // В flex-родителе браузер сообщает inline-flex как flex; ширина по тексту проверяется ниже.
        expect(['inline-flex', 'flex']).toContain(t.display)
        expect(t.slack).toBeLessThanOrEqual(1)
        expect(t.width).toBeLessThanOrEqual(160)
        expect(t.sameLine).toBe(true)
    }
    // Везде один размер: высота, радиус и отступы совпадают.
    const sizes = info.map((t) => `${t.height}|${t.radius}|${t.paddingLeft}`)
    expect(sizes, 'высота|радиус|отступ').toEqual(sizes.map(() => sizes[0]))
}

for (const [label, viewport] of [['компьютер', DESKTOP], ['телефон', PHONE]] as const) {
    test(`значок-тег не растягивается: заявки, друзья, поиск, профиль, лента, меню, плейлист, комната (${label})`, async ({ browser }) => {
        const social = await newSocial()
        const ids = new Map<string, number>()
        for (const [name, color] of [['author', '#8855ff'], ['admin', '#ff8800'], ['VIP', '#112233']] as const) {
            const [row] = await social.sql<{ id: number }>(`insert into public.user_tags (name, color) values ($1, $2) returning id`, [name, color])
            ids.set(name, row.id)
        }
        const assign = (u: MockUser, tag: string) => social.sql('insert into public.user_tag_assignments (user_id, tag_id) values ($1, $2)', [u.id, ids.get(tag)])
        await assign(OWNER_USER, 'author')
        await assign(ADMIN_USER, 'admin')
        await assign(PLAIN_USER, 'VIP')
        // Входящая заявка от владельца, принятая дружба с админом; админ слушает трек (лента).
        await social.sql(`insert into public.friendships (requester, addressee, status) values ($1, $2, 'pending')`, [OWNER_USER.id, PLAIN_USER.id])
        await social.sql(`insert into public.friendships (requester, addressee, status, accepted_at) values ($1, $2, 'accepted', now())`, [ADMIN_USER.id, PLAIN_USER.id])
        await social.sql(`insert into public.favorites (user_id, track_id) values ($1, 'faaa/faaa')`, [ADMIN_USER.id])

        const page = await openAs(browser, social, PLAIN_USER, viewport, new FakeRealtime())

        // Заявки в друзья — случай, где значок тянулся на всю строку.
        await page.goto('/#/friends')
        await expect(page.getByTestId('incoming-count')).toHaveText('1')
        const request = page.getByTestId('user-row').filter({ hasText: OWNER_USER.nick })
        await expect(request.getByTestId('user-tag')).toHaveText('author')
        const rowBox = (await request.boundingBox())!
        const tagBox = (await request.getByTestId('user-tag').boundingBox())!
        expect(tagBox.width).toBeLessThan(rowBox.width / 3)
        await expectTagsCompact(page, 2) // заявка + друг

        // Поиск по нику.
        await page.getByTestId('friend-search').click()
        await expect(page.getByTestId('discover-list').getByTestId('user-row').filter({ hasText: ADMIN_USER.nick }).getByTestId('user-tag')).toHaveText('admin')
        await expectTagsCompact(page, 4) // + владелец и админ в списке поиска

        // Профиль, лента, настройки, плейлист.
        await page.goto(`/#/u/${encodeURIComponent(ADMIN_USER.nick)}`)
        await expect(page.locator('.profile-nick').getByTestId('user-tag')).toHaveText('admin')
        await expectTagsCompact(page, 1)
        await page.goto('/#/feed')
        await expect(page.getByTestId('feed-item').first().getByTestId('user-tag')).toHaveText('admin')
        await expectTagsCompact(page, 1)
        await page.goto('/#/me')
        await expect(page.locator('.profile-nick').getByTestId('user-tag')).toHaveText('VIP')
        await expectTagsCompact(page, 1)
        await page.goto('/#/playlists')
        await page.getByLabel('Название нового плейлиста').fill('Свой')
        await page.getByRole('button', { name: 'Создать', exact: true }).click()
        await expect(page.getByTestId('playlist-title')).toHaveText('Свой')
        await expectTagsCompact(page, 1)

        // Меню профиля: тег в карточке.
        await page.getByTestId('user-menu').click()
        await expect(page.getByTestId('menu-profile').getByTestId('user-tag')).toHaveText('VIP')
        await expectTagsCompact(page, 2) // + владелец плейлиста на странице
        await page.keyboard.press('Escape')

        // Комната: «Хозяин: ник [тег]».
        await createRoomFromMenu(page, 'Теги')
        await expect(page.getByTestId('room-meta').getByTestId('user-tag')).toHaveText('VIP')
        await expectTagsCompact(page, 2) // «Хозяин» в шапке + строка участника
    })
}

// ── Выход с подтверждением ──────────────────────────────────────────────

test('выход: подтверждение «Выйти из аккаунта?», «Отмена» и Esc ничего не делают', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto('/#/')

    await page.getByTestId('user-menu').click()
    await page.getByTestId('menu-logout').click()
    const dialog = page.getByTestId('logout-confirm')
    await expect(dialog).toContainText('Выйти из аккаунта?')
    await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeFocused()
    await dialog.getByTestId('logout-cancel').click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('user-menu')).toBeVisible()

    await page.getByTestId('user-menu').click()
    await page.getByTestId('menu-logout').click()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('welcome')).toHaveCount(0)

    await page.getByTestId('user-menu').click()
    await page.getByTestId('menu-logout').click()
    await dialog.getByTestId('logout-confirm-btn').click()
    await expect(page.getByTestId('welcome')).toBeVisible()
})

// ── Меню профиля ────────────────────────────────────────────────────────

for (const [label, viewport] of [['компьютер', DESKTOP], ['телефон', PHONE]] as const) {
    test(`меню профиля: карточка, иконки, группы, акцентная кнопка комнаты (${label})`, async ({ browser }) => {
        const social = await newSocial()
        const page = await openAs(browser, social, ADMIN_USER, viewport, new FakeRealtime())
        await page.goto('/#/')
        await page.getByTestId('user-menu').click()
        const list = page.getByTestId('user-menu-list')
        await expect(list).toBeVisible()

        // Нет отдельного пункта «Мой профиль» — карточка с ником ведёт в профиль.
        await expect(list.getByRole('menuitem', { name: 'Мой профиль', exact: true })).toHaveCount(0)
        await expect(page.getByTestId('menu-profile')).toContainText(ADMIN_USER.nick)

        // Порядок: Избранное, плейлисты | друзья, лента | комната | Настройки, проблема, админка | Выйти.
        const labels = await list.getByRole('menuitem').evaluateAll((els) => els.slice(1).map((el) => (el.textContent ?? '').trim()))
        expect(labels).toEqual(['Избранное', 'Мои плейлисты', 'Друзья', 'Лента', 'Создать комнату', 'Настройки', 'Сообщить о проблеме', 'Админка', 'Выйти'])

        // У каждого пункта своя иконка; «Выйти» красный, «Создать комнату» — акцентная кнопка.
        for (const item of await list.getByRole('menuitem').all()) await expect(item.locator('svg.menu-icon')).toHaveCount(1)
        await expect(page.getByTestId('menu-logout')).toHaveCSS('color', 'rgb(255, 139, 142)')
        await expect(page.getByTestId('menu-create-room')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
        await expect(list.locator('.menu-group')).toHaveCount(5)

        // Вмещается в экран; пункты удобны для пальца.
        const box = (await list.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
        for (const item of await list.getByRole('menuitem').all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(40)

        // Нажатие на карточку — мой профиль.
        await page.getByTestId('menu-profile').click()
        await expect(page).toHaveURL(new RegExp(`#/u/${encodeURIComponent(ADMIN_USER.nick)}$`))
        await expect(list).toHaveCount(0)

        // Создал комнату — кнопка превращается в «Вернуться в комнату».
        await createRoomFromMenu(page, 'Меню')
        await page.goto('/#/')
        await page.getByTestId('user-menu').click()
        await expect(page.getByTestId('menu-create-room')).toHaveCount(0)
        await expect(page.getByTestId('menu-room')).toHaveText('Вернуться в комнату «Меню»')
    })
}

test('меню профиля: «Админка» только админам, «Итоги» и заявки сохраняются', async ({ browser }) => {
    const social = await newSocial()
    await social.sql(`insert into public.friendships (requester, addressee, status) values ($1, $2, 'pending')`, [SECOND_USER.id, PLAIN_USER.id])
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto('/#/')
    await expect(page.getByTestId('friend-requests-badge')).toHaveText('1')
    await page.getByTestId('user-menu').click()
    await expect(page.getByRole('menuitem', { name: /Друзья/ }).locator('.badge')).toHaveText('1')
    await expect(page.getByRole('menuitem', { name: 'Админка' })).toHaveCount(0)
})

// ── Плейлист: «Добавить треки» ──────────────────────────────────────────

test('плейлист: «Добавить треки» — поиск по каталогу, в конец, добавленные отмечены, предел 200', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto('/#/playlists')
    await page.getByLabel('Название нового плейлиста').fill('Сборник')
    await page.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(page.getByTestId('playlist-title')).toHaveText('Сборник')
    await expect(page.getByTestId('playlist-picker')).toHaveCount(0)

    await page.getByTestId('playlist-add-tracks').click()
    const search = page.getByTestId('playlist-picker-search')
    await search.fill('faaa')
    const rows = page.getByTestId('playlist-picker-row')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toHaveAttribute('data-added', 'false')
    await rows.first().click()
    await expect(page.getByTestId('track-row')).toHaveText([/FAAA/])
    await expect(rows.first()).toHaveAttribute('data-added', 'true')
    await expect(rows.first()).toBeDisabled()

    // Следующий трек встаёт в конец.
    await search.fill('Бильярд')
    await rows.first().click()
    await expect(page.getByTestId('track-row')).toHaveText([/FAAA/, /Бильярд/])
    await page.reload()
    await expect(page.getByTestId('track-row')).toHaveText([/FAAA/, /Бильярд/])
    expect(await social.sql(`select track_id from public.playlist_tracks order by position`)).toEqual([{ track_id: 'faaa/faaa' }, { track_id: 'zlaya-nostalgia/bilyard' }])

    // Весь каталог без запроса; уже добавленные отмечены.
    await page.getByTestId('playlist-add-tracks').click()
    await expect(page.getByTestId('playlist-picker-row').filter({ has: page.locator('[data-added="true"]') })).toHaveCount(0)
    await expect(page.locator('[data-testid="playlist-picker-row"][data-added="true"]')).toHaveCount(2)

    // Предел 200 треков: список заполнен — добавлять нельзя.
    const [pl] = await social.sql<{ id: string }>(`select id from public.playlists limit 1`)
    for (let i = 0; i < 198; i++) {
        await social.sql(`insert into public.playlist_tracks (playlist_id, track_id, position) values ($1, $2, $3)`, [pl.id, `fill/t${i}`, 3 + i])
    }
    await page.reload()
    await page.getByTestId('playlist-add-tracks').click()
    await expect(page.getByTestId('playlist-picker-full')).toBeVisible()
    await expect(page.getByTestId('playlist-picker-row').first()).toBeDisabled()
})

test('плейлист: чужой плейлист — кнопки «Добавить треки» нет', async ({ browser }) => {
    const social = await newSocial()
    const owner = await openAs(browser, social, SECOND_USER)
    await owner.goto('/#/playlists')
    await owner.getByLabel('Название нового плейлиста').fill('Публичный')
    await owner.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(owner.getByTestId('playlist-add-tracks')).toBeVisible()
    await owner.getByTestId('playlist-public').check()
    await owner.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(owner.getByTestId('notice')).toHaveText('Сохранено')
    const url = owner.url()

    const other = await openAs(browser, social, PLAIN_USER)
    await other.goto(url)
    await expect(other.getByTestId('playlist-title')).toHaveText('Публичный')
    await expect(other.getByTestId('playlist-add-tracks')).toHaveCount(0)
})

// ── Комнаты ─────────────────────────────────────────────────────────────

test('комната: пока ничего не играет, мини-плеер — только метка; хозяин включает музыку со страницы комнаты', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, PLAIN_USER, PHONE, realtime)
    await host.goto('/#/')
    await createRoomFromMenu(host, 'Эфир')
    const roomUrl = host.url()

    // 4а. Мини-плеер: метка «Ты в комнате», на нажатия не отзывается.
    const player = host.locator('#player')
    await expect(player).toHaveClass(/mini-idle/)
    await expect(miniTitle(host)).toHaveText('Ничего не играет')
    await expect(host.getByTestId('room-chip')).toContainText('В комнате')
    await expect(host.locator('#lyrics-btn')).toBeHidden()
    await expect(player.locator('.fullscreen-trigger-btn')).toHaveCount(0)
    await miniTitle(host).click()
    await host.locator('#player-cover').click({ force: true })
    await expect(host.locator('#fullscreen-player')).not.toHaveClass(/open/)
    await expect(host.locator('#player-cover')).toHaveCSS('pointer-events', 'none')
    await host.keyboard.press('Space')
    await expect(host.locator('#fullscreen-player')).not.toHaveClass(/open/)

    // 4в. Хозяин: блок «Включить» с поиском и быстрыми вариантами.
    await expect(host.getByTestId('room-play')).toBeVisible()
    await expect(host.getByTestId('room-play-flow')).toBeVisible()
    await expect(host.getByTestId('room-play-favorites')).toBeVisible()
    await expect(host.getByTestId('room-play-release').first()).toBeVisible()
    await expect(host.getByTestId('room-now')).toHaveCount(0)

    // Гость.
    const guest = await openAs(browser, social, SECOND_USER, DESKTOP, realtime)
    await guest.goto(roomUrl)
    await guest.getByTestId('room-connect').click()
    await expect(guest.getByTestId('room-title')).toHaveText('Эфир')
    await expect(guest.getByTestId('room-play')).toHaveCount(0)

    // Поиск → выбор сразу играет у хозяина и у гостя.
    await host.getByTestId('room-play-search').fill('бильяр')
    await host.getByTestId('room-play-hit').filter({ hasText: 'Бильярд' }).click()
    await expect(miniTitle(host)).toHaveText('Бильярд')
    await expect(host.getByTestId('room-now-title')).toHaveText('Бильярд')
    await expect(guest.getByTestId('room-now-title')).toHaveText('Бильярд')
    await expect(player).not.toHaveClass(/mini-idle/)

    // 4г. Состояние — значок у обложки, без плашки «играет»; «Дальше» нет.
    for (const page of [host, guest]) {
        await expect(page.getByTestId('room-now').locator('.badge')).toHaveCount(0)
        await expect(page.getByTestId('room-now')).not.toContainText('играет')
        await expect(page.getByTestId('room-next')).toHaveCount(0)
        await expect(page.getByTestId('room-now-state')).toHaveAttribute('data-state', 'playing')
    }

    // Пауза хозяина — значок паузы у обоих.
    await host.locator('#play-pause-btn').click()
    await expect(host.getByTestId('room-now-state')).toHaveAttribute('data-state', 'paused')
    await expect(guest.getByTestId('room-now-state')).toHaveAttribute('data-state', 'paused')

    // Быстрые варианты: релиз играет с первого трека, Поток — любой трек.
    await host.getByTestId('room-play-search').fill('')
    await host.getByTestId('room-play-release').filter({ hasText: 'FAAA' }).click()
    await expect(host.getByTestId('room-now-title')).toHaveText('FAAA')
    await expect(guest.getByTestId('room-now-title')).toHaveText('FAAA')
    await host.getByTestId('room-play-favorites').click()
    await expect(host.getByTestId('notice')).toHaveText('В избранном пока пусто')
    await host.getByTestId('room-play-flow').click()
    await expect(host.getByTestId('room-now-state')).toHaveAttribute('data-state', 'playing')
})

test('комната: реакции — компактная пилюля в одну строку, без серых кругов и без налезания на линию', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    for (const viewport of [DESKTOP, PHONE]) {
        const host = await openAs(browser, social, PLAIN_USER, viewport, realtime)
        await host.goto('/#/')
        await createRoomFromMenu(host, 'Реакции')
        const buttons = host.getByTestId('rx-btn')
        await expect(buttons).toHaveCount(8)

        const geometry = await host.evaluate(() => {
            const bar = document.querySelector('.rx-bar') as HTMLElement
            const btns = [...document.querySelectorAll('[data-testid="rx-btn"]')] as HTMLElement[]
            const next = document.querySelector('.rx')!.nextElementSibling as HTMLElement
            const rect = bar.getBoundingClientRect()
            return {
                tops: new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top))).size,
                overflow: bar.scrollWidth > bar.clientWidth,
                inViewport: rect.right <= window.innerWidth && rect.left >= 0,
                gapToDivider: next.getBoundingClientRect().top - rect.bottom,
                bg: getComputedStyle(btns[0]).backgroundColor,
                border: getComputedStyle(btns[0]).borderTopWidth,
                size: btns[0].getBoundingClientRect().width,
                font: parseFloat(getComputedStyle(btns[0]).fontSize)
            }
        })
        expect(geometry.tops).toBe(1) // один ряд
        expect(geometry.overflow).toBe(false)
        expect(geometry.inViewport).toBe(true)
        expect(geometry.gapToDivider).toBeGreaterThanOrEqual(16)
        expect(geometry.bg).toBe('rgba(0, 0, 0, 0)') // без серых кругов
        expect(geometry.border).toBe('0px')
        expect(geometry.size).toBeLessThanOrEqual(40)
        expect(geometry.font).toBeLessThanOrEqual(18)
        await host.context().close()
        await social.sql('delete from public.rooms')
    }
})

// ── Админка: тот же значок ──────────────────────────────────────────────

test('админка: значок-тег в списке и карточке пользователя — по ширине текста', async ({ page }) => {
    const social = await newSocial()
    const [tag] = await social.sql<{ id: number }>(`insert into public.user_tags (name, color) values ('author', '#8855ff') returning id`)
    await social.sql('insert into public.user_tag_assignments (user_id, tag_id) values ($1, $2)', [SECOND_USER.id, tag.id])
    await installMocks(page, { social })
    await loginAs(page, OWNER_USER)
    await page.getByTestId('nav-users').click()
    const row = page.getByTestId(`user-row-${SECOND_USER.nick}`)
    await expect(row.getByTestId('user-tag')).toHaveText('author')
    await expectTagsCompact(page, 1)
    await row.click()
    await expect(page.getByTestId('user-card').getByTestId('user-tag')).toHaveText('author')
    await expectTagsCompact(page, 2)
})
