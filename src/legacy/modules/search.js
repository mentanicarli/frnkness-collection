export function createSearchModule(ctx) {
    const { dom, state, perf, releases, utils, LYRICS_INDEX_URL } = ctx
    const { parseLRC, escapeHtml, debounce, createMatcher, normalizeForSearch } = utils

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

    function lrcKey(release, track) {
        const base = track.lyricsFile.replace(/\.[^/.]+$/, '')
        return release.lyricsPath + base + '.lrc'
    }

    function txtKey(release, track) {
        return release.lyricsPath + track.lyricsFile
    }

    function pushLine(entries, releaseId, release, trackIndex, track, line, time) {
        entries.push({
            releaseId, releaseTitle: release.title, trackIndex,
            trackTitle: track.title, line,
            normalized: normalizeForSearch(line), time
        })
    }

    // Строки из .lrc — со временем: клик по ним открывает караоке.
    function collectLrcLines(entries, releaseId, release, trackIndex, track, lrc) {
        parseLRC(lrc).forEach(item => {
            const clean = (item.text || '').trim()
            if (clean) pushLine(entries, releaseId, release, trackIndex, track, clean, item.time)
        })
    }

    // Строки из .txt (трек без караоке) — без времени: клик ведёт на страницу
    // трека. Пустые строки и метки вида [Припев] не ищутся.
    function collectTxtLines(entries, releaseId, release, trackIndex, track, txt) {
        String(txt).split('\n').forEach(raw => {
            const clean = raw.trim()
            if (!clean || /^\[.+\]$/.test(clean)) return
            pushLine(entries, releaseId, release, trackIndex, track, clean, -1)
        })
    }

    // Индекс, собранный на этапе сборки: один файл вместо запроса на трек.
    // Если его нет (или он битый), возвращаем null и уходим на обход по файлам.
    async function fetchPrebuiltIndex() {
        if (!LYRICS_INDEX_URL) return null
        try {
            // no-cache: свежий индекс сразу после публикации из админки.
            const res = await fetch(LYRICS_INDEX_URL, { cache: 'no-cache' })
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
                        const txt = prebuilt[txtKey(release, track)]
                        if (lrc) collectLrcLines(entries, releaseId, release, trackIndex, track, lrc)
                        else if (txt) collectTxtLines(entries, releaseId, release, trackIndex, track, txt)
                        return
                    }
                    tasks.push(async () => {
                        const lrc = await ctx.modules.lyrics.fetchTrackLrc(release, track)
                        if (lrc) {
                            collectLrcLines(entries, releaseId, release, trackIndex, track, lrc)
                            return
                        }
                        // Запасной путь без собранного индекса: .lrc, а если его нет — .txt.
                        const txt = await ctx.modules.lyrics.fetchTrackTxt(release, track)
                        if (txt) collectTxtLines(entries, releaseId, release, trackIndex, track, txt)
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

    // Совпадение только с начала слова (см. utils/search.ts). Сначала
    // результаты, где слово совпало целиком, потом — по началу слова;
    // внутри одного ранга порядок прежний: релизы, треки, строки.
    function searchCatalog(query) {
        const normalized = normalizeForSearch(query)
        if (!normalized) return []

        const cacheKey = `${normalized}|${state.lyricsIndexReady ? 1 : 0}|${state.lyricsIndex.length}`
        const cached = perf.searchCache.get(cacheKey)
        if (cached) return cached

        const match = createMatcher(normalized)
        const results = []

        Object.entries(releases).forEach(([releaseId, release]) => {
            const releaseRank = match(release.title)
            if (releaseRank) {
                results.push({ type: 'release', releaseId, title: release.title, trackIndex: -1, line: '', time: -1, rank: releaseRank })
            }
            release.tracks.forEach((track, trackIndex) => {
                const trackRank = match(track.title)
                if (trackRank) {
                    results.push({ type: 'track', releaseId, title: release.title, trackTitle: track.title, trackIndex, line: '', time: -1, rank: trackRank })
                }
            })
        })

        if (state.lyricsIndexReady) {
            const seenLyricKeys = new Set()
            state.lyricsIndex.forEach(item => {
                const rank = match(item.normalized)
                if (!rank) return
                const dedupeKey = `${item.releaseId}|${item.trackIndex}|${item.normalized}`
                if (seenLyricKeys.has(dedupeKey)) return
                seenLyricKeys.add(dedupeKey)
                results.push({ type: 'lyric', releaseId: item.releaseId, title: item.releaseTitle, trackTitle: item.trackTitle, trackIndex: item.trackIndex, line: item.line, time: item.time, rank })
            })
        }

        // sort стабильный: внутри ранга сохраняется исходный порядок.
        results.sort((a, b) => b.rank - a.rank)
        const output = results.slice(0, 28)
        perf.searchCache.set(cacheKey, output)
        if (perf.searchCache.size > 45) perf.searchCache.delete(perf.searchCache.keys().next().value)
        return output
    }

    function handleSearchInput(value) {
        const query = normalizeForSearch(value)
        const baseResults = searchCatalog(query)
        renderSearchResults(baseResults, query)
        if (!query || state.lyricsIndexReady || state.lyricsIndexPromise) return
        ensureLyricsIndex().then(() => {
            perf.searchCache.clear()
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
                if (line) ctx.modules.track.focusLyricLine(releaseId, trackIndex, line)
            }
            return
        }

        ctx.modules.router.goRelease(releaseId)
        if (type === 'release' || trackIndex < 0) return
        // Трек запускаем явно по (релиз, индекс): на отрисовку страницы
        // релиза не рассчитываем — она плеер не трогает.
        ctx.modules.player.playTrackByRef(releaseId, trackIndex, 'fade')
    }

    return { toggleSearchPanel, renderSearchResults, ensureLyricsIndex, searchCatalog, handleSearchInput, initGlobalSearch, openSearchResult }
}
