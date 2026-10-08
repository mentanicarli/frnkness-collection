import { test, expect, type Browser, type Page } from '@playwright/test'
import { ADMIN_USER, DEFAULT_USERS, OWNER_USER, PLAIN_USER, SECOND_USER, installMocks, loginAs, signInSite } from './mocks'
import { SocialBackend } from './socialMock'
import type { MockUser } from './accountsMock'

// Теги пользователей: владелец создаёт и назначает в админке, значок виден на
// сайте везде, где виден ник. RPC выполняются настоящими SQL-функциями миграции
// на PGlite (e2e/socialMock.ts): «только владелец» и формат цвета проверяет база.

test.describe.configure({ timeout: 90_000 })

async function newSocial(): Promise<SocialBackend> {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    return social
}

async function adminAs(browser: Browser, social: SocialBackend, user: MockUser): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    await installMocks(page, { social })
    await loginAs(page, user)
    return page
}

async function siteAs(browser: Browser, social: SocialBackend, user: MockUser): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    await installMocks(page, { social })
    await signInSite(page, user)
    return page
}

const tagRow = (page: Page, name: string) => page.getByTestId('tag-row').filter({ has: page.locator(`input[data-testid="tag-name"]`).and(page.locator(`[value="${name}"]`)) })

test('владелец: создать, переименовать, перекрасить, удалить тег; цвет текста подбирается по фону', async ({ browser }) => {
    const social = await newSocial()
    const admin = await adminAs(browser, social, OWNER_USER)
    await admin.getByTestId('nav-tags').click()
    await expect(admin.getByTestId('tags-empty')).toBeVisible()

    // Создание: название и цвет через выбор цвета; на светлом фоне текст чёрный, на тёмном белый.
    await admin.getByTestId('tag-new-name').fill('Легенда')
    await admin.getByTestId('tag-new-color').fill('#ffd700')
    await expect(admin.getByTestId('tag-new-preview')).toHaveCSS('color', 'rgb(0, 0, 0)')
    await admin.getByTestId('tag-new-color').fill('#101040')
    await expect(admin.getByTestId('tag-new-preview')).toHaveCSS('color', 'rgb(255, 255, 255)')
    await admin.getByTestId('tag-create').click()
    await expect(admin.getByTestId('tag-row')).toHaveCount(1)
    expect(await social.sql('select name, color from public.user_tags')).toEqual([{ name: 'Легенда', color: '#101040' }])

    // Название — до 20 символов, дубликат запрещён.
    await expect(admin.getByTestId('tag-new-name')).toHaveAttribute('maxlength', '20')
    await admin.getByTestId('tag-new-name').fill('легенда')
    await admin.getByTestId('tag-create').click()
    await expect(admin.getByTestId('tags-error')).toContainText('уже есть')

    // Переименование и перекраска.
    const row = admin.getByTestId('tag-row').first()
    await row.getByTestId('tag-name').fill('Суперлегенда')
    await row.getByTestId('tag-color').fill('#ffffff')
    await row.getByTestId('tag-save').click()
    await expect.poll(() => social.sql('select name, color from public.user_tags')).toEqual([{ name: 'Суперлегенда', color: '#ffffff' }])

    // Удаление с подтверждением.
    admin.on('dialog', (d) => void d.accept())
    await admin.getByTestId('tag-row').first().getByTestId('tag-delete').click()
    await expect(admin.getByTestId('tags-empty')).toBeVisible()
    expect(await social.sql('select 1 from public.user_tags')).toHaveLength(0)
})

test('назначение в карточке пользователя; значок виден на сайте везде, где виден ник; изменения и удаление доходят до всех', async ({ browser }) => {
    const social = await newSocial()
    await social.sql(`insert into public.friendships (requester, addressee, status, accepted_at) values ($1, $2, 'accepted', now())`, [PLAIN_USER.id, SECOND_USER.id])
    const admin = await adminAs(browser, social, OWNER_USER)

    await admin.getByTestId('nav-tags').click()
    await admin.getByTestId('tag-new-name').fill('Друг сайта')
    await admin.getByTestId('tag-new-color').fill('#ff8800')
    await admin.getByTestId('tag-create').click()
    await expect(admin.getByTestId('tag-row')).toHaveCount(1)

    // В карточке — выбор тега из списка или «без тега».
    await admin.getByTestId('nav-users').click()
    await admin.getByTestId(`user-row-${SECOND_USER.nick}`).click()
    await expect(admin.getByTestId('user-tag-select')).toBeVisible()
    await admin.getByTestId('user-tag-select').selectOption({ label: 'Друг сайта' })
    await expect(admin.getByTestId('user-notice')).toHaveText('Тег назначен')
    await expect(admin.getByTestId('user-card').getByTestId('user-tag')).toHaveText('Друг сайта')
    expect(await social.sql('select user_id from public.user_tag_assignments')).toEqual([{ user_id: SECOND_USER.id }])

    // Сайт: тег виден у «Второго» в списке пользователей, друзей, профиле и ленте; у других тега нет.
    const me = await siteAs(browser, social, PLAIN_USER)
    await me.goto('/#/friends')
    await me.getByTestId('friend-search').click()
    const found = (name: string) => me.getByTestId('discover-list').getByTestId('user-row').filter({ hasText: name })
    const second = found(SECOND_USER.nick)
    await expect(second.getByTestId('user-tag')).toHaveText('Друг сайта')
    await expect(second.getByTestId('user-tag')).toHaveCSS('background-color', 'rgb(255, 136, 0)')
    // Оранжевый #ff8800 светлее середины: текст чёрный.
    await expect(second.getByTestId('user-tag')).toHaveCSS('color', 'rgb(0, 0, 0)')
    await expect(found(OWNER_USER.nick).getByTestId('user-tag')).toHaveCount(0)
    await me.goto(`/#/u/${encodeURIComponent(SECOND_USER.nick)}`)
    await expect(me.locator('.profile-nick').getByTestId('user-tag')).toHaveText('Друг сайта')
    await social.sql(`insert into public.favorites (user_id, track_id) values ($1, 'faaa/faaa')`, [SECOND_USER.id])
    await me.goto('/#/feed')
    await expect(me.getByTestId('feed-item').first().getByTestId('user-tag')).toHaveText('Друг сайта')
    await me.goto('/#/friends')
    await expect(me.getByRole('region', { name: /Мои друзья/ }).getByTestId('user-tag')).toHaveText('Друг сайта')

    // «Второй» у себя тоже видит свой тег (меню и профиль).
    const other = await siteAs(browser, social, SECOND_USER)
    await other.goto('/#/me')
    await expect(other.locator('.profile-nick').getByTestId('user-tag')).toHaveText('Друг сайта')

    // Переименование и перекраска — после обновления у всех новое.
    await admin.getByTestId('nav-tags').click()
    const row = admin.getByTestId('tag-row').first()
    await row.getByTestId('tag-name').fill('Легенда');
    await row.getByTestId('tag-color').fill('#000080')
    await row.getByTestId('tag-save').click()
    await expect.poll(() => social.sql('select name from public.user_tags')).toEqual([{ name: 'Легенда' }])
    await me.reload()
    await me.getByTestId('friend-search').click()
    await expect(found(SECOND_USER.nick).getByTestId('user-tag')).toHaveText('Легенда')
    await expect(found(SECOND_USER.nick).getByTestId('user-tag')).toHaveCSS('color', 'rgb(255, 255, 255)')

    // Удаление снимает тег со всех.
    admin.on('dialog', (d) => void d.accept())
    await row.getByTestId('tag-delete').click()
    await expect(admin.getByTestId('tags-empty')).toBeVisible()
    expect(await social.sql('select 1 from public.user_tag_assignments')).toHaveLength(0)
    await me.reload()
    await me.getByTestId('friend-search').click()
    await expect(found(SECOND_USER.nick)).toBeVisible()
    await expect(me.getByTestId('user-tag')).toHaveCount(0)
})

test('снять тег: «без тега» в карточке', async ({ browser }) => {
    const social = await newSocial()
    const admin = await adminAs(browser, social, OWNER_USER)
    await admin.getByTestId('nav-tags').click()
    await admin.getByTestId('tag-new-name').fill('VIP')
    await admin.getByTestId('tag-create').click()
    await expect(admin.getByTestId('tag-row')).toHaveCount(1)
    await admin.getByTestId('nav-users').click()
    await admin.getByTestId(`user-row-${PLAIN_USER.nick}`).click()
    await admin.getByTestId('user-tag-select').selectOption({ label: 'VIP' })
    await expect(admin.getByTestId('user-notice')).toHaveText('Тег назначен')
    await admin.getByTestId('user-tag-select').selectOption({ label: 'без тега' })
    await expect(admin.getByTestId('user-notice')).toHaveText('Тег снят')
    expect(await social.sql('select 1 from public.user_tag_assignments')).toHaveLength(0)
})

test('админ (не владелец): раздела «Теги» и выбора тега нет, а прямой вызов база отклоняет', async ({ browser }) => {
    const social = await newSocial()
    const tag = await social.sql<{ id: number }>(`insert into public.user_tags (name, color) values ('VIP', '#112233') returning id`)
    const admin = await adminAs(browser, social, ADMIN_USER)
    await expect(admin.getByTestId('nav-tags')).toHaveCount(0)
    await admin.goto('/admin.html#/tags')
    await expect(admin.getByText('Теги настраивает только владелец сайта.')).toBeVisible()

    await admin.getByTestId('nav-users').click()
    await admin.getByTestId(`user-row-${PLAIN_USER.nick}`).click()
    await expect(admin.getByTestId('user-card')).toBeVisible()
    await expect(admin.getByTestId('user-tag-field')).toHaveCount(0)

    // Даже если вызвать функцию мимо интерфейса — база отвечает «Нет доступа».
    const answer = await admin.evaluate(async (id) => {
        const { supabase } = (await import('/src/supabaseClient.ts')) as { supabase: { rpc: (n: string, a: unknown) => Promise<{ error: { message: string } | null }> } }
        const res = await supabase.rpc('owner_user_set_tag', { p_user: '00000000-0000-4000-8000-000000000003', p_tag: id })
        return res.error?.message ?? 'ok'
    }, tag[0].id)
    expect(answer).toBe('Нет доступа')
    expect(await social.sql('select 1 from public.user_tag_assignments')).toHaveLength(0)
})

test('тег ничего не даёт в правах: обычный пользователь с тегом в админку не попадает', async ({ browser }) => {
    const social = await newSocial()
    const [tag] = await social.sql<{ id: number }>(`insert into public.user_tags (name, color) values ('VIP', '#112233') returning id`)
    await social.sql('insert into public.user_tag_assignments (user_id, tag_id) values ($1, $2)', [PLAIN_USER.id, tag.id])
    const page = await siteAs(browser, social, PLAIN_USER)
    await page.goto('/#/')
    await page.getByTestId('user-menu').click()
    await expect(page.getByTestId('user-menu').locator('xpath=..').getByTestId('user-tag')).toHaveText('VIP')
    await expect(page.getByRole('menuitem', { name: 'Админка' })).toHaveCount(0)
})

test('название тега выводится как текст, разметка не выполняется', async ({ browser }) => {
    const social = await newSocial()
    const [tag] = await social.sql<{ id: number }>(`insert into public.user_tags (name, color) values ('<b>x</b>', '#112233') returning id`)
    await social.sql('insert into public.user_tag_assignments (user_id, tag_id) values ($1, $2)', [SECOND_USER.id, tag.id])
    const me = await siteAs(browser, social, PLAIN_USER)
    await me.goto('/#/friends')
    await me.getByTestId('friend-search').click()
    const row = me.getByTestId('discover-list').getByTestId('user-row').filter({ hasText: SECOND_USER.nick })
    await expect(row.getByTestId('user-tag')).toHaveText('<b>x</b>')
    await expect(row.locator('b')).toHaveCount(0)
})
