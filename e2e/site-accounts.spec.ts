import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, OWNER_USER, PLAIN_USER, SECOND_USER, installMocks, loginAs, signInSite } from './mocks'
import { techEmailSync } from './accountsMock'

// Аккаунты на сайте: стена, регистрация, вход, настройки, восстановление.
// Функции аккаунтов — настоящие обработчики на «базе» в памяти (e2e/accountsMock.ts).

const TRACK = '/#/track/zlaya-nostalgia/makanochki'

async function loginSite(page: Page, nick: string, password: string) {
    await page.getByLabel('Ник').fill(nick)
    await page.getByLabel('Пароль', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Войти' }).click()
}

test('стена: гость по ссылке на трек видит заставку, после входа — тот же трек', async ({ page }) => {
    const mocks = await installMocks(page)
    await page.goto(TRACK)
    await expect(page.getByTestId('welcome')).toBeVisible()
    await expect(page).toHaveURL(/#\/welcome\?next=\/track\/zlaya-nostalgia\/makanochki$/)
    // Без входа: ни шапки с поиском, ни плеера, ни запросов к статистике.
    await expect(page.locator('#global-search')).toHaveCount(0)
    await expect(page.locator('#audio-player')).toHaveCount(0)

    await page.getByRole('link', { name: 'Войти' }).click()
    await loginSite(page, PLAIN_USER.nick, 'wrong-password')
    await expect(page.getByRole('alert')).toHaveText('Неверный ник или пароль')
    await loginSite(page, 'нет_такого', PLAIN_USER.password)
    await expect(page.getByRole('alert')).toHaveText('Неверный ник или пароль')

    await loginSite(page, PLAIN_USER.nick.toUpperCase(), PLAIN_USER.password)
    await expect(page).toHaveURL(/#\/track\/zlaya-nostalgia\/makanochki$/)
    await expect(page.getByTestId('user-menu')).toBeVisible()
    expect(mocks.unexpected).toEqual([])
})

test('чужой адрес в ?next= не уводит с сайта', async ({ page }) => {
    await installMocks(page)
    await page.goto('/#/login?next=//evil.example/x')
    await loginSite(page, PLAIN_USER.nick, PLAIN_USER.password)
    await expect(page).toHaveURL(/localhost:\d+\/#\/$/)
})

test('регистрация: ник, пароль, капча, согласие — и сразу на сайт по ссылке', async ({ page }) => {
    const mocks = await installMocks(page)
    await page.goto(TRACK)
    await page.getByRole('link', { name: 'Зарегистрироваться' }).click()
    await expect(page.getByTestId('turnstile')).toBeVisible()

    await page.getByLabel('Ник').fill('ad')
    await page.getByLabel('Пароль', { exact: true }).fill('password1')
    await page.getByLabel('Повтор пароля').fill('password1')
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
    await expect(page.getByRole('alert')).toContainText('от 3 до 20')

    // Занятый ник — с другим регистром и похожей латиницей.
    await page.getByLabel('Ник').fill('ДPУГ') // «P» латинская
    await page.getByLabel('Согласен с тем').check()
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
    await expect(page.getByRole('alert')).toHaveText('Этот ник занят')

    await page.getByLabel('Ник').fill('Новичок')
    await page.getByLabel('Повтор пароля').fill('password2')
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
    await expect(page.getByRole('alert')).toHaveText('Пароли не совпадают')
    await page.getByLabel('Повтор пароля').fill('password1')
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click()

    // После регистрации — экран с кодом восстановления; дальше только после «Я сохранил».
    await expect(page.getByTestId('recovery-page')).toBeVisible()
    await page.getByTestId('recovery-written').check()
    await page.getByTestId('recovery-saved').click()

    await expect(page).toHaveURL(/#\/track\/zlaya-nostalgia\/makanochki$/)
    const created = [...mocks.accounts.accounts.values()].find((a) => a.nick === 'Новичок')!
    expect(created.email).toBe(techEmailSync('новичок'))
    expect(created.role).toBe('user')

    // Настройки профиля: ник; админки в меню нет.
    await page.getByTestId('user-menu').click()
    await expect(page.getByRole('menuitem', { name: 'Админка' })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Настройки' }).click()
    await expect(page.getByRole('heading', { name: 'Новичок' })).toBeVisible()
})

test('выход: на заставку, закрытые адреса снова недоступны', async ({ page }) => {
    await installMocks(page)
    await signInSite(page)
    await page.goto('/#/chart')
    await page.getByTestId('user-menu').click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()
    await expect(page.getByTestId('welcome')).toBeVisible()
    await page.goto('/#/release/zlaya-nostalgia')
    await expect(page.getByTestId('welcome')).toBeVisible()
})

test('настройки: «о себе», аватар-эмодзи и своя картинка', async ({ page }) => {
    const mocks = await installMocks(page)
    await signInSite(page)
    await page.goto('/#/me')
    const me = mocks.accounts.accounts.get(PLAIN_USER.id)!

    await page.getByRole('textbox', { name: 'О себе' }).fill('Слушаю всё подряд')
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
    await expect(page.getByText('Сохранено')).toBeVisible()
    expect(me.bio).toBe('Слушаю всё подряд')

    await page.getByRole('button', { name: 'Эмодзи 🔥' }).click()
    await expect.poll(() => me.avatar).toBe('emoji:2')

    // Своя картинка: обрезка и загрузка в свою папку бакета.
    await page.getByTestId('avatar-file').setInputFiles({
        name: 'me.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64')
    })
    const cropper = page.getByRole('dialog', { name: 'Обрезка аватара' })
    await expect(cropper).toBeVisible()
    await cropper.getByRole('button', { name: 'Сохранить' }).click()
    await expect(cropper).toHaveCount(0)
    expect(mocks.accounts.avatarUploads).toEqual([`${PLAIN_USER.id}/avatar`])
    await expect.poll(() => me.avatar).toMatch(/^upload:\d+$/)
})

test('смена пароля: нужен текущий; потом вход только с новым', async ({ page }) => {
    await installMocks(page)
    await signInSite(page)
    await page.goto('/#/me')
    await page.getByLabel('Текущий пароль').fill('не-тот-пароль')
    await page.getByLabel('Новый пароль', { exact: true }).fill('brand-new-pass')
    await page.getByLabel('Повтор нового пароля').fill('brand-new-pass')
    await page.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(page.getByText('Неверный пароль')).toBeVisible()

    await page.getByLabel('Текущий пароль').fill(PLAIN_USER.password)
    await page.getByRole('button', { name: 'Сменить пароль' }).click()
    await expect(page.getByText('Пароль изменён')).toBeVisible()

    await page.getByRole('button', { name: 'Выйти на этом устройстве' }).click()
    await page.getByRole('link', { name: 'Войти' }).click()
    await loginSite(page, PLAIN_USER.nick, PLAIN_USER.password)
    await expect(page.getByRole('alert')).toHaveText('Неверный ник или пароль')
    await loginSite(page, PLAIN_USER.nick, 'brand-new-pass')
    await expect(page.getByTestId('user-menu')).toBeVisible()
})

test('после сброса пароля админом — обязательная смена при входе, потом туда, куда шёл', async ({ page }) => {
    const mocks = await installMocks(page)
    const acc = mocks.accounts.accounts.get(SECOND_USER.id)!
    acc.password = 'temporary-12'
    acc.mustChangePassword = true

    await page.goto('/#/release/zlaya-nostalgia')
    await page.getByRole('link', { name: 'Войти' }).click()
    await loginSite(page, SECOND_USER.nick, 'temporary-12')
    await expect(page.getByRole('heading', { name: 'Придумай новый пароль' })).toBeVisible()
    // Пока пароль не сменён, никуда больше не пускает.
    await page.goto('/#/chart')
    await expect(page.getByRole('heading', { name: 'Придумай новый пароль' })).toBeVisible()

    await page.getByLabel('Новый пароль', { exact: true }).fill('temporary-12')
    await page.getByLabel('Повтор пароля').fill('temporary-12')
    await page.getByRole('button', { name: 'Сохранить и продолжить' }).click()
    await expect(page.getByRole('alert')).toContainText('отличаться от временного')

    await page.getByLabel('Новый пароль', { exact: true }).fill('my-own-pass-1')
    await page.getByLabel('Повтор пароля').fill('my-own-pass-1')
    await page.getByRole('button', { name: 'Сохранить и продолжить' }).click()
    // Последний адрес, куда человек пытался попасть, — чарт.
    await expect(page).toHaveURL(/#\/chart$/)
    await expect(page.getByRole('heading', { name: 'Чарт песен' })).toBeVisible()
    expect(acc.mustChangePassword).toBe(false)
    expect(acc.password).toBe('my-own-pass-1')
})

test('удаление аккаунта: с паролем, потом войти нельзя', async ({ page }) => {
    const mocks = await installMocks(page)
    await signInSite(page, SECOND_USER)
    await page.goto('/#/me')
    await page.getByRole('button', { name: 'Удалить аккаунт…' }).click()
    await page.getByLabel('Пароль для подтверждения').fill('wrong')
    await page.getByRole('button', { name: 'Удалить навсегда' }).click()
    await expect(page.getByRole('alert')).toHaveText('Неверный пароль')
    await page.getByLabel('Пароль для подтверждения').fill(SECOND_USER.password)
    await page.getByRole('button', { name: 'Удалить навсегда' }).click()
    await expect(page.getByTestId('welcome')).toBeVisible()
    expect(mocks.accounts.accounts.has(SECOND_USER.id)).toBe(false)
    expect(mocks.accounts.avatarRemovals).toContain(SECOND_USER.id)

    await page.getByRole('link', { name: 'Войти' }).click()
    await loginSite(page, SECOND_USER.nick, SECOND_USER.password)
    await expect(page.getByRole('alert')).toHaveText('Неверный ник или пароль')
})

test('владелец удалить свой аккаунт не может', async ({ page }) => {
    await installMocks(page)
    await signInSite(page, OWNER_USER)
    await page.goto('/#/me')
    await expect(page.getByText('Аккаунт владельца удалить нельзя.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Удалить аккаунт…' })).toHaveCount(0)
})

test('«Забыли пароль?»: одинаковый ответ для любого ника, заявка уходит владельцу', async ({ page }) => {
    const mocks = await installMocks(page)
    await page.goto('/#/')
    await page.getByRole('link', { name: 'Забыли пароль?' }).click()
    await page.getByLabel('Ник').fill(PLAIN_USER.nick)
    await page.getByRole('button', { name: 'Отправить заявку' }).click()
    await expect(page.getByRole('alert')).toContainText('как с тобой связаться')
    await page.getByLabel('Как с тобой связаться').fill('tg: @listener')
    await page.getByLabel('Комментарий (по желанию)').fill('Забыл после отпуска')
    await page.getByRole('button', { name: 'Отправить заявку' }).click()
    const sent = await page.getByTestId('recovery-sent').textContent()

    await page.goto('/#/welcome')
    await page.goto('/#/forgot')
    await page.getByLabel('Ник').fill('такого-нет')
    await page.getByLabel('Как с тобой связаться').fill('tg: @nobody')
    await page.getByRole('button', { name: 'Отправить заявку' }).click()
    await expect(page.getByTestId('recovery-sent')).toHaveText(sent!)

    expect(mocks.accounts.recovery.map((r) => [r.nick, r.user_id, r.contact])).toEqual([
        [PLAIN_USER.nick, PLAIN_USER.id, 'tg: @listener'],
        ['такого-нет', null, 'tg: @nobody']
    ])
})

test('страница «Какие данные мы храним» доступна без входа', async ({ page }) => {
    await installMocks(page)
    await page.goto('/#/privacy')
    await expect(page.getByRole('heading', { name: 'Какие данные мы храним' })).toBeVisible()
    await expect(page.getByText('Почту, телефон и настоящее имя')).toBeVisible()
})

// ── Админка ─────────────────────────────────────────────────────────────

test('админка → «Пользователи»: поиск, карточка, временный пароль, бан', async ({ page }) => {
    const mocks = await installMocks(page)
    await loginAs(page, ADMIN_USER)
    await page.getByRole('link', { name: 'Пользователи' }).click()
    await expect(page.getByTestId('users-count')).toHaveText('4 пользователя')
    await page.getByLabel('Поиск по нику').fill('слуш')
    await expect(page.getByTestId('users-count')).toHaveText('1 пользователь')
    await page.getByTestId(`user-row-${PLAIN_USER.nick}`).click()

    const card = page.getByTestId('user-card')
    await expect(card.getByRole('heading', { name: PLAIN_USER.nick })).toBeVisible()
    // Права админа выдаёт только владелец — у админа кнопки нет.
    await expect(card.getByRole('button', { name: 'Сделать админом' })).toHaveCount(0)

    await card.getByLabel('Временный пароль').fill('temp-pass-42')
    await card.getByRole('button', { name: 'Задать' }).click()
    await expect(card.getByTestId('user-notice')).toContainText('Временный пароль: temp-pass-42')
    const acc = mocks.accounts.accounts.get(PLAIN_USER.id)!
    expect(acc.password).toBe('temp-pass-42')
    expect(acc.mustChangePassword).toBe(true)

    page.once('dialog', (d) => d.accept())
    await card.getByRole('button', { name: 'Забанить' }).click()
    await expect(card.getByTestId('user-notice')).toHaveText('Забанен')
    expect(mocks.accounts.isBanned(acc)).toBe(true)
    await expect(card.getByRole('button', { name: 'Разбанить' })).toBeVisible()
})

test('админка: админ не трогает владельца и других админов; владелец выдаёт права', async ({ page }) => {
    const mocks = await installMocks(page)
    await loginAs(page, ADMIN_USER)
    await page.getByRole('link', { name: 'Пользователи' }).click()
    await page.getByTestId(`user-row-${OWNER_USER.nick}`).click()
    const card = page.getByTestId('user-card')
    await expect(card.getByText('Владельца нельзя изменить из админки')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Забанить' })).toHaveCount(0)
    await expect(card.getByLabel('Временный пароль')).toHaveCount(0)

    // Владелец: выдаёт права админа пользователю.
    await page.getByRole('button', { name: 'Выйти' }).click()
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()
    await loginAs(page, OWNER_USER)
    await page.getByRole('link', { name: 'Пользователи' }).click()
    await page.getByTestId(`user-row-${SECOND_USER.nick}`).click()
    page.once('dialog', (d) => d.accept())
    await page.getByTestId('user-card').getByRole('button', { name: 'Сделать админом' }).click()
    await expect(page.getByTestId('user-notice')).toHaveText('Теперь админ')
    expect(mocks.accounts.accounts.get(SECOND_USER.id)!.role).toBe('admin')
})

test('админка → «Заявки» (владелец): временный пароль из заявки, закрытие стирает контакт', async ({ page }) => {
    const mocks = await installMocks(page)
    await mocks.accounts.deps().db.insertRecovery({ nick: PLAIN_USER.nick, nick_key: 'x', user_id: PLAIN_USER.id, contact: 'tg: @listener', comment: 'забыл' })
    await loginAs(page, OWNER_USER)
    await expect(page.getByTestId('status-recovery')).toContainText('Новых заявок на восстановление: 1')
    await page.getByRole('link', { name: 'Заявки' }).click()
    const req = page.getByTestId('recovery-1')
    await expect(req).toContainText('tg: @listener')
    await req.getByLabel('Временный пароль').fill('from-request-1')
    await req.getByRole('button', { name: 'Задать временный пароль' }).click()
    await expect(req).toContainText('Временный пароль from-request-1 задан')
    expect(mocks.accounts.accounts.get(PLAIN_USER.id)!.password).toBe('from-request-1')

    page.once('dialog', (d) => d.accept())
    await req.getByRole('button', { name: 'Закрыть: выполнена' }).click()
    await expect(req).toContainText('выполнена')
    await expect(req).not.toContainText('tg: @listener')
    expect(mocks.accounts.recovery[0].contact).toBeNull()
})

test('админ (не владелец) заявок не видит, даже по прямой ссылке', async ({ page }) => {
    await installMocks(page)
    await loginAs(page, ADMIN_USER)
    await page.goto('/admin.html#/recovery')
    await expect(page.getByText('Заявки видит только владелец сайта.')).toBeVisible()
})
