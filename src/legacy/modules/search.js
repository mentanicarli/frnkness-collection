export function createSearchModule(ctx) {
    const { dom, state, perf, releases, utils, LYRICS_INDEX_URL } = ctx
    const { parseLRC, normalizeSearchText, escapeHtml, debounce } = utils

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
        const normalized = normalizeSearchText(query)
        if (!normalized) {
            dom.searchResults.innerHTML = '<p class="text-sm text-[var(--fg-faint)] font-mono py-2">Введите запрос — релизы, треки и строки из текстов.</p>'
            return
        }
        if (!results.length) {
            dom.searchResults.innerHTML = '<p class="text-sm text-[var(--fg-faint)] font-mono py-2">Ничего не найдено.</p>'
            return
        }
        const labels = { release: 'Релиз', track: 'Трек', lyric: 'Строка' }
        const html = results.map(item => {
            const badge = labels[item.type] || 'Результат'
            const line = item.line ? `<p class="text-xs text-[var(--fg-muted)] mt-1 line-clamp-2 italic">${escapeHtml(item.line)}</p>` : ''
            const trackTitle = item.trackTitle ? `<p class="text-xs text-[var(--fg-muted)] mt-1">${escapeHtml(item.trackTitle)}</p>` : ''
            return `
                <button class="w-full text-left rounded-md hover:bg-[var(--bg-2)] transition-colors p-3 mb-0.5 flex items-center justify-between gap-4"
                    onclick="App.openSearchResult('${item.type}', '${item.releaseId}', ${item.trackIndex ?? -1}, ${item.time ?? -1})">
                    <div class="min-w-0">
                        <p class="text-sm font-semibold text-[var(--fg)] truncate">${escapeHtml(item.title)}</p>
                        ${trackTitle}
                        ${line}
                    </div>
                    <span class="font-mono text-[9px] uppercase tracking-wider text-[var(--fg-faint)] flex-shrink-0 border border-white/10 rounded px-2 py-1">${badge}</span>
                </button>
            `
        }).join('')
        dom.searchResults.innerHTML = `<p class="font-mono text-xs text-[var(--fg-faint)] mb-2">Результатов: ${results.length}</p>${html}`
    }

    function lrcKey(release, track) {
        const base = track.lyricsFile.replace(/\.[^/.]+$/, '')
        return release.lyricsPath + base + '.lrc'
    }

    function collectLines(entries, releaseId, release, trackIndex, track, lrc) {
        parseLRC(lrc).forEach(item => {
            const clean = (item.text || '').trim()
            if (!clean) return
            entries.push({
                releaseId, releaseTitle: release.title, trackIndex,
                trackTitle: track.title, line: clean,
                normalized: normalizeSearchText(clean), time: item.time
            })
        })
    }

    // Индекс, собранный на этапе сборки: один файл вместо запроса на трек.
    // Если его нет (или он битый), возвращаем null и уходим на обход по файлам.
    async function fetchPrebuiltIndex() {
        if (!LYRICS_INDEX_URL) return null
        try {
            const res = await fetch(LYRICS_INDEX_URL)
            if (!res.ok) return null
            const data = await res.json()
            return data && typeof data === 'object' && !Array.isArray(data) ? data : null
        } catch {
            return null
        }
    }

    async function ensureLyricsIndex() {
        if (state.lyricsIndexReady) return
        if (state.lyricsIndexPromise) return state.lyricsIndexPromise

        state.lyricsIndexPromise = (async () => {
            const entries = []
            const prebuilt = await fetchPrebuiltIndex()
            const tasks = []

            Object.entries(releases).forEach(([releaseId, release]) => {
                release.tracks.forEach((track, trackIndex) => {
                    if (prebuilt) {
                        const lrc = prebuilt[lrcKey(release, track)]
                        if (lrc) collectLines(entries, releaseId, release, trackIndex, track, lrc)
                        return
                    }
                    tasks.push(async () => {
                        const lrc = await ctx.modules.lyrics.fetchTrackLrc(release, track)
                        if (!lrc) return
                        collectLines(entries, releaseId, release, trackIndex, track, lrc)
                    })
                })
            })

            if (tasks.length) {
                const concurrency = 4
                let pointer = 0
                const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
                    while (pointer < tasks.length) {
                        const taskIndex = pointer; pointer += 1
                        await tasks[taskIndex]()
                    }
                })
                await Promise.all(workers)
            }

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
        document.addEventListener('click', (e) => {
            if (e.target.closest('#header-chart-btn')) return
            toggleSearchPanel(false)
        })
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
