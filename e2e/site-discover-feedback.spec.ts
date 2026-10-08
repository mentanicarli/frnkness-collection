import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, DEFAULT_USERS, PLAIN_USER, SECOND_USER, installMocks, signInSite } from './mocks'
import { SocialBackend } from './socialMock'

// Список пользователей в «Друзьях», подсказки для новичков, «Сообщить о
// проблеме» и журнал ошибок. RPC выполняются настоящими SQL-функциями
// миграции на PGlite (e2e/socialMock.ts). Каталог — только фикстура.

test.describe.configure({ timeout: 90_000 })

async function setup(page: Page) {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    const mocks = await installMocks(page, { social })
    await signInSite(page, PLAIN_USER)
    return { social, mocks }
}

const nicks = (page: Page) => page.getByTestId('discover-list').getByTestId('user-row').locator('.user-row-nick')

test('друзья: «Найти по нику» сразу показывает всех активных, без меня и забаненных; статусы и поиск на лету', async ({ page }) => {
    const { social, mocks } = await setup(page)
    await social.sql(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [ADMIN_USER.id])
    await social.sql(`insert into public.friendships (requester, addressee, status, accepted_at) values ($1, $2, 'accepted', now())`, [PLAIN_USER.id, SECOND_USER.id])

    await page.goto('/#/friends')
    await expect(page.getByTestId('discover-list')).toHaveCount(0)
    await page.getByTestId('friend-search').click()
    // Я и забаненный «Друг» не видны; остаются владелец и «Второй».
    await expect.poll(async () => (await nicks(page).allTextContents()).sort()).toEqual(['frnkness', 'Второй'].sort())
    const second = page.getByTestId('user-row').filter({ hasText: 'Второй' })
    await expect(second.getByTestId('discover-status')).toHaveText('Уже друзья')
    const owner = page.getByTestId('user-row').filter({ hasText: 'frnkness' })
    await expect(owner.getByRole('button', { name: 'Добавить в друзья' })).toBeVisible()
    await expect(page.getByTestId('user-row').filter({ hasText: 'Друг' })).toHaveCount(0)

    // Фильтр на лету.
    await page.getByTestId('friend-search').fill('вто')
    await expect(nicks(page)).toHaveText(['Второй'])
    await page.getByTestId('friend-search').fill('нет-такого')
    await expect(page.getByTestId('discover-empty')).toHaveText('Никого не нашли.')
    await page.getByTestId('friend-search').fill('')
    await expect(nicks(page)).toHaveCount(2)

    // Заявка: статус меняется сразу.
    await page.getByTestId('user-row').filter({ hasText: 'frnkness' }).getByRole('button', { name: 'Добавить в друзья' }).click()
    await expect(page.getByTestId('notice')).toHaveText('Заявка отправлена')
    await expect(page.getByTestId('user-row').filter({ hasText: 'frnkness' }).getByTestId('discover-status')).toHaveText('Заявка отправлена')
    expect(mocks.unexpected).toEqual([])
})

test('друзья: список подгружается частями при прокрутке', async ({ page }) => {
    const { social } = await setup(page)
    await social.sql(`
        with g as (select i, gen_random_uuid() as id from generate_series(1, 70) i),
        u as (
            insert into auth.users (id, email, raw_app_meta_data)
            select id, 'u-' || lpad(i::text, 32, '0') || '@id.frnkness.ru', '{}' from g returning id
        )
        insert into public.profiles (id, nick, nick_key)
        select id, 'bulk' || lpad(i::text, 3, '0'), 'bulk' || lpad(i::text, 3, '0') from g
    `)

    await page.goto('/#/friends')
    await page.getByTestId('friend-search').click()
    await expect(page.getByTestId('discover-list').getByTestId('user-row')).toHaveCount(30)
    await page.getByTestId('discover-more').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('discover-list').getByTestId('user-row')).toHaveCount(60)
    await page.getByTestId('discover-more').scrollIntoViewIfNeeded()
    // 70 новых + «Друг», «Второй», «frnkness» (владелец не забанен) = 73 других пользователя.
    await expect(page.getByTestId('discover-list').getByTestId('user-row')).toHaveCount(73)
    await expect(page.getByTestId('discover-more')).toHaveCount(0)
})

test('подсказки для новичков вместо пустых разделов — с кнопкой-действием', async ({ page }) => {
    const { mocks } = await setup(page)

    await page.goto('/#/favorites')
    await expect(page.getByTestId('empty-hint')).toContainText('Здесь будут твои любимые треки')
    await page.getByTestId('hint-flow').click()
    await expect(page.locator('#player-track')).not.toHaveText('')

    await page.goto('/#/playlists')
    await expect(page.getByTestId('empty-hint')).toContainText('Плейлистов пока нет')
    await page.getByTestId('hint-create-playlist').click()
    await expect(page.getByLabel('Название нового плейлиста')).toBeFocused()

    await page.goto('/#/feed')
    await expect(page.getByTestId('feed-empty').getByTestId('empty-hint')).toContainText('Пока тихо')
    await page.getByTestId('hint-find-friends').click()
    await expect(page).toHaveURL(/#\/friends$/)

    // «Друзья»: подсказка открывает поиск и ставит курсор в поле.
    await page.getByTestId('hint-find-friends').click()
    await expect(page.getByTestId('friend-search')).toBeFocused()
    await expect(page.getByTestId('discover-list')).toBeVisible()

    // Топ-4 на своём профиле: кнопка открывает выбор треков.
    await page.goto(`/#/u/${encodeURIComponent(PLAIN_USER.nick)}`)
    await expect(page.getByTestId('top4-empty').getByTestId('empty-hint')).toContainText('Твой топ-4 пока пуст')
    await page.getByTestId('hint-top4-pick').click()
    await expect(page.getByTestId('top4-editor')).toBeVisible()

    // На чужом профиле подсказок «как заполнить» нет.
    await page.goto(`/#/u/${encodeURIComponent(SECOND_USER.nick)}`)
    await expect(page.getByTestId('hint-top4-pick')).toHaveCount(0)
    expect(mocks.unexpected).toEqual([])
})

test('«Сообщить о проблеме»: текст, страница и браузер прикладываются, ответ «Спасибо, получили», лимит 5 в день', async ({ page }) => {
    const { social, mocks } = await setup(page)
    await page.goto('/#/track/zlaya-nostalgia/makanochki')
    const send = async (text: string) => {
        await page.getByTestId('user-menu').click()
        await page.getByTestId('menu-feedback').click()
        await page.getByTestId('feedback-text').fill(text)
        await page.getByTestId('feedback-submit').click()
    }

    await page.getByTestId('user-menu').click()
    await page.getByTestId('menu-feedback').click()
    await expect(page.getByTestId('feedback-submit')).toBeDisabled()
    await page.getByTestId('feedback-text').fill('а'.repeat(1000))
    await expect(page.getByTestId('feedback-counter')).toContainText('1000 / 1000')
    // Больше 1000 набрать нельзя.
    await page.getByTestId('feedback-text').press('End')
    await page.getByTestId('feedback-text').pressSequentially('б')
    await expect(page.getByTestId('feedback-text')).toHaveValue('а'.repeat(1000))
    await page.getByTestId('feedback-text').fill('Не играет <b>трек</b>')
    await page.getByTestId('feedback-submit').click()
    await expect(page.getByTestId('feedback-thanks')).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText('Спасибо, получили')
    await page.getByTestId('feedback-close').click()

    const rows = await social.sql<{ nick: string; message: string; page: string; browser: string; build: string }>('select nick, message, page, browser, build from public.feedback_reports')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ nick: PLAIN_USER.nick, message: 'Не играет <b>трек</b>', page: '/#/track/zlaya-nostalgia/makanochki' })
    expect(rows[0].browser).toMatch(/Chrome \d+/)
    expect(rows[0].build).toMatch(/^(dev|[0-9a-f]{7})$/)

    for (let i = 0; i < 4; i++) {
        await send(`обращение ${i}`)
        await page.getByTestId('feedback-close').click()
    }
    await send('шестое')
    await expect(page.getByTestId('feedback-error')).toContainText('много обращений')
    expect(await social.sql('select 1 from public.feedback_reports')).toHaveLength(5)
    expect(mocks.unexpected).toEqual([])
})

test('журнал ошибок: ошибка JavaScript и отказ промиса уходят в базу один раз, без паролей и токенов', async ({ page }) => {
    const { social, mocks } = await setup(page)
    await page.goto('/#/')
    await expect(page.getByTestId('user-menu')).toBeVisible()

    await page.evaluate(() => {
        setTimeout(() => {
            throw new Error('e2e boom password=hunter2')
        })
        setTimeout(() => {
            throw new Error('e2e boom password=hunter2')
        }, 20)
        void Promise.reject(new Error('e2e rejected token=SECRETTOKEN'))
    })
    await expect.poll(async () => (await social.sql('select count(*)::int as n from public.client_errors'))[0].n).toBe(2)

    const rows = await social.sql<{ message: string; stack: string; page: string; browser: string; build: string; user_id: string | null }>('select * from public.client_errors order by id')
    expect(rows.map((r) => r.message).sort()).toEqual(['e2e boom password=[скрыто]', 'e2e rejected token=[скрыто]'])
    expect(JSON.stringify(rows)).not.toMatch(/hunter2|SECRETTOKEN/)
    expect(rows[0].user_id).toBe(PLAIN_USER.id)
    expect(rows[0].page).toBe('/#/')
    expect(rows[0].browser).toMatch(/Chrome/)
    expect(rows[0].build).toMatch(/^(dev|[0-9a-f]{7})$/)
    expect(mocks.unexpected).toEqual([])
})
