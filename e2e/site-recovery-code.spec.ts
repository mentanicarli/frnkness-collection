import { test, expect, type Page } from '@playwright/test'
import { PLAIN_USER, installMocks, signInSite } from './mocks'

// Код восстановления: выдача при регистрации (экран нельзя пропустить), создание
// в настройках, вход по коду (пароль меняется, код сгорает, сеансы завершаются),
// защита от перебора. Функции аккаунтов — настоящие обработчики (e2e/accountsMock.ts).

const CODE_RE = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/

async function registerUser(page: Page, nick: string, password = 'password1', next = '') {
    await page.goto(`/#/register${next}`)
    await page.getByLabel('Ник').fill(nick)
    await page.getByLabel('Пароль', { exact: true }).fill(password)
    await page.getByLabel('Повтор пароля').fill(password)
    await page.getByLabel('Согласен с тем').check()
    await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
    await expect(page.getByTestId('recovery-page')).toBeVisible()
    const code = (await page.getByTestId('recovery-code').textContent())!.trim()
    expect(code).toMatch(CODE_RE)
    return code
}

async function logout(page: Page) {
    await page.getByTestId('user-menu').click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()
    await expect(page.getByTestId('welcome')).toBeVisible()
}

async function openCodeForm(page: Page) {
    await page.goto('/#/forgot')
    await page.getByTestId('mode-code').click()
}

async function submitCode(page: Page, v: { nick: string; code: string; password: string }) {
    await page.getByTestId('code-nick').fill(v.nick)
    await page.getByTestId('code-input').fill(v.code)
    await page.getByTestId('code-password').fill(v.password)
    await page.getByTestId('code-password2').fill(v.password)
    await page.getByTestId('code-submit').click()
}

test('после регистрации код нельзя пропустить: «Я сохранил» — только после копирования, сайт закрыт до этого', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const mocks = await installMocks(page)
    const code = await registerUser(page, 'Новичок', 'password1', '?next=/track/zlaya-nostalgia/makanochki')

    // В «базе» только хеш: открытого кода там нет.
    const stored = [...mocks.accounts.codes.values()]
    expect(stored).toHaveLength(1)
    expect(stored[0].hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(stored)).not.toContain(code.replace(/-/g, ''))

    // Пока не скопировано — «Я сохранил» недоступно; другие адреса уводят обратно.
    await expect(page.getByTestId('recovery-saved')).toBeDisabled()
    await page.goto('/#/friends')
    await expect(page.getByTestId('recovery-page')).toBeVisible()
    await expect(page.getByTestId('recovery-saved')).toBeDisabled()

    // Обновили страницу — код не теряется бесследно: выдан новый (старый отменён).
    const before = (await page.getByTestId('recovery-code').textContent())!.trim()
    await page.reload()
    await expect(page.getByTestId('recovery-page')).toBeVisible()
    const minted = (await page.getByTestId('recovery-code').textContent())!.trim()
    expect(minted).toMatch(CODE_RE)
    expect(minted).not.toBe(before)
    expect(mocks.accounts.codes.size).toBe(1)
    expect(code).not.toBe(minted)

    await page.getByTestId('recovery-copy').click()
    await expect(page.getByTestId('recovery-copy')).toHaveText('Скопировано')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(minted)
    await expect(page.getByTestId('recovery-saved')).toBeEnabled()
    await page.getByTestId('recovery-saved').click()

    await expect(page.getByTestId('user-menu')).toBeVisible()
    await expect(page).toHaveURL(/#\/(friends|)$/)
    expect([...mocks.accounts.codes.values()][0].confirmed).toBe(true)
    // Теперь сайт открыт и экран кода без дела уводит прочь.
    await page.goto('/#/recovery-code')
    await expect(page).not.toHaveURL(/recovery-code/)
    expect(mocks.unexpected).toEqual([])
})

test('вход по коду: пароль меняется, код сгорает, сеансы завершаются; затем предложение нового кода («Позже»)', async ({ page }) => {
    const mocks = await installMocks(page)
    const code = await registerUser(page, 'Забывчивый')
    await page.getByTestId('recovery-written').check()
    await page.getByTestId('recovery-saved').click()
    await expect(page.getByTestId('user-menu')).toBeVisible()
    const id = [...mocks.accounts.accounts.values()].find((a) => a.nick === 'Забывчивый')!.id

    // Выходим и забываем пароль.
    await logout(page)
    await openCodeForm(page)
    // Код вводится как удобно: строчными, без дефисов.
    await submitCode(page, { nick: 'ЗАБЫВЧИВЫЙ', code: code.replace(/-/g, '').toLowerCase(), password: 'brand-new-pass' })

    // Предложение создать новый код; «Позже» — на сайт.
    await expect(page.getByTestId('recovery-later')).toBeVisible()
    expect(mocks.accounts.accounts.get(id)!.password).toBe('brand-new-pass')
    expect(mocks.accounts.signedOut).toContain(id)
    expect(mocks.accounts.codes.has(id)).toBe(false)
    await page.getByTestId('recovery-later').click()
    await expect(page.getByTestId('user-menu')).toBeVisible()

    // Тот же код второй раз — отказ (одноразовый).
    await logout(page)
    await openCodeForm(page)
    await submitCode(page, { nick: 'Забывчивый', code, password: 'another-pass-1' })
    await expect(page.getByTestId('code-error')).toHaveText('Неверный ник или код')
    expect(mocks.accounts.accounts.get(id)!.password).toBe('brand-new-pass')
    expect(mocks.unexpected).toEqual([])
})

test('после входа по коду можно создать новый код: пароль, код, «Я сохранил»', async ({ page }) => {
    const mocks = await installMocks(page)
    const code = await registerUser(page, 'Забывчивый')
    await page.getByTestId('recovery-written').check()
    await page.getByTestId('recovery-saved').click()
    await logout(page)
    await openCodeForm(page)
    await submitCode(page, { nick: 'Забывчивый', code, password: 'brand-new-pass' })

    await page.getByTestId('recovery-offer-password').fill('brand-new-pass')
    await page.getByTestId('recovery-offer-create').click()
    const fresh = (await page.getByTestId('recovery-code').textContent())!.trim()
    expect(fresh).toMatch(CODE_RE)
    expect(fresh).not.toBe(code)
    await page.getByTestId('recovery-written').check()
    await page.getByTestId('recovery-saved').click()
    await expect(page.getByTestId('user-menu')).toBeVisible()
    expect([...mocks.accounts.codes.values()]).toHaveLength(1)
})

test('неверный ник и неверный код — одинаковый ответ; ни то, ни другое код не сжигает', async ({ page }) => {
    const mocks = await installMocks(page)
    const code = await registerUser(page, 'Забывчивый')
    await page.getByTestId('recovery-written').check()
    await page.getByTestId('recovery-saved').click()
    await logout(page)
    await openCodeForm(page)

    await submitCode(page, { nick: 'нет_такого', code, password: 'brand-new-pass' })
    const wrongNick = await page.getByTestId('code-error').textContent()
    await submitCode(page, { nick: 'Забывчивый', code: 'AAAA-BBBB-CCCC-DDDD', password: 'brand-new-pass' })
    await expect(page.getByTestId('code-error')).toHaveText(wrongNick!)
    expect(wrongNick).toBe('Неверный ник или код')
    expect(mocks.accounts.codes.size).toBe(1)

    // Валидация на странице: пароли не совпадают, пусто.
    await page.getByTestId('code-password2').fill('different')
    await page.getByTestId('code-submit').click()
    await expect(page.getByTestId('code-error')).toHaveText('Пароли не совпадают')
})

test('перебор: после 5 неверных попыток на ник даже верный код отклоняется', async ({ page }) => {
    const mocks = await installMocks(page)
    const code = await registerUser(page, 'Забывчивый')
    await page.getByTestId('recovery-written').check()
    await page.getByTestId('recovery-saved').click()
    await logout(page)
    await openCodeForm(page)

    for (let i = 0; i < 5; i++) {
        await submitCode(page, { nick: 'Забывчивый', code: 'AAAA-BBBB-CCCC-DDDD', password: 'brand-new-pass' })
        await expect(page.getByTestId('code-error')).toHaveText('Неверный ник или код')
        await expect(page.getByTestId('code-submit')).toBeEnabled()
        await page.waitForTimeout(50)
    }
    await submitCode(page, { nick: 'Забывчивый', code, password: 'brand-new-pass' })
    await expect(page.getByTestId('code-error')).toContainText('Слишком много попыток')
    expect(mocks.accounts.codes.size).toBe(1)
})

test('в настройках: код создаётся с паролем, новый отменяет старый', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const mocks = await installMocks(page)
    await signInSite(page, PLAIN_USER)
    await page.goto('/#/me')
    await expect(page.getByTestId('recovery-state')).toContainText('Кода нет')

    await page.getByTestId('recovery-password').fill('неверный-пароль')
    await page.getByTestId('recovery-create').click()
    await expect(page.getByTestId('recovery-create-error')).toHaveText('Неверный пароль')
    expect(mocks.accounts.codes.size).toBe(0)

    await page.getByTestId('recovery-password').fill(PLAIN_USER.password)
    await page.getByTestId('recovery-create').click()
    const first = (await page.getByTestId('recovery-code').textContent())!.trim()
    expect(first).toMatch(CODE_RE)
    await page.getByTestId('recovery-copy').click()
    await page.getByTestId('recovery-saved').click()
    await expect(page.getByTestId('recovery-state')).toContainText('Код создан')

    // Новый код — снова с паролем; прежний больше не работает.
    await page.getByTestId('recovery-password').fill(PLAIN_USER.password)
    await expect(page.getByTestId('recovery-create')).toHaveText('Создать новый код')
    await page.getByTestId('recovery-create').click()
    const second = (await page.getByTestId('recovery-code').textContent())!.trim()
    expect(second).not.toBe(first)
    expect(mocks.accounts.codes.size).toBe(1)
    await page.getByTestId('recovery-written').check()
    await page.getByTestId('recovery-saved').click()

    expect(mocks.unexpected).toEqual([])
})

test('«Забыл пароль»: заявка владельцу остаётся запасным вариантом', async ({ page }) => {
    const mocks = await installMocks(page)
    await page.goto('/#/forgot')
    await page.getByLabel('Ник').fill(PLAIN_USER.nick)
    await page.getByLabel('Как с тобой связаться').fill('@tg')
    await page.getByRole('button', { name: 'Отправить заявку' }).click()
    await expect(page.getByTestId('recovery-sent')).toBeVisible()
    expect(mocks.accounts.recovery).toHaveLength(1)
    // И переключение обратно с кода на заявку.
    await page.reload()
    await page.getByTestId('mode-code').click()
    await page.getByTestId('mode-request').click()
    await expect(page.getByLabel('Как с тобой связаться')).toBeVisible()
})
