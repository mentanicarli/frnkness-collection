import { runSearch, search, setSearchOpen } from '../../site/stores/search'
import { view } from '../../site/stores/view'
import { resetPageAccent } from '../../site/services/colors'

export function createUiModule() {
    function initStaggerAnimation() {
        document.querySelectorAll('.stagger-item').forEach((item, i) => {
            item.classList.remove('visible')
            setTimeout(() => item.classList.add('visible'), i * 150)
        })
    }

    function showPage(name) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
        const page = document.getElementById('page-' + name)
        if (page) page.classList.add('active')
        document.body.classList.toggle('release-page', name === 'release' || name === 'track')
        // Страницы релиза и трека выставляют открытый релиз сами при отрисовке.
        if (name !== 'release' && name !== 'track') view.viewedReleaseId = null
        window.scrollTo(0, 0)
        if (name === 'home') resetPageAccent()
        if (name === 'home') setTimeout(initStaggerAnimation, 50)
        if (name === 'home') runSearch(search.input)
        if (name !== 'home') setSearchOpen(false)
    }

    return { initStaggerAnimation, showPage }
}
