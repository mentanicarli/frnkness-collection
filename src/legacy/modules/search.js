import { focusLyricLine } from '../../site/services/lyricFocus'
import { ensureLyricsIndex, isLyricsIndexLoading, isLyricsIndexReady, searchCatalog as searchIndex } from '../../site/services/searchIndex'

export function createSearchModule(ctx) {
    const { dom, releases, utils } = ctx
    const { escapeHtml, debounce, normalizeForSearch } = utils

    // Последняя выдача: по индексу из onclick достаём строку текста целиком,
    // не протаскивая её через inline-обработчик.
    let lastResults = []

    function toggleSearchPanel(forceState = null) {
        if (!dom.searchPanel) return
        const shouldOpen = forceState === null
            ? !dom.searchPanel.classList.contains('open')
            : Boolean(forceState)
        dom.searchPanel.classList.toggle('open', shouldOpen)
        if (dom.searchToggle) {
            dom.searchToggle.classList.toggle('active', shouldOpen)
            dom.searchToggle.style.display = shouldOpen ? 'none' : ''
        }
        if (shouldOpen && dom.searchInput) {
            requestAnimationFrame(() => dom.searchInput.focus())
            handleSearchInput(dom.searchInput.value)
        } else if (dom.searchInput) {
            dom.searchInput.value = ''
            if (dom.searchResults) dom.searchResults.innerHTML = ''
        }
    }

    function renderSearchResults(results, query) {
        if (!dom.searchResults) return
        const normalized = normalizeForSearch(query)
        lastResults = normalized ? results : []
        // Пустой запрос — пустой контейнер: без подсказки и без тёмной
        // панели (её отступы, рамку и тень скрывает CSS по :empty).
        if (!normalized) {
            dom.searchResults.innerHTML = ''
            return
        }
        if (!results.length) {
            dom.searchResults.innerHTML = '<p class="text-sm text-[var(--fg-faint)] font-mono py-2">Ничего не найдено.</p>'
            return
        }
        const labels = { release: 'Релиз', track: 'Трек', lyric: 'Строка' }
        const html = results.map((item, index) => {
            const badge = labels[item.type] || 'Результат'
            const line = item.line ? `<p class="text-xs text-[var(--fg-muted)] mt-1 line-clamp-2 italic">${escapeHtml(item.line)}</p>` : ''
            const trackTitle = item.trackTitle ? `<p class="text-xs text-[var(--fg-muted)] mt-1">${escapeHtml(item.trackTitle)}</p>` : ''
            return `
                <button class="w-full text-left rounded-md hover:bg-[var(--bg-2)] transition-colors p-3 mb-0.5 flex items-center justify-between gap-4"
                    onclick="App.openSearchResult('${item.type}', '${item.releaseId}', ${item.trackIndex ?? -1}, ${item.time ?? -1}, ${index})">
                    <div class="min-w-0">
                        <p class="text-sm font-semibold text-[var(--fg)] truncate">${escapeHtml(item.title)}</p>
                        ${trackTitle}
                        ${line}
                    </div>
                    <span class="font-mono text-[0.5625rem] uppercase tracking-wider text-[var(--fg-faint)] flex-shrink-0 border border-white/10 rounded px-2 py-1">${badge}</span>
                </button>
            `
        }).join('')
        dom.searchResults.innerHTML = `<p class="font-mono text-xs text-[var(--fg-faint)] mb-2">Результатов: ${results.length}</p>${html}`
    }

    function searchCatalog(query) {
        return searchIndex(releases, query)
    }

    function handleSearchInput(value) {
        const query = normalizeForSearch(value)
        const baseResults = searchCatalog(query)
        renderSearchResults(baseResults, query)
        if (!query || isLyricsIndexReady() || isLyricsIndexLoading()) return
        ensureLyricsIndex(releases).then(() => {
            if (!dom.searchInput) return
            const freshQuery = normalizeForSearch(dom.searchInput.value)
            if (!freshQuery) return
            renderSearchResults(searchCatalog(freshQuery), freshQuery)
        })
    }

    function initGlobalSearch() {
        if (!dom.searchInput) return
        const onInput = debounce(e => handleSearchInput(e.target.value), 180)
        dom.searchInput.addEventListener('input', onInput)
        if (dom.searchToggle) {
            dom.searchToggle.addEventListener('click', e => { e.stopPropagation(); toggleSearchPanel() })
        }
        if (dom.searchPanel) dom.searchPanel.addEventListener('click', e => e.stopPropagation())
        document.addEventListener('click', (e) => {
            if (e.target.closest('#header-chart-btn')) return
            toggleSearchPanel(false)
        })
        renderSearchResults([], '')
    }

    function openSearchResult(type, releaseId, trackIndex, time = -1, resultIndex = -1) {
        const release = releases[releaseId]
        if (!release) return
        // Строку берём до закрытия панели: toggleSearchPanel очищает выдачу.
        const result = lastResults[resultIndex]
        const line = result && result.releaseId === releaseId && result.trackIndex === trackIndex ? result.line : ''
        toggleSearchPanel(false)

        if (type === 'lyric' && trackIndex >= 0 && release.tracks[trackIndex]) {
            if (Number.isFinite(time) && time >= 0) {
                // Есть .lrc: трек с этой строки, полноэкранный плеер в караоке.
                ctx.modules.router.goRelease(releaseId)
                ctx.modules.player.playTrackByRef(releaseId, trackIndex, 'fade')
                ctx.modules.player.seekTo(time)
                ctx.modules.lyrics.revealKaraokeAt(time)
                ctx.modules.fullscreen.openFsLyrics()
            } else {
                // Нет .lrc: страница трека, прокрутка к строке, трек не запускаем.
                ctx.modules.router.goTrack(releaseId, trackIndex)
                if (line) focusLyricLine(releaseId, trackIndex, line)
            }
            return
        }

        ctx.modules.router.goRelease(releaseId)
        if (type === 'release' || trackIndex < 0) return
        // Трек запускаем явно по (релиз, индекс): на отрисовку страницы
        // релиза не рассчитываем — она плеер не трогает.
        ctx.modules.player.playTrackByRef(releaseId, trackIndex, 'fade')
    }

    return { toggleSearchPanel, renderSearchResults, searchCatalog, handleSearchInput, initGlobalSearch, openSearchResult }
}
