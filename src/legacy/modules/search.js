export function createSearchModule(ctx) {
    const { dom, state, perf, releases, utils } = ctx
    const { parseLRC, normalizeSearchText, escapeHtml, debounce } = utils

    function toggleSearchPanel(forceState = null) {
        if (!dom.searchPanel) return
        const shouldOpen = forceState === null
            ? !dom.searchPanel.classList.contains('open')
            : Boolean(forceState)
        dom.searchPanel.classList.toggle('open', shouldOpen)
        if (dom.searchToggle) dom.searchToggle.classList.toggle('active', shouldOpen)
        if (dom.searchBackdrop) dom.searchBackdrop.classList.toggle('open', shouldOpen)
        document.body.classList.toggle('search-open', shouldOpen)
        if (shouldOpen && dom.searchInput) requestAnimationFrame(() => dom.searchInput.focus())
    }

    function renderSearchResults(results, query) {
        if (!dom.searchResults) return
        const normalized = normalizeSearchText(query)
        if (!normalized) {
            dom.searchResults.innerHTML = '<p class="text-sm text-[var(--fg-muted)]/85">Введите запрос, чтобы искать по релизам, трекам и строкам из текстов.</p>'
            return
        }
        if (!results.length) {
            dom.searchResults.innerHTML = '<p class="text-sm text-[var(--fg-muted)]">Ничего не найдено. Попробуйте другой запрос.</p>'
            return
        }
        const labels = { release: 'Альбом/релиз', track: 'Трек', lyric: 'Строка из текста' }
        const html = results.map(item => {
            const badge = labels[item.type] || 'Результат'
            const line = item.line ? `<p class="text-xs text-[var(--fg-muted)]/85 mt-1 line-clamp-2">${escapeHtml(item.line)}</p>` : ''
            const trackTitle = item.trackTitle ? `<p class="text-xs text-[var(--fg-muted)] mt-1">${escapeHtml(item.trackTitle)}</p>` : ''
            return `
                <button class="w-full text-left rounded-xl border border-white/8 bg-[var(--bg-card)]/55 hover:bg-[var(--bg-card)]/80 transition-colors p-4 mb-2"
                    onclick="App.openSearchResult('${item.type}', '${item.releaseId}', ${item.trackIndex ?? -1}, ${item.time ?? -1})">
                    <div class="flex items-start justify-between gap-4">
                        <div class="min-w-0">
                            <p class="text-sm font-medium text-[var(--fg)] truncate">${escapeHtml(item.title)}</p>
                            ${trackTitle}
                            ${line}
                        </div>
                        <span class="text-[10px] uppercase tracking-wider text-[var(--fg-muted)]/80 flex-shrink-0">${badge}</span>
                    </div>
                </button>
            `
        }).join('')
        dom.searchResults.innerHTML = `<div class="pb-2"><p class="text-xs uppercase tracking-widest text-[var(--fg-muted)] mb-3">Результаты: ${results.length}</p>${html}</div>`
    }

    async function ensureLyricsIndex() {
        if (state.lyricsIndexReady) return
        if (state.lyricsIndexPromise) return state.lyricsIndexPromise

        state.lyricsIndexPromise = (async () => {
            const entries = []
            const tasks = []

            Object.entries(releases).forEach(([releaseId, release]) => {
                release.tracks.forEach((track, trackIndex) => {
                    tasks.push(async () => {
                        const { lrc } = await ctx.modules.lyrics.fetchTrackLyrics(release, track)
                        if (!lrc) return
                        parseLRC(lrc).forEach(item => {
                            const clean = (item.text || '').trim()
                            if (!clean) return
                            entries.push({
                                releaseId, releaseTitle: release.title, trackIndex,
                                trackTitle: track.title, line: clean,
                                normalized: normalizeSearchText(clean), time: item.time
                            })
                        })
                    })
                })
            })

            const concurrency = 4
            let pointer = 0
            const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
                while (pointer < tasks.length) {
                    const taskIndex = pointer; pointer += 1
                    await tasks[taskIndex]()
                }
            })
            await Promise.all(workers)
            state.lyricsIndex = entries
            state.lyricsIndexReady = true
        })()

        try { await state.lyricsIndexPromise } finally { state.lyricsIndexPromise = null }
    }

    function searchCatalog(query) {
        const normalized = normalizeSearchText(query)
        if (!normalized) return []

        const cacheKey = `${normalized}|${state.lyricsIndexReady ? 1 : 0}|${state.lyricsIndex.length}`
        const cached = perf.searchCache.get(cacheKey)
        if (cached) return cached

        const results = []

        Object.entries(releases).forEach(([releaseId, release]) => {
            if (normalizeSearchText(release.title).includes(normalized)) {
                results.push({ type: 'release', releaseId, title: release.title, trackIndex: -1, line: '', time: -1 })
            }
            release.tracks.forEach((track, trackIndex) => {
                if (normalizeSearchText(track.title).includes(normalized)) {
                    results.push({ type: 'track', releaseId, title: release.title, trackTitle: track.title, trackIndex, line: '', time: -1 })
                }
            })
        })

        if (state.lyricsIndexReady) {
            const seenLyricKeys = new Set()
            state.lyricsIndex
                .filter(item => item.normalized.includes(normalized))
                .forEach(item => {
                    const dedupeKey = `${item.releaseId}|${item.trackIndex}|${item.normalized}`
                    if (seenLyricKeys.has(dedupeKey)) return
                    seenLyricKeys.add(dedupeKey)
                    results.push({ type: 'lyric', releaseId: item.releaseId, title: item.releaseTitle, trackTitle: item.trackTitle, trackIndex: item.trackIndex, line: item.line, time: item.time })
                })
        }

        const output = results.slice(0, 28)
        perf.searchCache.set(cacheKey, output)
        if (perf.searchCache.size > 45) perf.searchCache.delete(perf.searchCache.keys().next().value)
        return output
    }

    function handleSearchInput(value) {
        const query = normalizeSearchText(value)
        const baseResults = searchCatalog(query)
        renderSearchResults(baseResults, query)
        if (!query || state.lyricsIndexReady || state.lyricsIndexPromise) return
        ensureLyricsIndex().then(() => {
            perf.searchCache.clear()
            if (!dom.searchInput) return
            const freshQuery = normalizeSearchText(dom.searchInput.value)
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
        document.addEventListener('click', () => toggleSearchPanel(false))
        renderSearchResults([], '')
    }

    function openSearchResult(type, releaseId, trackIndex, time = -1) {
        if (!releases[releaseId]) return
        toggleSearchPanel(false)
        ctx.modules.ui.openRelease(releaseId)
        if (type === 'release' || trackIndex < 0) return
        setTimeout(() => {
            ctx.modules.player.playTrack(trackIndex, 'fade')
            if (type === 'lyric') {
                ctx.modules.lyrics.showLyrics(trackIndex)
                if (Number.isFinite(time) && time >= 0) ctx.modules.player.seekTo(time)
            }
        }, 120)
    }

    return { toggleSearchPanel, renderSearchResults, ensureLyricsIndex, searchCatalog, handleSearchInput, initGlobalSearch, openSearchResult }
}
