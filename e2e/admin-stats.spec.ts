import { test, expect, type Page } from '@playwright/test'
import { ADMIN_USER, installMocks, loginAs, type MockOptions } from './mocks'

// Детерминированная статистика: «сегодня» по серверу — 1 октября 2026.
const TODAY = '2026-10-01'

function addDays(iso: string, n: number) {
    const d = new Date(iso + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
}
function days(from: string, to: string) {
    const out: string[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
    return out
}

interface StatsMock {
    trackingSince?: string
    rpcCalls: { name: string; body: any }[]
    forbidden?: boolean
    /** Миграция сессий применена. */
    listen?: boolean
    retentionCalls?: any[]
}

function statsRpc(mock: StatsMock): MockOptions['rpc'] {
    return (name, body: any) => {
        mock.rpcCalls.push({ name, body })
        if (mock.forbidden) return { status: 403, body: { code: '42501', message: 'Нет доступа', details: null, hint: null } }
        // Сессии прослушивания: по умолчанию — как до применения миграции.
        if (name.startsWith('admin_listen_') && !mock.listen) {
            return { status: 404, body: { code: 'PGRST202', message: 'Could not find the function', details: null, hint: null } }
        }
        if (name === 'admin_listen_meta') return { body: { started_at: '2026-09-25T10:00:00+00:00', sessions: 42 } }
        if (name === 'admin_listen_by_key') {
            return {
                body: [
                    { track_key: 'zlaya-nostalgia-6', sessions: 20, completed: 15, avg_share: 0.86 },
                    { track_key: 'zlaya-nostalgia-0', sessions: 10, completed: 2, avg_share: 0.31 },
                    { track_key: 'boxik-0', sessions: 4, completed: 4, avg_share: 1 }
                ]
            }
        }
        if (name === 'admin_listen_retention') {
            mock.retentionCalls?.push(body)
            return { body: [0, 5, 10, 15].map((second, i) => ({ second, listeners: 10 - i * 3, sessions: 10 })) }
        }
        if (name === 'admin_stats_overview') {
            return {
                body: { total: 548, today: 3, last7: 21, last30: 77, tracking_since: mock.trackingSince ?? '2026-08-01T09:00:00+00:00', today_date: TODAY }
            }
        }
        if (name === 'admin_stats_all_time') {
            return {
                body: [
                    { track_key: 'zlaya-nostalgia-0', plays: 120 },
                    { track_key: 'most-venture-poopsicks-0', plays: 90 },
                    { track_key: 'most-venture-poopsicks--1', plays: 10 },
                    { track_key: 'disinvolto-0', plays: 60 },
                    { track_key: 'removed-release-0', plays: 4 }
                ]
            }
        }
        if (name === 'admin_stats_daily') {
            return { body: days(body.p_from, body.p_to).map((day, i) => ({ day, plays: i % 4 })) }
        }
        if (name === 'admin_stats_by_key') {
            return {
                body: [
                    { track_key: 'zlaya-nostalgia-6', plays: 15 },
                    { track_key: 'zlaya-nostalgia-0', plays: 9 },
                    { track_key: 'boxik-0', plays: 4 }
                ]
            }
        }
        if (name === 'admin_stats_daily_by_key') {
            return {
                body: days(body.p_from, body.p_to).flatMap((day, i) => [
                    { day, track_key: 'zlaya-nostalgia-0', plays: i + 1 },
                    { day, track_key: 'faaa-0', plays: 100 }
                ])
            }
        }
        return undefined
    }
}

async function openStats(page: Page, mock: StatsMock) {
    const mocks = await installMocks(page, { rpc: statsRpc(mock) })
    await loginAs(page, ADMIN_USER)
    await page.getByRole('link', { name: 'Статистика' }).click()
    await expect(page.getByTestId('tiles')).toBeVisible()
    return mocks
}

test('сводка, график, топы и карточка релиза', async ({ page }) => {
    const mock: StatsMock = { rpcCalls: [] }
    const mocks = await openStats(page, mock)

    const tiles = page.getByTestId('tiles')
    await expect(tiles).toContainText('Всего548за всё время')
    await expect(tiles).toContainText('Сегодня3')
    await expect(tiles).toContainText('7 дней21')
    await expect(tiles).toContainText('30 дней77')
    await expect(page.getByText('По дням данные есть с 1 авг 2026')).toBeVisible()

    // По умолчанию — 30 дней: 30 столбцов.
    await expect(page.getByTestId('period-note')).toHaveText('Период: 2 сен 2026 — 1 окт 2026.')
    await expect(page.locator('.adm-card').first().locator('.adm-chart-bar')).toHaveCount(30)
    await expect.poll(() => mock.rpcCalls.find((c) => c.name === 'admin_stats_daily')?.body).toEqual({ p_from: '2026-09-02', p_to: TODAY })

    const topTracks = page.getByTestId('top-tracks')
    await expect(topTracks.locator('li').first()).toContainText('ГОУТЫ')
    await expect(topTracks.locator('li').first()).toContainText('15')
    await expect(page.getByTestId('top-releases').locator('li').first()).toContainText('Злая Ностальгия')
    await expect(page.getByTestId('top-releases').locator('li').first()).toContainText('24')

    // Карточка: по умолчанию последний релиз, динамика первых 7 дней.
    const card = page.getByTestId('release-card')
    await expect(card.getByRole('combobox', { name: 'Релиз' })).toHaveValue('zlaya-nostalgia')
    await expect(card.locator('tbody tr').first()).toContainText('Маканочки')
    await expect(card.locator('tbody tr').first()).toContainText('120')
    await expect(page.getByTestId('window-note')).toHaveText('С 26 авг 2026 по 1 сен 2026: 28 прослушиваний.')
    await expect(card.locator('.adm-chart-bar')).toHaveCount(7)

    await card.getByRole('button', { name: '30 дней' }).click()
    await expect(page.getByTestId('window-note')).toContainText('С 26 авг 2026 по 24 сен 2026')
    expect(mocks.unexpected).toEqual([])
})

test('переключение периода и «Всё время» со старыми ключами', async ({ page }) => {
    const mock: StatsMock = { rpcCalls: [] }
    await openStats(page, mock)

    await page.getByRole('button', { name: '7 дней', exact: true }).first().click()
    await expect(page.getByTestId('period-note')).toHaveText('Период: 25 сен 2026 — 1 окт 2026.')
    await expect.poll(() => mock.rpcCalls.filter((c) => c.name === 'admin_stats_daily').at(-1)?.body).toEqual({ p_from: '2026-09-25', p_to: TODAY })

    await page.getByRole('button', { name: 'Всё время' }).click()
    await expect(page.getByTestId('period-note')).toContainText('Топы — за всё время')
    const top = page.getByTestId('top-tracks').locator('li')
    await expect(top.first()).toContainText('Маканочки')
    // «most-venture-poopsicks-0» и старый «--1» — один трек: 90 + 10.
    await expect(top.nth(1)).toContainText('POOPSICKS')
    await expect(top.nth(1)).toContainText('100')
    await expect(page.getByText('4 прослушивания без трека в каталоге')).toBeVisible()

    await page.getByRole('button', { name: 'Свой период' }).click()
    await page.getByLabel('С', { exact: true }).fill('2026-09-10')
    await page.getByLabel('По', { exact: true }).fill('2026-09-12')
    await expect(page.getByTestId('period-note')).toHaveText('Период: 10 сен 2026 — 12 сен 2026.')
    // Подпись периода меняется сразу, столбики — когда придут данные.
    await expect(page.locator('.adm-card').first().locator('.adm-chart-bar')).toHaveCount(3)
})

test('журнал запущен позже релиза — честные подписи', async ({ page }) => {
    const mock: StatsMock = { rpcCalls: [], trackingSince: '2026-09-20T10:00:00+00:00' }
    await openStats(page, mock)
    await expect(page.getByTestId('period-note')).toContainText('Раньше 20 сен 2026 журнал не вёлся')
    await expect.poll(() => mock.rpcCalls.find((c) => c.name === 'admin_stats_daily')?.body).toEqual({ p_from: '2026-09-20', p_to: TODAY })
    await expect(page.getByTestId('window-note')).toHaveText(
        'Релиз вышел 26 авг 2026, а журнал по дням ведётся с 20 сен 2026 — данных о первых 7 днях нет.'
    )
    await expect(page.getByTestId('tiles')).toContainText('30 дней77с 20 сен')
})

test('подсказка на графике — мышью и с клавиатуры', async ({ page }) => {
    await openStats(page, { rpcCalls: [] })
    const chart = page.locator('.adm-card').first()
    const box = (await chart.locator('svg').boundingBox())!
    await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2)
    await expect(chart.getByRole('status')).toContainText('1 окт 2026')
    await chart.locator('svg').focus()
    await page.keyboard.press('Home')
    await expect(chart.getByRole('status')).toContainText('2 сен 2026')
    await chart.getByText('Таблица').click()
    await expect(chart.locator('.adm-chart-table tbody tr')).toHaveCount(30)
})

test('нет прав на RPC — понятная ошибка, а не пустой дашборд', async ({ page }) => {
    const mock: StatsMock = { rpcCalls: [], forbidden: true }
    await installMocks(page, { rpc: statsRpc(mock) })
    await loginAs(page, ADMIN_USER)
    await page.getByRole('link', { name: 'Статистика' }).click()
    await expect(page.getByRole('alert')).toHaveText('Нет доступа к статистике')
})

test('телефон: дашборд без горизонтальной прокрутки', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await openStats(page, { rpcCalls: [] })
    await expect(page.getByTestId('release-card').locator('.adm-chart-bar').first()).toBeAttached()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
})

test('сессии: миграция не применена — понятная подсказка, остальной дашборд работает', async ({ page }) => {
    const mocks = await openStats(page, { rpcCalls: [] })
    await expect(page.getByTestId('listen-note')).toContainText('Сбор ещё не запущен — примени миграцию 20261003120000_listen_sessions.sql')
    await expect(page.getByTestId('tiles')).toContainText('Всего548')
    await expect(page.getByTestId('release-card').locator('th', { hasText: 'Сессий' })).toHaveCount(0)
    expect(mocks.unexpected).toEqual([])
})

test('сессии: доля дослушанных, средняя доля, удержание выбранного трека', async ({ page }) => {
    const mock: StatsMock = { rpcCalls: [], listen: true, retentionCalls: [] }
    const mocks = await openStats(page, mock)
    const listen = page.getByTestId('listen')
    // Сбор с 25 сен; период 30 дней обрезается по началу сбора.
    await expect(page.getByTestId('listen-note')).toContainText('Данные собираются с 25 сен 2026 — с применения миграции.')
    await expect(page.getByTestId('listen-note')).toContainText('Период: 25 сен 2026 — 1 окт 2026.')
    // Подпись приходит из admin_listen_meta, а запрос по трекам может уйти чуть позже.
    await expect.poll(() => mock.rpcCalls.find((c) => c.name === 'admin_listen_by_key')?.body).toEqual({ p_from: '2026-09-25', p_to: '2026-10-01' })
    const rows = listen.locator('tbody tr')
    await expect(rows.nth(0)).toContainText('ГОУТЫ')
    await expect(rows.nth(0)).toContainText('20')
    await expect(rows.nth(0)).toContainText('75%')
    await expect(rows.nth(0)).toContainText('86%')

    // Карточка релиза: колонки по трекам и удержание.
    const card = page.getByTestId('release-card')
    await expect(card.locator('tbody tr').nth(0)).toContainText('20%') // Маканочки: 2 из 10
    await expect(card.locator('tbody tr').nth(1)).toContainText('—') // нет сессий
    // Удержание запрашивается заново при смене периода и релиза — ждём итоговый запрос.
    await expect.poll(() => mock.retentionCalls!.at(-1)).toEqual({ p_track_key: 'zlaya-nostalgia-0', p_from: '2026-09-25', p_to: '2026-10-01' })
    await expect(page.getByTestId('retention-note')).toHaveText('Сколько слушателей ещё слушают на каждой 5-й секунде (из 10 сессий).')
    await expect(card.locator('[data-testid="retention-chart"] .adm-chart-bar')).toHaveCount(4)

    // Клик по треку в таблице «Дослушивают» — его удержание.
    await rows.nth(0).click()
    await expect(card.getByRole('combobox', { name: 'Трек для удержания' })).toHaveValue('6')
    await expect.poll(() => mock.retentionCalls![mock.retentionCalls!.length - 1].p_track_key).toBe('zlaya-nostalgia-6')
    const table = card.locator('[data-testid="retention-chart"]')
    await table.getByText('Таблица').click()
    await expect(table.locator('.adm-chart-table tbody tr').nth(1)).toHaveText('На 0:0570%')
    expect(mocks.unexpected).toEqual([])
})
