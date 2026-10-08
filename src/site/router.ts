import { watch } from 'vue'
import { createRouter, createWebHashHistory, type RouteLocationNormalized, type RouteLocationRaw, type RouteRecordRaw } from 'vue-router'
import { releases } from '@/config'
import { findTrackRefBySlug, getTrackSlug } from '@/utils/slug'
import { sanitizeNext, welcomeLocation } from './auth/redirect'
import { session, whenSessionReady } from './session'
import HomePage from './pages/HomePage.vue'
import ChartPage from './pages/ChartPage.vue'
import ReleasePage from './pages/ReleasePage.vue'
import TrackPage from './pages/TrackPage.vue'

/**
 * Адреса сайта (hash-режим):
 *   #/                                 главная
 *   #/chart                            чарт
 *   #/release/<releaseId>              страница релиза
 *   #/track/<releaseId>/<slug>         страница трека
 *   #/me                               настройки профиля
 *   #/u/<ник>                          страница пользователя (и своя);
 *                                      старые #/u/<id> переводятся на ник
 *   #/favorites                        моё избранное
 *   #/playlists                        мои плейлисты
 *   #/playlist/<id>                    плейлист
 *   #/friends                          друзья и заявки
 *   #/feed                             лента: что слушают друзья (только вошедшим)
 *   #/room/<id>                        комната: слушаем вместе
 *   #/recap/<год>                      итоги года (только когда открыты этому пользователю)
 *   #/recovery-code                    код восстановления: после регистрации (блокирующий)
 *                                      и предложение создать новый после входа по коду
 * Без входа («мягкая стена»):
 *   #/welcome  #/login  #/register  #/forgot  #/privacy
 *
 * Гость с любого закрытого адреса попадает на заставку, адрес запоминается
 * (?next=) и открывается после входа или регистрации.
 *
 * Битые и лишние адреса приводятся к рабочим без новой записи в истории:
 * «#/мусор» → «#/», «#/chart/лишнее» → «#/chart», неизвестный трек — на
 * страницу его релиза, неизвестный релиз — на главную.
 */

declare module 'vue-router' {
    interface RouteMeta {
        /** Доступно без входа. */
        public?: boolean
        /** Только для гостей: вошедшего уводим дальше (на ?next= или главную). */
        guestOnly?: boolean
        /** Экран входа/регистрации: без шапки с поиском и без плеера. */
        bare?: boolean
    }
}

const param = (value: unknown): string => (Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''))

const guest = { public: true, guestOnly: true, bare: true }

const routes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: HomePage },
    { path: '/chart', name: 'chart', component: ChartPage },
    { path: '/chart/:rest(.*)+', redirect: { name: 'chart' } },
    { path: '/release/:releaseId', name: 'release', component: ReleasePage },
    {
        path: '/release/:releaseId/:rest(.*)+',
        redirect: (to) => ({ name: 'release', params: { releaseId: to.params.releaseId } })
    },
    { path: '/track/:releaseId/:slug', name: 'track', component: TrackPage },
    {
        path: '/track/:releaseId/:slug/:rest(.*)+',
        redirect: (to) => ({ name: 'track', params: { releaseId: to.params.releaseId, slug: to.params.slug } })
    },
    { path: '/me', name: 'me', component: () => import('./pages/MePage.vue') },
    { path: '/u/:nick', name: 'user', component: () => import('./pages/UserPage.vue') },
    { path: '/favorites', name: 'favorites', component: () => import('./pages/FavoritesPage.vue') },
    { path: '/playlists', name: 'playlists', component: () => import('./pages/PlaylistsPage.vue') },
    { path: '/playlist/:id', name: 'playlist', component: () => import('./pages/PlaylistPage.vue') },
    { path: '/friends', name: 'friends', component: () => import('./pages/FriendsPage.vue') },
    { path: '/feed', name: 'feed', component: () => import('./pages/FeedPage.vue') },
    { path: '/room/:id', name: 'room', component: () => import('./pages/RoomPage.vue') },
    { path: '/recap/:year(\\d{4})', name: 'recap', component: () => import('./recap/RecapPage.vue'), meta: { bare: true } },
    { path: '/recovery-code', name: 'recovery-code', component: () => import('./pages/RecoveryCodePage.vue'), meta: { bare: true } },
    { path: '/change-password', name: 'change-password', component: () => import('./pages/ChangePasswordPage.vue'), meta: { bare: true } },
    { path: '/welcome', name: 'welcome', component: () => import('./pages/WelcomePage.vue'), meta: guest },
    { path: '/login', name: 'login', component: () => import('./pages/LoginPage.vue'), meta: guest },
    { path: '/register', name: 'register', component: () => import('./pages/RegisterPage.vue'), meta: guest },
    { path: '/forgot', name: 'forgot', component: () => import('./pages/ForgotPage.vue'), meta: guest },
    { path: '/privacy', name: 'privacy', component: () => import('./pages/PrivacyPage.vue'), meta: { public: true, bare: true } },
    { path: '/:pathMatch(.*)*', redirect: { name: 'home' } }
]

export const router = createRouter({
    history: createWebHashHistory(),
    routes
})

/** Адрес из ?next= — если он ведёт на существующий экран сайта. */
export function nextTarget(raw: unknown): string | null {
    const next = sanitizeNext(raw)
    if (!next) return null
    const resolved = router.resolve(next)
    if (!resolved.matched.length || resolved.matched.some((m) => m.path === '/:pathMatch(.*)*')) return null
    return resolved.fullPath
}

/**
 * Экраны, которые аккаунт может навязать (сменить пароль, сохранить код
 * восстановления). Флаги берутся из копии на устройстве и уточняются, когда
 * профиль догрузится: тогда проверка повторяется для открытого экрана.
 * leave — разрешить и обратное: с экрана кода без дела уйти на сайт (только
 * когда флаги уже точные).
 */
function accountGate(to: RouteLocationNormalized, leave = true): RouteLocationRaw | null {
    if (!session.user) return null
    // С экрана входа/регистрации «дальше» ведёт ?next=, а не сам экран входа.
    const here = to.meta.guestOnly ? (nextTarget(to.query.next) ?? '/') : to.fullPath
    if (session.mustChangePassword && to.name !== 'change-password' && to.name !== 'privacy') {
        const next = sanitizeNext(here)
        return { name: 'change-password', query: next && next !== '/' ? { next } : {}, replace: true }
    }
    // Код восстановления выдан, но не сохранён: пока человек не нажмёт «Я сохранил», дальше не пускаем.
    if (session.recoveryPending && to.name !== 'recovery-code' && to.name !== 'change-password' && to.name !== 'privacy') {
        const next = sanitizeNext(here)
        return { name: 'recovery-code', query: next && next !== '/' ? { next } : {}, replace: true }
    }
    // Экран кода без дела (нет несохранённого кода и это не предложение после восстановления) — на сайт.
    // Пока профиль не загружен, не знаем, так ли это: решает повторная проверка.
    if (leave && session.accountLoaded && to.name === 'recovery-code' && !session.recoveryPending && to.query.offer !== '1') {
        return nextTarget(to.query.next) ?? { name: 'home', replace: true }
    }
    return null
}

// Профиль догрузился или флаг включился (код выдан при регистрации, сброс пароля):
// навязанный экран открываем сейчас, на каком бы месте сайта человек ни был.
watch(
    () => [session.accountLoaded, session.mustChangePassword, session.recoveryPending] as const,
    ([loaded], [wasLoaded]) => {
        const current = router.currentRoute.value
        if (!current.matched.length) return
        // Обратное («выйти с экрана кода») — только в момент, когда профиль пришёл.
        const gate = accountGate(current, loaded && !wasLoaded)
        if (gate) void router.replace(gate)
    }
)

// Проверка на каждом переходе (beforeEach, а не beforeEnter: тот не
// срабатывает при смене параметров — с одного релиза на другой).
router.beforeEach(async (to) => {
    await whenSessionReady()

    // ── Стена ──
    if (!session.user) {
        if (to.meta.public) return true
        return { ...welcomeLocation(to.fullPath), replace: true }
    }
    const gate = accountGate(to)
    if (gate) return gate
    if (to.meta.guestOnly) return nextTarget(to.query.next) ?? { name: 'home', replace: true }

    // ── Существование релиза и трека ──
    if (to.name === 'release') {
        return releases[param(to.params.releaseId)] ? true : { name: 'home', replace: true }
    }
    if (to.name === 'track') {
        const releaseId = param(to.params.releaseId)
        if (findTrackRefBySlug(releases, releaseId, param(to.params.slug))) return true
        // Неизвестный трек: уводим на релиз, если он есть, иначе домой.
        return releases[releaseId] ? { name: 'release', params: { releaseId }, replace: true } : { name: 'home', replace: true }
    }
    return true
})

// Канонический вид адреса («#/chart/» → «#/chart») — без записи в истории.
router.afterEach((to) => {
    if (!to.name) return
    const canonical = router.resolve({ name: to.name, params: to.params, query: to.query }).fullPath
    if (canonical !== to.fullPath) void router.replace(canonical)
})

// ── Переходы ────────────────────────────────────────────────────────────

export function releaseRoute(releaseId: string): RouteLocationRaw {
    return { name: 'release', params: { releaseId } }
}

export function trackRoute(releaseId: string, trackIndex: number): RouteLocationRaw | null {
    const track = releases[releaseId]?.tracks[trackIndex]
    return track ? { name: 'track', params: { releaseId, slug: getTrackSlug(track) } } : null
}

export function goHome(): void {
    void router.push({ name: 'home' })
}

export function goChart(): void {
    void router.push({ name: 'chart' })
}

export function goRelease(releaseId: string): void {
    void router.push(releaseRoute(releaseId))
}

export function goTrack(releaseId: string, trackIndex: number): void {
    const route = trackRoute(releaseId, trackIndex)
    if (route) void router.push(route)
}

/** После входа или регистрации: на запомненный адрес или на главную. */
export function goAfterLogin(rawNext: unknown): void {
    void router.replace(nextTarget(rawNext) ?? { name: 'home' })
}

/**
 * Адрес без «/» после «#» («#chart») vue-router понял бы иначе: приводим
 * к «#/chart» до старта роутера, без записи в истории.
 */
export function normalizeInitialHash(): void {
    const { hash, pathname, search } = window.location
    if (hash && hash !== '#' && !hash.startsWith('#/')) {
        window.history.replaceState(window.history.state, '', `${pathname}${search}#/${hash.slice(1)}`)
    }
}
