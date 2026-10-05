/**
 * Остаток legacy-слоя: показ страниц после перехода и горячие клавиши.
 * Всё остальное — в src/site.
 */
import { releases } from '../config'
import { search, setSearchOpen } from '../site/stores/search'
import { karaoke } from '../site/player/state'
import { closeFsPlayer } from '../site/player/karaoke'
import { runWhenIdle, togglePlay } from '../site/player/engine'
import { createUiModule } from './modules/ui'
import { createRouterModule } from './modules/router'

export function initLegacyApp() {
    if (window.__legacyAppInitialized) return
    window.__legacyAppInitialized = true

    const ctx = { releases, modules: {} }
    const modules = ctx.modules
    modules.ui = createUiModule(ctx)
    modules.router = createRouterModule(ctx)

    // ── Keyboard shortcuts ─────────────────────────────────────────────

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (karaoke.fsOpen) closeFsPlayer()
            else if (search.open) setSearchOpen(false)
        }
        const activeTag = document.activeElement ? document.activeElement.tagName : ''
        if (e.key === ' ' && !['BUTTON', 'INPUT', 'TEXTAREA'].includes(activeTag)) {
            e.preventDefault()
            togglePlay()
        }
    })

    // ── Init ───────────────────────────────────────────────────────────

    modules.router.start()
    modules.ui.initStaggerAnimation()

    // Прогрев первых обложек, когда браузер свободен.
    runWhenIdle(() => {
        Object.values(releases).slice(0, 5).forEach(release => {
            const img = new Image()
            img.decoding = 'async'
            img.src = release.cover
        })
    })
}
