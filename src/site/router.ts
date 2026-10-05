import { createRouter, createWebHashHistory, type RouteLocationRaw, type RouteRecordRaw } from 'vue-router'
import { releases } from '@/config'
import { findTrackRefBySlug, getTrackSlug } from '@/utils/slug'

/**
 * Адреса сайта (hash-режим, как и раньше):
 *   #/                                 главная
 *   #/chart                            чарт
 *   #/release/<releaseId>              страница релиза
 *   #/track/<releaseId>/<slug>         страница трека
 *
 * Битые и лишние адреса приводятся к рабочим без новой записи в истории:
 * «#/мусор» → «#/», «#/chart/лишнее» → «#/chart», неизвестный трек — на
 * страницу его релиза, неизвестный релиз — на главную.
 *
 * meta.public — задел на этап «Аккаунты»: какие экраны будут доступны без
 * входа. Сейчас проверка входа не включена, открыто всё.
 */

declare module 'vue-router' {
    interface RouteMeta {
        public?: boolean
    }
}

const param = (value: unknown): string => (Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''))

const routes: RouteRecordRaw[] = [
    { path: '/', name: 'home', component: { render: () => null } },
    { path: '/chart', name: 'chart', component: { render: () => null } },
    { path: '/chart/:rest(.*)+', redirect: { name: 'chart' } },
    { path: '/release/:releaseId', name: 'release', component: { render: () => null } },
    {
        path: '/release/:releaseId/:rest(.*)+',
        redirect: (to) => ({ name: 'release', params: { releaseId: to.params.releaseId } })
    },
    { path: '/track/:releaseId/:slug', name: 'track', component: { render: () => null } },
    {
        path: '/track/:releaseId/:slug/:rest(.*)+',
        redirect: (to) => ({ name: 'track', params: { releaseId: to.params.releaseId, slug: to.params.slug } })
    },
    { path: '/:pathMatch(.*)*', redirect: { name: 'home' } }
]

export const router = createRouter({
    history: createWebHashHistory(),
    routes
})

// Проверка на каждом переходе (beforeEnter не срабатывает при смене
// параметров: с одного релиза на другой).
router.beforeEach((to) => {
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
    const canonical = router.resolve({ name: to.name, params: to.params }).fullPath
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

/**
 * Адрес без «/» после «#» («#chart») vue-router понял бы иначе, чем раньше
 * сайт: приводим к «#/chart» до старта роутера, без записи в истории.
 */
export function normalizeInitialHash(): void {
    const { hash, pathname, search } = window.location
    if (hash && hash !== '#' && !hash.startsWith('#/')) {
        window.history.replaceState(window.history.state, '', `${pathname}${search}#/${hash.slice(1)}`)
    }
}
