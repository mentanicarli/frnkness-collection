import { test, expect, type Browser, type Page } from '@playwright/test'
import { DEFAULT_USERS, OWNER_USER, PLAIN_USER, SECOND_USER, installMocks, signInSite } from './mocks'
import { FakeRealtime } from './realtimeMock'
import { SocialBackend } from './socialMock'
import type { MockUser } from './accountsMock'

// Комнаты: прослушивания на каждого участника и точность синхронизации.
// Realtime и база подменены (сеть с задержкой и разбросом), звук настоящий —
// <audio> в Chromium играет mp3 из фикстуры (60 секунд тишины).

test.describe.configure({ timeout: 120_000 })

async function newSocial(): Promise<SocialBackend> {
    const social = new SocialBackend(DEFAULT_USERS)
    await social.ready()
    return social
}

/** Случайная задержка от min до max мс: сеть с разбросом, а не идеальная. */
const jitter = (min: number, max: number) => () => min + Math.random() * (max - min)

interface Net {
    broadcast?: () => number
    rpc?: () => number
}

async function openAs(browser: Browser, social: SocialBackend, realtime: FakeRealtime, user: MockUser, net: Net = {}): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    // Запись событий <audio> с общим временем (страницы в одном процессе — часы одни).
    await page.addInitScript(() => {
        const w = window as any
        w.__rec = { playing: [] as { t: number; pos: number }[], samples: [] as { t: number; pos: number; rate: number }[], seeks: 0 }
        const iv = setInterval(() => {
            const a = document.querySelector('audio')
            if (!a) return
            clearInterval(iv)
            a.addEventListener('playing', () => w.__rec.playing.push({ t: Date.now(), pos: a.currentTime }))
            a.addEventListener('seeked', () => w.__rec.seeks++)
            setInterval(() => {
                if (!a.paused) w.__rec.samples.push({ t: Date.now(), pos: a.currentTime, rate: a.playbackRate })
            }, 100)
        }, 20)
    })
    await installMocks(page, { social, latencyMs: net.rpc })
    await realtime.attach(page, social)
    await signInSite(page, user)
    return page
}

const mini = (page: Page) => page.locator('#player-track')
const roomIdOf = (page: Page) => page.url().split('/room/')[1]

async function hostStartsRoom(page: Page): Promise<string> {
    await page.goto('/#/release/most-venture-poopsicks')
    await page.locator('.track-row').filter({ hasText: 'POOPSICKS' }).first().click()
    await page.getByTestId('user-menu').click()
    await page.getByTestId('menu-create-room').click()
    await page.getByTestId('create-room-name').fill('Эфир')
    await page.getByTestId('create-room-submit').click()
    await expect(page).toHaveURL(/#\/room\/[0-9a-f-]{36}$/)
    return roomIdOf(page)
}

async function guestJoins(page: Page, id: string) {
    await page.goto(`/#/room/${id}`)
    await page.getByTestId('room-connect').click()
    await expect(page.getByTestId('room-now-title')).toBeVisible()
}

const rec = (page: Page) =>
    page.evaluate(() => (window as any).__rec as { playing: { t: number; pos: number }[]; samples: { t: number; pos: number; rate: number }[]; seeks: number })
const audioState = (page: Page) => page.evaluate(() => {
    const a = document.querySelector('audio') as HTMLAudioElement
    return { paused: a.paused, pos: a.currentTime, src: a.src }
})

// ── Прослушивания: каждый участник комнаты — +1 и своя запись ───────────

test('комната на 3 человека: трек получает +3, у каждого своя запись в play_events; перемотка и пауза хозяина двойного засчёта не дают', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const guest1 = await openAs(browser, social, realtime, SECOND_USER)
    const id = await hostStartsRoom(host)
    await guestJoins(guest1, id)
    await expect.poll(async () => (await audioState(guest1)).paused).toBe(false)

    // Третий — позже, посреди трека: счёт — после 10 секунд его собственного звука.
    await host.waitForTimeout(6000)
    const guest2 = await openAs(browser, social, realtime, OWNER_USER)
    await guestJoins(guest2, id)
    await expect.poll(async () => (await audioState(guest2)).paused).toBe(false)
    const events = () => social.sql<{ user_id: string; track_key: string }>('select user_id, track_key from public.play_events order by id')

    // Хозяин перематывает на 40-ю секунду и ставит паузу — секунд «прослушано» это не добавляет.
    const bar = host.locator('#player .progress-container')
    const box = (await bar.boundingBox())!
    await host.mouse.click(box.x + box.width * 0.66, box.y + box.height / 2)
    await host.waitForTimeout(2500)
    await host.locator('#play-pause-btn').click()
    await host.waitForTimeout(1500)
    await host.locator('#play-pause-btn').click()

    // Хозяин и первый гость набрали по 10+ секунд раньше всех, третий — позже.
    await expect.poll(async () => (await events()).length, { timeout: 40_000 }).toBe(3)
    const rows = await events()
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(3)
    expect(new Set(rows.map((r) => r.user_id))).toEqual(new Set([PLAIN_USER.id, SECOND_USER.id, OWNER_USER.id]))
    expect(new Set(rows.map((r) => r.track_key)).size).toBe(1)
    const key = rows[0].track_key
    expect(await social.sql<{ plays: number }>(`select plays::int from public.play_counts where track_key = $1`, [key])).toEqual([{ plays: 3 }])

    // И дальше — ровно по одной записи на человека, сколько бы трек ни играл.
    await host.waitForTimeout(6000)
    expect((await events()).length).toBe(3)
    // «Мой топ» у каждого видит трек.
    for (const u of [PLAIN_USER, SECOND_USER, OWNER_USER]) {
        const top = await social.sql<{ r: unknown }>(`select count(*)::int n from public.play_events where user_id = $1 and track_key = $2`, [u.id, key])
        expect(top).toEqual([{ n: 1 }])
    }
})

// ── Синхронизация: замер ───────────────────────────────────────────────

function median(a: number[]): number {
    const s = [...a].sort((x, y) => x - y)
    return s.length ? s[Math.floor(s.length / 2)] : NaN
}
const pct = (a: number[], p: number) => {
    const s = [...a].sort((x, y) => x - y)
    return s.length ? s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))] : NaN
}

/** Позиция хозяина в момент t по его записям (линейная интерполяция между соседними). */
function posAt(samples: { t: number; pos: number }[], t: number): number | null {
    for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]
        const b = samples[i]
        if (t >= a.t && t <= b.t && b.t - a.t < 400) return a.pos + ((b.pos - a.pos) * (t - a.t)) / (b.t - a.t)
    }
    return null
}

test('синхронизация (сеть 60–140 мс, база 100–250 мс): старт у всех близко, во время игры расхождение мало', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    realtime.latencyMs = jitter(60, 140)
    const net = { rpc: jitter(100, 250) }
    const host = await openAs(browser, social, realtime, PLAIN_USER, net)
    const guest = await openAs(browser, social, realtime, SECOND_USER, net)
    const id = await hostStartsRoom(host)
    await guestJoins(guest, id)
    await expect.poll(async () => (await audioState(guest)).paused).toBe(false)
    await host.waitForTimeout(3000)

    const starts: { fromClick: number; spread: number }[] = []
    for (const action of ['next', 'pause', 'resume', 'next'] as const) {
        const hostBefore = (await rec(host)).playing.length
        const guestBefore = (await rec(guest)).playing.length
        const t0 = await host.evaluate(() => Date.now())
        if (action === 'next') await host.locator('#player').getByRole('button', { name: 'Следующий трек' }).click()
        else await host.locator('#play-pause-btn').click()
        if (action === 'pause') {
            // Пауза: у гостя звук должен стоять сразу.
            await expect.poll(async () => (await audioState(guest)).paused, { timeout: 3000 }).toBe(true)
            const stopped = await guest.evaluate(() => Date.now())
            console.log(`SYNC pause: гость замолчал через ${stopped - t0} мс после нажатия`)
            await host.waitForTimeout(1500)
            continue
        }
        await expect.poll(async () => (await rec(host)).playing.length, { timeout: 8000 }).toBeGreaterThan(hostBefore)
        await expect.poll(async () => (await rec(guest)).playing.length, { timeout: 8000 }).toBeGreaterThan(guestBefore)
        const h = (await rec(host)).playing[hostBefore]
        const g = (await rec(guest)).playing[guestBefore]
        starts.push({ fromClick: g.t - t0, spread: g.t - h.t })
        await host.waitForTimeout(action === 'resume' ? 3000 : 4000)
    }

    // Расхождение во время игры: 25 секунд ровной игры, замеры каждые 100 мс.
    await host.waitForTimeout(25_000)
    const [hr, gr] = [await rec(host), await rec(guest)]
    const lastStart = Math.max(hr.playing[hr.playing.length - 1].t, gr.playing[gr.playing.length - 1].t)
    const drifts: number[] = []
    for (const s of gr.samples) {
        if (s.t < lastStart + 3000) continue
        const hp = posAt(hr.samples, s.t)
        if (hp !== null) drifts.push((s.pos - hp) * 1000)
    }
    const abs = drifts.map(Math.abs)
    const report = {
        starts,
        startFromClickMs: starts.map((s) => Math.round(s.fromClick)),
        startSpreadMs: starts.map((s) => Math.round(s.spread)),
        driftSamples: abs.length,
        driftMedianMs: Math.round(median(abs)),
        driftP95Ms: Math.round(pct(abs, 95)),
        driftMaxMs: Math.round(Math.max(...abs)),
        guestSeeks: gr.seeks
    }
    console.log('SYNC-REPORT ' + JSON.stringify(report))

    expect(abs.length).toBeGreaterThan(100)
    // Старт: у всех в пределах ~200 мс (с запасом на браузер в CI), через 1–2,5 с после нажатия.
    for (const s of starts) {
        expect(Math.abs(s.spread)).toBeLessThan(450)
        expect(s.fromClick).toBeLessThan(3000)
    }
    // Во время игры: расхождение < 300 мс.
    expect(pct(abs, 95)).toBeLessThan(300)
})

// ── Отладочная панель ───────────────────────────────────────────────────

test('отладочная панель: у владельца сайта и по ?debug, остальным её нет', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const guest = await openAs(browser, social, realtime, SECOND_USER)
    const owner = await openAs(browser, social, realtime, OWNER_USER)
    const id = await hostStartsRoom(host)
    await guestJoins(guest, id)
    await guestJoins(owner, id)
    await expect(host.getByTestId('room-now-title')).toBeVisible()

    await expect(host.getByTestId('room-debug')).toHaveCount(0)
    await expect(guest.getByTestId('room-debug')).toHaveCount(0)
    // Владелец сайта видит панель сам.
    const panel = owner.getByTestId('room-debug')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('debug-offset')).toContainText('мс')
    await expect(panel.getByTestId('debug-rtt')).toContainText('мс')
    await expect(panel.getByTestId('debug-drift')).toHaveText(/^[+−-]?\d+ мс$/)
    await expect(panel.getByTestId('debug-seq')).not.toHaveText('0')

    // Обычный гость — по ?debug в адресе; у хозяина панель короче (расхождения у него нет).
    await guest.goto(`/#/room/${id}?debug`)
    await expect(guest.getByTestId('room-debug')).toBeVisible()
    await expect(guest.getByTestId('debug-rate')).toHaveText(/^\d\.\d\d×$/)
    await host.goto(`/#/room/${id}?debug`)
    await expect(host.getByTestId('room-debug')).toBeVisible()
    await expect(host.getByTestId('debug-drift')).toHaveCount(0)
})

// ── Выход: плеер как после загрузки страницы ───────────────────────────

async function expectPlayerReset(page: Page) {
    await expect(page.locator('#player.visible')).toHaveCount(0)
    const a = await page.evaluate(() => {
        const el = document.querySelector('audio') as HTMLAudioElement
        return { paused: el.paused, src: el.getAttribute('src'), pos: el.currentTime }
    })
    expect(a.paused).toBe(true)
    expect(a.src).toBeNull()
    expect(a.pos).toBe(0)
}

async function playsNormallyAfter(page: Page) {
    await page.goto('/#/release/faaa')
    await page.locator('.track-row').first().click()
    await expect(mini(page)).toHaveText('FAAA')
    await expect.poll(async () => (await audioState(page)).paused).toBe(false)
}

test('выход из комнаты (гость — «Выйти», хозяин — «Закрыть комнату»): плеер сброшен, дальше работает как обычно', async ({ browser }) => {
    const social = await newSocial()
    const realtime = new FakeRealtime()
    const host = await openAs(browser, social, realtime, PLAIN_USER)
    const guest = await openAs(browser, social, realtime, SECOND_USER)
    const id = await hostStartsRoom(host)
    await guestJoins(guest, id)
    await expect.poll(async () => (await audioState(guest)).paused).toBe(false)
    await expect(guest.locator('#player.visible')).toHaveCount(1)

    await guest.getByTestId('room-leave').click()
    await expect(guest).toHaveURL(/#\/$/)
    await expectPlayerReset(guest)
    // Хозяин играет дальше, пока комната открыта.
    expect((await audioState(host)).paused).toBe(false)
    await playsNormallyAfter(guest)

    // Гость возвращается (не мгновенно: realtime-клиент после выхода из последнего канала закрывает
    // соединение, и повторный вход в ту же секунду зависает — это было и до изменений) и теперь
    // хозяин закрывает комнату: сбрасываются оба.
    await guest.waitForTimeout(3000)
    await guestJoins(guest, id)
    await expect.poll(async () => (await audioState(guest)).paused).toBe(false)
    host.once('dialog', (d) => void d.accept())
    await host.getByTestId('room-close').click()
    await expect.poll(async () => (await audioState(host)).paused).toBe(true)
    await expectPlayerReset(host)
    await expectPlayerReset(guest)
    await playsNormallyAfter(host)
})
