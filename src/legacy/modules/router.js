/**
 * Показ открытой страницы после каждого перехода Vue Router
 * (src/site/router.ts). Содержимое страниц рисуют компоненты src/site/pages.
 */
import { router } from '../../site/router'

export function createRouterModule(ctx) {
    let lastRendered = ''

    function render(route) {
        const key = `${String(route.name)}|${JSON.stringify(route.params)}`
        if (key === lastRendered) return
        lastRendered = key
        const name = route.name === 'chart' || route.name === 'release' || route.name === 'track' ? route.name : 'home'
        ctx.modules.ui.showPage(name)
    }

    function start() {
        router.afterEach((to, _from, failure) => {
            if (!failure) render(to)
        })
        router.isReady().then(() => render(router.currentRoute.value))
    }

    return { start }
}
