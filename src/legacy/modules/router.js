/**
 * Hash-роутинг.
 *
 * Единственный источник правды — location.hash. Любая навигация только
 * меняет хеш, а отрисовкой занимается обработчик hashchange. Благодаря
 * этому «назад»/«вперёд» в браузере работают сами собой, а прямая ссылка
 * на трек открывает нужный экран после перезагрузки.
 *
 * Маршруты:
 *   #/                                 главная
 *   #/chart                            чарт
 *   #/release/<releaseId>              страница релиза
 *   #/track/<releaseId>/<slug>         страница трека
 */
export function createRouterModule(ctx) {
    const { releases, utils } = ctx
    const { findTrackRefBySlug, getTrackSlug } = utils

    let lastRendered = ''

    function parseHash(raw) {
        const value = String(raw || '').replace(/^#/, '')
        const parts = value.split('/').filter(Boolean)
        const decode = (part) => {
            try {
                return decodeURIComponent(part)
            } catch {
                return part
            }
        }

        if (!parts.length) return { name: 'home' }
        if (parts[0] === 'chart') return { name: 'chart' }
        if (parts[0] === 'release' && parts[1]) {
            return { name: 'release', releaseId: decode(parts[1]) }
        }
        if (parts[0] === 'track' && parts[1] && parts[2]) {
            return { name: 'track', releaseId: decode(parts[1]), slug: decode(parts[2]) }
        }
        return { name: 'home' }
    }

    function buildHash(route) {
        if (!route || route.name === 'home') return '#/'
        if (route.name === 'chart') return '#/chart'
        if (route.name === 'release') return `#/release/${encodeURIComponent(route.releaseId)}`
        if (route.name === 'track') {
            return `#/track/${encodeURIComponent(route.releaseId)}/${encodeURIComponent(route.slug)}`
        }
        return '#/'
    }

    // Отрисовка маршрута. Вызывается только из обработчика hashchange и при
    // старте — прямых вызовов извне быть не должно, иначе URL разъедется с
    // тем, что на экране.
    function render(route) {
        const key = buildHash(route)
        if (key === lastRendered) return
        lastRendered = key

        if (route.name === 'chart') {
            ctx.modules.ui.showPage('chart')
            return
        }

        if (route.name === 'release') {
            if (!releases[route.releaseId]) {
                replace({ name: 'home' })
                return
            }
            ctx.modules.ui.renderRelease(route.releaseId)
            ctx.modules.ui.showPage('release')
            return
        }

        if (route.name === 'track') {
            const ref = findTrackRefBySlug(releases, route.releaseId, route.slug)
            if (!ref) {
                // Неизвестный трек: уводим на релиз, если он есть, иначе домой.
                replace(releases[route.releaseId] ? { name: 'release', releaseId: route.releaseId } : { name: 'home' })
                return
            }
            ctx.modules.track.renderTrackPage(ref.releaseId, ref.trackIndex)
            ctx.modules.ui.showPage('track')
            return
        }

        ctx.modules.ui.showPage('home')
    }

    // Приводит адресную строку к каноническому виду маршрута, не трогая
    // историю: «#/мусор» становится «#/», а «#/chart/лишнее» — «#/chart».
    function syncCanonicalHash(route) {
        const canonical = buildHash(route)
        if (window.location.hash === canonical) return
        window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}${canonical}`
        )
    }

    function handleHashChange() {
        const route = parseHash(window.location.hash)
        syncCanonicalHash(route)
        render(route)
    }

    // Переход с записью в историю.
    function navigate(route) {
        const next = buildHash(route)
        if (window.location.hash === next) {
            // Хеш уже такой — hashchange не сработает, рисуем сами.
            render(route)
            return
        }
        window.location.hash = next
    }

    // Переход без новой записи в истории: для редиректов с битых ссылок,
    // чтобы «назад» не возвращал пользователя на ту же нерабочую ссылку.
    function replace(route) {
        const next = buildHash(route)
        const url = `${window.location.pathname}${window.location.search}${next}`
        // replaceState не порождает hashchange, поэтому рисуем сами.
        window.history.replaceState(null, '', url)
        lastRendered = ''
        render(route)
    }

    // ── Публичная навигация ─────────────────────────────────────────────

    function goHome() {
        navigate({ name: 'home' })
    }

    function goChart() {
        navigate({ name: 'chart' })
    }

    function goRelease(releaseId) {
        navigate({ name: 'release', releaseId })
    }

    function goTrack(releaseId, trackIndex) {
        const release = releases[releaseId]
        const track = release && release.tracks[trackIndex]
        if (!track) return
        navigate({ name: 'track', releaseId, slug: getTrackSlug(track) })
    }

    // Переход на страницу трека, который играет сейчас.
    function goCurrentTrack() {
        if (!ctx.state.currentReleaseId) return
        goTrack(ctx.state.currentReleaseId, ctx.state.currentTrackIndex)
    }

    function start() {
        window.addEventListener('hashchange', handleHashChange)
        const route = parseHash(window.location.hash)
        syncCanonicalHash(route)
        render(route)
    }

    return {
        parseHash,
        buildHash,
        start,
        navigate,
        replace,
        goHome,
        goChart,
        goRelease,
        goTrack,
        goCurrentTrack
    }
}
