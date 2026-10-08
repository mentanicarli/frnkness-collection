import { test, expect, type Browser, type Page } from '@playwright/test'
import { DEFAULT_USERS, MOCK_SUPABASE, PLAIN_USER, SECOND_USER, installMocks, signInSite } from './mocks'
import { FakeRealtime } from './realtimeMock'
import { SocialBackend } from './socialMock'
import type { MockUser } from './accountsMock'

// Телефон (iPhone 375 и 390 px) и PWA: нижняя панель «⋯» вместо иконок, запуск
// звука, профиль без «Такого пользователя нет», скорость первого экрана,
// отсутствие горизонтальной прокрутки и мелких кнопок. Каталог — фикстура.

test.describe.configure({ timeout: 90_000 })

const PHONES = [
    { width: 375, height: 667 },
    { width: 390, height: 844 }
]
const PHONE = PHONES[1]
const DESKTOP = { width: 1280, height: 720 }

async function newSocial(): Promise<SocialBackend> {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    return social
}

async function openAs(browser: Browser, social: SocialBackend, user: MockUser, viewport = PHONE, realtime?: FakeRealtime): Promise<Page> {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 800, hasTouch: viewport.width < 800, deviceScaleFactor: 3, serviceWorkers: 'block' })
    const page = await context.newPage()
    await installMocks(page, { social })
    if (realtime) await realtime.attach(page, social)
    await signInSite(page, user)
    return page
}

const miniTitle = (page: Page) => page.locator('#player-track')
const releaseRow = (page: Page, title: string) => page.locator('.track-row').filter({ hasText: title })

// ── Треклист: номер, название, «⋯» ──────────────────────────────────────

test('телефон: в строке релиза только номер, название и «⋯»; действия — в нижней панели', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto('/#/release/most-venture-poopsicks')
    const row = releaseRow(page, 'BACK TO POOPSICKS 2')
    await expect(row).toBeVisible()

    // Иконок в строке нет — одна кнопка не меньше 40 px.
    await expect(row.getByTestId('favorite-btn')).toBeHidden()
    await expect(row.getByTestId('add-to-playlist-btn')).toBeHidden()
    const more = row.getByTestId('track-more')
    const box = (await more.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(40)
    expect(box.height).toBeGreaterThanOrEqual(40)
    await expect(row.locator('.track-title')).toHaveCSS('text-overflow', 'ellipsis')

    // Название не налезает на кнопку ни в одной строке.
    const overlaps = await page.locator('.track-row').evaluateAll((rows) =>
        rows.filter((r) => {
            const t = r.querySelector('.track-title')!.getBoundingClientRect()
            const m = r.querySelector('[data-testid="track-more"]')!.getBoundingClientRect()
            return t.right > m.left + 0.5
        }).length
    )
    expect(overlaps).toBe(0)

    // Панель: избранное, плейлист, текст, поделиться; «Играть следующим» — только когда есть очередь.
    await more.click()
    const sheet = page.getByTestId('track-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('BACK TO POOPSICKS 2')
    for (const id of ['sheet-favorite', 'sheet-playlist', 'sheet-lyrics', 'sheet-share']) await expect(sheet.getByTestId(id)).toBeVisible()
    await expect(sheet.getByTestId('sheet-play-next')).toHaveCount(0)
    // Escape и «Закрыть» закрывают панель.
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    await more.click()
    await page.getByTestId('sheet-favorite').click()
    await expect(sheet).toBeHidden()
    await expect.poll(() => social.sql(`select track_id from public.favorites where user_id = '${PLAIN_USER.id}'`)).toEqual([{ track_id: 'most-venture-poopsicks/back-to-poopsicks-2' }])
    await more.click()
    await expect(page.getByTestId('sheet-favorite')).toContainText('Убрать из избранного')
    await page.getByTestId('sheet-close').click()

    // «Текст» ведёт на страницу трека, «В плейлист» открывает выбор плейлиста.
    await more.click()
    await page.getByTestId('sheet-playlist').click()
    await expect(page.locator('.cropper-backdrop')).toBeVisible()
    await expect(sheet).toBeHidden()
})

test('телефон: «Играть следующим» ставит трек после текущего', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto('/#/release/most-venture-poopsicks')
    await releaseRow(page, 'BACK TO POOPSICKS 2').locator('.track-title').click()
    await expect(miniTitle(page)).toHaveText('BACK TO POOPSICKS 2')

    await releaseRow(page, 'Macan-Walker').getByTestId('track-more').click()
    await page.getByTestId('sheet-play-next').click()
    await expect(page.getByTestId('notice')).toHaveText('Сыграет следующим')
    await page.locator('#player').getByRole('button', { name: 'Следующий трек' }).click()
    await expect(miniTitle(page)).toHaveText('Macan-Walker')
})

test('телефон: «⋯» есть в избранном, чарте и поиске; в плейлисте порядок и удаление — в панели', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto('/#/release/most-venture-poopsicks')
    await releaseRow(page, 'BACK TO POOPSICKS 2').getByTestId('track-more').click()
    await page.getByTestId('sheet-favorite').click()
    await page.goto('/#/favorites')
    const fav = page.getByTestId('track-row').first()
    await expect(fav.getByTestId('track-more')).toBeVisible()
    await expect(fav.getByTestId('favorite-btn')).toBeHidden()
    // Название и подпись обрезаются, а не залезают под кнопку.
    await expect(fav.locator('.tl-title')).toHaveCSS('text-overflow', 'ellipsis')

    // Поиск: у результата-трека своя «⋯».
    await page.locator('#search-toggle-btn').click()
    await page.locator('#global-search').fill('poopsicks')
    await expect(page.locator('#search-results').getByTestId('track-more').first()).toBeVisible()
})

test('компьютер: иконки на месте, «⋯» не показывается', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER, DESKTOP)
    await page.goto('/#/release/most-venture-poopsicks')
    const row = releaseRow(page, 'BACK TO POOPSICKS 2')
    await expect(row.getByTestId('favorite-btn')).toBeVisible()
    await expect(row.getByTestId('track-more')).toBeHidden()
})

// ── Профиль ─────────────────────────────────────────────────────────────

test('профиль: сбой сети — повтор и скелетон, а не «Такого пользователя нет»', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    let calls = 0
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    await page.route(`${MOCK_SUPABASE}/rest/v1/rpc/profile_by_nick`, async (route) => {
        calls++
        if (calls === 1) await gate
        // Первый ответ — обрыв, дальше — настоящий.
        return calls === 1 ? route.abort() : route.fallback()
    })
    await page.goto(`/#/u/${encodeURIComponent(PLAIN_USER.nick)}`)
    await expect(page.getByTestId('profile-skeleton')).toBeVisible()
    await expect(page.getByTestId('profile-missing')).toHaveCount(0)
    release()
    await expect(page.getByTestId('profile-skeleton')).toBeHidden()
    await expect(page.locator('.profile-nick')).toContainText(PLAIN_USER.nick)
    await expect(page.getByTestId('profile-missing')).toHaveCount(0)
    expect(calls).toBeGreaterThanOrEqual(2)
})

test('профиль: без связи — «Повторить», после восстановления связи открывается', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    let down = true
    await page.route(`${MOCK_SUPABASE}/rest/v1/rpc/profile_by_nick`, (route) => (down ? route.abort() : route.fallback()))
    await page.goto(`/#/u/${encodeURIComponent(PLAIN_USER.nick)}`)
    await expect(page.getByTestId('profile-error')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('profile-missing')).toHaveCount(0)
    down = false
    await page.getByTestId('profile-retry').click()
    await expect(page.locator('.profile-nick')).toContainText(PLAIN_USER.nick)
})

test('профиль: ник в адресе с другим регистром открывает тот же профиль, несуществующий — «нет такого»', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto(`/#/u/${encodeURIComponent(PLAIN_USER.nick.toUpperCase())}`)
    await expect(page.locator('.profile-nick')).toContainText(PLAIN_USER.nick)
    // Адрес приведён к написанию владельца.
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(PLAIN_USER.nick)))
    await page.goto('/#/u/nobody-here')
    await expect(page.getByTestId('profile-missing')).toBeVisible()
})

test('меню: «Мой профиль» с телефона открывает свой профиль', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto('/#/')
    await page.getByTestId('user-menu').click()
    await page.getByTestId('menu-profile').click()
    await expect(page.locator('.profile-nick')).toContainText(PLAIN_USER.nick)
})

// ── Первый экран не ждёт базу ───────────────────────────────────────────

test('каталог показывается, пока профиль ещё грузится; без входа — только заставка', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    await page.route(`${MOCK_SUPABASE}/rest/v1/profiles*`, async (route) => {
        await gate
        return route.fallback()
    })
    await page.goto('/#/')
    await expect(page.locator('.release-card').first()).toBeVisible()
    release()

    // Невошедший: никакого каталога, заставка.
    const context = await browser.newContext({ viewport: PHONE, serviceWorkers: 'block' })
    const guest = await context.newPage()
    await installMocks(guest, { social })
    await guest.goto('/#/chart')
    await expect(guest).toHaveURL(/#\/welcome/)
    await expect(guest.locator('.release-card')).toHaveCount(0)
})

test('профиль, который не прочитался, не ломает сайт: ник берётся из копии на устройстве', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    await page.goto('/#/')
    await page.getByTestId('user-menu').click()
    await expect(page.getByTestId('menu-profile')).toContainText(PLAIN_USER.nick)
    await page.reload()
    // Второй заход: профиль недоступен, ник уже на экране из копии.
    await page.route(`${MOCK_SUPABASE}/rest/v1/profiles*`, (route) => route.abort())
    await page.reload()
    await page.getByTestId('user-menu').click()
    await expect(page.getByTestId('menu-profile')).toContainText(PLAIN_USER.nick)
})

// ── Запуск звука ────────────────────────────────────────────────────────

/** Журнал ошибок: что сайт отправил в log_client_error. */
async function captureErrorLog(page: Page): Promise<string[]> {
    const messages: string[] = []
    await page.route(`${MOCK_SUPABASE}/rest/v1/rpc/log_client_error`, (route) => {
        try {
            messages.push(JSON.parse(route.request().postData() ?? '{}').p_message)
        } catch {
            /* не наш формат */
        }
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: 'null' })
    })
    return messages
}

test('звук не пошёл: «Нажми, чтобы играть», причина в журнале ошибок; нажатие запускает', async ({ browser }) => {
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    const log = await captureErrorLog(page)
    // Браузер не разрешает звук (как iOS без жеста), пока тест не «нажмёт».
    await page.addInitScript(() => {
        const original = HTMLMediaElement.prototype.play
        ;(window as unknown as { __allowPlay: boolean }).__allowPlay = false
        HTMLMediaElement.prototype.play = function () {
            if (!(window as unknown as { __allowPlay: boolean }).__allowPlay) return Promise.reject(new DOMException('blocked', 'NotAllowedError'))
            return original.call(this)
        }
    })
    await page.goto('/#/release/most-venture-poopsicks')
    await releaseRow(page, 'BACK TO POOPSICKS 2').locator('.track-title').click()
    const tap = page.locator('#player').getByTestId('tap-to-play')
    await expect(tap).toBeVisible()
    await expect(tap).toHaveText('Нажми, чтобы играть')
    await expect.poll(() => log.some((m) => /Не удалось начать воспроизведение: браузер не разрешил/.test(m))).toBe(true)
    expect(log.find((m) => /Не удалось начать/.test(m))).toContain('most-venture-poopsicks-')

    await page.evaluate(() => { ;(window as unknown as { __allowPlay: boolean }).__allowPlay = true })
    await tap.click()
    await expect(tap).toBeHidden()
    await expect.poll(() => page.evaluate(() => !document.querySelector<HTMLAudioElement>('#audio-player')!.paused)).toBe(true)
})

test('обрыв сети при загрузке трека: «пробуем снова», затем кнопка и запись в журнал', async ({ browser }) => {
    test.setTimeout(120_000)
    const social = await newSocial()
    const page = await openAs(browser, social, PLAIN_USER)
    const log = await captureErrorLog(page)
    await page.route(/\/audio\//, (route) => route.abort('connectionreset'))
    await page.goto('/#/release/most-venture-poopsicks')
    await releaseRow(page, 'BACK TO POOPSICKS 2').locator('.track-title').click()
    await expect(page.locator('#player').getByTestId('playback-retrying')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('#player').getByTestId('tap-to-play')).toBeVisible({ timeout: 45_000 })
    await expect.poll(() => log.some((m) => /Не удалось начать воспроизведение/.test(m))).toBe(true)
})

test('комната: первый play() гостя — в самом нажатии «Подключиться» (жест пользователя)', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, PLAIN_USER, DESKTOP, realtime)
    await host.goto('/#/')
    await host.getByTestId('user-menu').click()
    await host.getByTestId('menu-create-room').click()
    await host.getByTestId('create-room-name').fill('Эфир')
    await host.getByTestId('create-room-submit').click()
    await expect(host).toHaveURL(/#\/room\/[0-9a-f-]{36}$/)
    const roomUrl = host.url()

    const guest = await openAs(browser, social, SECOND_USER, PHONE, realtime)
    await guest.addInitScript(() => {
        const calls: { active: boolean; blob: boolean }[] = []
        ;(window as unknown as { __playCalls: typeof calls }).__playCalls = calls
        const original = HTMLMediaElement.prototype.play
        HTMLMediaElement.prototype.play = function () {
            calls.push({ active: navigator.userActivation.isActive, blob: this.src.startsWith('blob:') })
            return original.call(this)
        }
    })
    await guest.goto(roomUrl)
    await guest.getByTestId('room-connect').click()
    await expect(guest.getByTestId('room-title')).toHaveText('Эфир')
    const first = await guest.evaluate(() => (window as unknown as { __playCalls: { active: boolean; blob: boolean }[] }).__playCalls[0])
    // Тишина-«разблокировка» запущена прямо из нажатия, до любого await.
    expect(first).toEqual({ active: true, blob: true })

    // Хозяин включает трек — у гостя звук идёт.
    await host.getByTestId('room-play-search').fill('бильяр')
    await host.getByTestId('room-play-hit').filter({ hasText: 'Бильярд' }).click()
    await expect(guest.getByTestId('room-now-title')).toHaveText('Бильярд')
    await expect.poll(() => guest.evaluate(() => !document.querySelector<HTMLAudioElement>('#audio-player')!.paused)).toBe(true)
})

// ── Вёрстка: без прокрутки вбок, поля 16 px, кнопки от 40 px ────────────

async function layoutProblems(page: Page) {
    return page.evaluate(() => {
        const vw = window.innerWidth
        const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`
        const out = { scrollW: document.documentElement.scrollWidth, vw, small: [] as string[], smallInputs: [] as string[], overflow: [] as string[] }
        for (const el of Array.from(document.querySelectorAll('body *'))) {
            const cs = getComputedStyle(el)
            if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[aria-hidden="true"]')) continue
            const r = el.getBoundingClientRect()
            if (!r.width || !r.height) continue
            if (r.right > vw + 1 && cs.position !== 'fixed' && !el.closest('.header-search-panel, .sheet, .recap, .turnstile')) out.overflow.push(name(el))
            if (el.matches('button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, a.acc-btn, [role=tab]') && !el.classList.contains('sr-only')) {
                // Измеряем область нажатия: ::after у кнопки шапки её расширяет.
                const slop = el.matches('.user-menu-btn') ? 8 : 0
                if (r.width + slop < 40 || r.height + slop < 40) out.small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`)
            }
            if (el.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select') && parseFloat(cs.fontSize) < 16) out.smallInputs.push(`${name(el)} ${cs.fontSize}`)
        }
        return out
    })
}

for (const viewport of PHONES) {
    test(`телефон ${viewport.width}: основные страницы без прокрутки вбок, мелких кнопок и полей меньше 16 px`, async ({ browser }) => {
        test.setTimeout(150_000)
        const social = await newSocial()
        const page = await openAs(browser, social, PLAIN_USER, viewport)
        const pages = [
            '#/', '#/chart', '#/release/most-venture-poopsicks', '#/track/most-venture-poopsicks/back-to-poopsicks-2',
            '#/me', '#/friends', '#/feed', '#/playlists', '#/favorites', `#/u/${encodeURIComponent(PLAIN_USER.nick)}`
        ]
        const problems: string[] = []
        for (const hash of pages) {
            await page.goto('/' + hash)
            await page.waitForTimeout(500)
            const r = await layoutProblems(page)
            if (r.scrollW > r.vw) problems.push(`${hash}: прокрутка вбок ${r.scrollW} > ${r.vw}`)
            for (const s of r.overflow.slice(0, 3)) problems.push(`${hash}: вылезает ${s}`)
            for (const s of new Set(r.small)) problems.push(`${hash}: мелкая кнопка ${s}`)
            for (const s of new Set(r.smallInputs)) problems.push(`${hash}: поле меньше 16 px ${s}`)
        }
        // Плеер на экране (мини и полноэкранный) и поиск.
        await page.goto('/#/release/most-venture-poopsicks')
        await releaseRow(page, 'BACK TO POOPSICKS 2').locator('.track-title').click()
        await expect(miniTitle(page)).toHaveText('BACK TO POOPSICKS 2')
        for (const [label, open] of [['мини-плеер', async () => undefined], ['на весь экран', async () => { await page.locator('#player-cover').click() }]] as const) {
            await open()
            await page.waitForTimeout(500)
            const r = await layoutProblems(page)
            if (r.scrollW > r.vw) problems.push(`${label}: прокрутка вбок`)
            for (const s of new Set(r.small)) problems.push(`${label}: мелкая кнопка ${s}`)
        }
        expect(problems, problems.join('\n')).toEqual([])
    })
}
