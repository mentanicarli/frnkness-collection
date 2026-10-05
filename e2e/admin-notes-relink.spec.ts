import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, installMocks, loginAs, repoFile, type ContentCall } from './mocks'

/**
 * «Тексты»: разбор следует за изменённой строкой, висящий разбор можно
 * привязать вручную, .lrc обновляется вслед за текстом с прежними таймкодами.
 * Трек «Back to Poopsicks 2» в фикстуре: .lrc совпадает с текстом построчно.
 */
const HASH = '#/lyrics/most-venture-poopsicks/1'
const TXT = 'lyrics/album1/02-back-to-poopsicks-2.txt'
const NOTES = 'lyrics/album1/02-back-to-poopsicks-2.notes.json'
const LRC = 'lyrics/album1/02-back-to-poopsicks-2.lrc'
const CHORUS = 'Чай ревень по глотке стекает в животик'

async function open(page: Page) {
    const mocks = await installMocks(page, {
        content: (call: ContentCall) => (call.action === 'commit' ? { body: { sha: 'b'.repeat(40), url: 'u', message: `admin: ${call.body.message}` } } : undefined)
    })
    await loginAs(page, ADMIN_USER)
    await expect(page.getByTestId('status-github')).toContainText('mentanicarli')
    await page.goto('/admin.html' + HASH)
    await expect(input(page)).toHaveValue(/Чай ревень/)
    return mocks
}

const input = (page: Page) => page.getByRole('textbox', { name: 'Текст песни' })
const committed = (mocks: { calls: ContentCall[] }) => {
    const c = mocks.calls.filter((x) => x.action === 'commit')
    expect(c).toHaveLength(1)
    return Object.fromEntries((c[0].body.files as { path: string; content: string }[]).map((f) => [f.path, f.content]))
}

async function publish(page: Page) {
    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)
}

test('небольшая правка строки с разбором — разбор переезжает, .lrc обновляется с прежними таймкодами одним коммитом', async ({ page }) => {
    const mocks = await open(page)
    const edited = 'Чай ревень по глотке стекает в живот'
    await input(page).fill((await input(page).inputValue()).replaceAll(CHORUS, edited))
    await expect(page.getByTestId('relink-notice')).toContainText(`Разбор перенесён на изменённую строку «${edited}»`)
    await expect(page.getByTestId('dangling')).toHaveCount(0)
    await expect(page.getByTestId('lines').locator('.adm-line.has-note').first()).toContainText(edited)

    const follow = page.getByTestId('lrc-follow')
    await expect(follow).toContainText('таймкоды сохранятся')
    await expect(follow.getByRole('checkbox')).toBeChecked()

    await page.getByRole('button', { name: 'Сохранить…' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('commit-files').locator('li')).toHaveCount(3)
    await expect(dialog).toContainText('таймкоды не меняются')
    await dialog.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(dialog).toHaveCount(0)

    const files = committed(mocks)
    expect(Object.keys(files)).toEqual([TXT, NOTES, LRC])
    expect(JSON.parse(files[NOTES]).annotations[0].line).toBe(edited)
    // Каждая строка .lrc: тот же таймкод, текст — как в новом .txt.
    const before = repoFile(LRC)!.replace(/\r/g, '').split('\n')
    const after = files[LRC].split('\n')
    expect(after).toHaveLength(before.length)
    after.forEach((line, i) => {
        expect(line.slice(0, 10)).toBe(before[i].slice(0, 10))
        expect(line.slice(10)).toBe(before[i].slice(10).replace(CHORUS, edited))
    })
    expect(after.filter((l) => l.endsWith(edited)).length).toBeGreaterThan(0)
})

test('можно не обновлять .lrc — тогда только .txt и разборы', async ({ page }) => {
    const mocks = await open(page)
    await input(page).fill((await input(page).inputValue()).replace('Щас только флэт уайта', 'Щас только флэт уайт'))
    await page.getByTestId('lrc-follow').getByRole('checkbox').uncheck()
    await publish(page)
    expect(Object.keys(committed(mocks))).toEqual([TXT])
})

test('число строк изменилось — .lrc не трогаем, ссылка на синхронизатор', async ({ page }) => {
    const mocks = await open(page)
    await input(page).fill((await input(page).inputValue()) + '\nНовая последняя строка\n')
    const follow = page.getByTestId('lrc-follow')
    await expect(follow).toContainText('автоматически не обновляется')
    await expect(follow.getByRole('link', { name: 'открыть «Караоке» для этого трека' })).toHaveAttribute('href', '#/lrc/most-venture-poopsicks/1')
    await publish(page)
    expect(Object.keys(committed(mocks))).toEqual([TXT])
})

test('висящий разбор: «Вернуться и привязать», привязка кликом по строке в тексте', async ({ page }) => {
    const mocks = await open(page)
    const value = await input(page).inputValue()
    await input(page).fill(value.replaceAll(CHORUS, 'Совершенно новая строка про вечер'))
    const dangling = page.getByTestId('dangling')
    await expect(dangling).toContainText(`«${CHORUS},»`)

    await page.getByRole('button', { name: 'Сохранить…' }).click()
    await page.getByTestId('dangling-confirm').getByRole('button', { name: 'Вернуться и привязать' }).click()
    await expect(page.getByTestId('dangling-confirm')).toHaveCount(0)

    await dangling.getByRole('button', { name: 'Привязать к строке' }).click()
    await expect(page.getByTestId('binding')).toBeVisible()
    // Клик по строке в поле текста: курсор на строке «Совершенно новая…».
    const text = await input(page).inputValue()
    const pos = text.indexOf('Совершенно новая строка про вечер') + 3
    await input(page).evaluate((el: HTMLTextAreaElement, p) => {
        el.focus()
        el.setSelectionRange(p, p)
        el.click()
    }, pos)
    await expect(page.getByTestId('relink-notice')).toContainText('Разбор привязан к строке «Совершенно новая строка про вечер»')
    await expect(dangling).toHaveCount(0)
    await expect(page.getByTestId('binding')).toHaveCount(0)

    await publish(page)
    const files = committed(mocks)
    expect(JSON.parse(files[NOTES]).annotations[0].line).toBe('Совершенно новая строка про вечер')
})

test('привязка кликом по строке в списке разборов; метка секции — не строка', async ({ page }) => {
    await open(page)
    const value = await input(page).inputValue()
    await input(page).fill(value.replaceAll(CHORUS, 'Совершенно новая строка про вечер'))
    await page.getByTestId('dangling').getByRole('button', { name: 'Привязать к строке' }).click()

    // Клик по метке секции в тексте — подсказка, привязки нет.
    await input(page).evaluate((el: HTMLTextAreaElement) => {
        el.focus()
        el.setSelectionRange(2, 2)
        el.click()
    })
    await expect(page.getByTestId('binding')).toContainText('Это не строка песни')

    await page.getByTestId('lines').locator('.adm-line', { hasText: 'Раньше только чистая вода' }).first().click()
    await expect(page.getByTestId('dangling')).toHaveCount(0)
    await expect(page.getByTestId('lines').locator('.adm-line', { hasText: 'Раньше только чистая вода' }).first()).toHaveClass(/has-note/)
    // Клик по строке вне режима привязки — снова редактор разбора.
    await page.getByTestId('lines').locator('.adm-line', { hasText: 'Щас только флэт уайта' }).first().click()
    await expect(page.getByRole('textbox', { name: 'Разбор строки' })).toBeVisible()
})
