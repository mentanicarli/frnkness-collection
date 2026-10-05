/**
 * Связка legacy-страниц с Vue Router (src/site/router.ts).
 *
 * Адрес и проверку маршрутов ведёт Vue Router; здесь только отрисовка
 * открытого экрана старым кодом после каждого перехода.
 */
import { router, goHome, goChart, goRelease, goTrack } from '../../site/router'
import { findTrackRefBySlug } from '../../utils/slug'

export function createRouterModule(ctx) {
    const { releases } = ctx

    let lastRendered = ''

    function render(route) {
        const key = `${String(route.name)}|${JSON.stringify(route.params)}`
        if (key === lastRendered) return
        lastRendered = key

        if (route.name === 'chart') {
            ctx.modules.ui.showPage('chart')
            return
        }

        if (route.name === 'release') {
            // Содержимое рисует ReleasePage.vue.
            ctx.modules.ui.showPage('release')
            return
        }

        if (route.name === 'track') {
            const ref = findTrackRefBySlug(releases, String(route.params.releaseId), String(route.params.slug))
            if (!ref) return
            // Содержимое рисует TrackPage.vue.
            ctx.modules.ui.showPage('track')
            return
        }

        ctx.modules.ui.showPage('home')
    }

    // Переход на страницу трека, который играет сейчас.
    function goCurrentTrack() {
        if (!ctx.state.currentReleaseId) return
        goTrack(ctx.state.currentReleaseId, ctx.state.currentTrackIndex)
    }

    function start() {
        router.afterEach((to, _from, failure) => {
            if (!failure) render(to)
        })
        router.isReady().then(() => render(router.currentRoute.value))
    }

    return { start, goHome, goChart, goRelease, goTrack, goCurrentTrack }
}
