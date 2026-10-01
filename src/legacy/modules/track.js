/**
 * Страница отдельного трека: обложка, метаданные, описание, текст с
 * разборами строк и ссылки на соседние треки релиза.
 */
export function createTrackModule(ctx) {
    const { dom, state, releases, utils, TRACK_NOTES_URL } = ctx
    const { buildAssetUrl, escapeHtml, getTrackSlug, buildNoteMap, renderLyricsHtml, renderAboutHtml, normalizeForSearch } = utils
    // Сопоставление разборов со строками живёт в src/utils/trackNotes.ts:
    // тем же кодом рендерит предпросмотр админка.

    // Разборы и описания подгружаются одним файлом на весь сайт и кэшируются.
    let notesPromise = null
    let notesBundle = null

    function loadNotes() {
        if (notesBundle) return Promise.resolve(notesBundle)
        if (!TRACK_NOTES_URL) return Promise.resolve({})
        if (!notesPromise) {
            // no-cache: дешёвая проверка по ETag, чтобы разборы из админки
            // были видны сразу, а не через 10 минут HTTP-кэша GitHub Pages.
            notesPromise = fetch(TRACK_NOTES_URL, { cache: 'no-cache' })
                .then(res => (res.ok ? res.json() : {}))
                .then(data => {
                    notesBundle = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
                    return notesBundle
                })
                .catch(() => {
                    notesBundle = {}
                    return notesBundle
                })
        }
        return notesPromise
    }

    function notesKey(release, track) {
        const base = track.lyricsFile.replace(/\.[^/.]+$/, '')
        return release.lyricsPath + base + '.notes.json'
    }

    // Тот же файл, что грузит плеер: если трек играет, запроса второй раз не будет.
    async function fetchPlainLyrics(release, track) {
        const text = await ctx.modules.lyrics.fetchTrackTxt(release, track)
        return text.trim() ? text : ''
    }

    function renderSiblings(releaseId, release, currentIndex) {
        if (release.tracks.length < 2) return ''
        const items = release.tracks
            .map((track, index) => {
                if (index === currentIndex) return ''
                const slug = escapeHtml(getTrackSlug(track))
                return `
                    <a class="track-sibling" href="#/track/${escapeHtml(releaseId)}/${slug}">
                        <span class="track-sibling-num">${String(track.num).padStart(2, '0')}</span>
                        <span class="track-sibling-title">${escapeHtml(track.title)}</span>
                    </a>
                `
            })
            .join('')
        return `
            <section class="track-section">
                <h2 class="track-section-title">Другие треки релиза</h2>
                <div class="track-siblings">${items}</div>
            </section>
        `
    }

    function bindNoteToggles(root) {
        root.querySelectorAll('.lyric-line.has-note').forEach(line => {
            const toggle = () => {
                const target = document.getElementById(line.dataset.noteTarget)
                if (!target) return
                const willOpen = target.hasAttribute('hidden')
                if (willOpen) target.removeAttribute('hidden')
                else target.setAttribute('hidden', '')
                line.classList.toggle('open', willOpen)
                line.setAttribute('aria-expanded', willOpen ? 'true' : 'false')
            }
            line.addEventListener('click', toggle)
            line.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                toggle()
            })
        })
    }

    // Переход из поиска к строке текста: страница трека дорисовывается
    // асинхронно, поэтому запрос ждёт, пока текст этого трека появится на экране.
    let pendingLineFocus = null
    let renderedLyricsKey = null

    function focusLyricLine(releaseId, trackIndex, line) {
        pendingLineFocus = { key: `${releaseId}:${trackIndex}`, line }
        applyPendingLineFocus()
    }

    function applyPendingLineFocus() {
        const request = pendingLineFocus
        const page = dom.trackPage
        if (!request || !page || request.key !== renderedLyricsKey || !page.classList.contains('active')) return
        pendingLineFocus = null
        const target = normalizeForSearch(request.line)
        const lines = page.querySelectorAll('.track-lyrics-body .lyric-line:not(.is-blank)')
        const found = Array.from(lines).find(el => normalizeForSearch(el.textContent) === target)
        if (!found) return
        found.scrollIntoView({ block: 'center' })
        // Перезапуск анимации, если строку уже подсвечивали.
        found.classList.remove('lyric-line-found')
        void found.offsetWidth
        found.classList.add('lyric-line-found')
        setTimeout(() => found.classList.remove('lyric-line-found'), 2600)
    }

    // Токен последней отрисовки: асинхронные куски (текст, разборы, счётчик)
    // применяются только если пользователь ещё не ушёл на другой трек.
    let renderToken = 0

    async function renderTrackPage(releaseId, trackIndex) {
        const container = dom.trackPage
        const release = releases[releaseId]
        const track = release && release.tracks[trackIndex]
        if (!container || !track) return

        const token = ++renderToken
        renderedLyricsKey = null
        const cover = release.cover
        const kind = release.type === 'album' ? 'Альбом' : 'Сингл'
        const dateDisplay = release.releaseDate || release.year

        // Открытый на экране релиз; плеер (state.currentRelease*) не трогаем.
        state.viewedReleaseId = releaseId
        ctx.modules.colors.updatePageAccent(cover)

        container.innerHTML = `
            <div class="shell shell-narrow px-6 track-page-inner">
                <a class="track-back" href="#/release/${escapeHtml(releaseId)}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    <span>${escapeHtml(release.title)}</span>
                </a>

                <div class="track-hero">
                    <div class="track-hero-cover">
                        <img src="${cover}" alt="${escapeHtml(release.title)}" loading="eager" decoding="async" fetchpriority="high" onerror="this.style.display='none'">
                    </div>
                    <div class="track-hero-main">
                        <p class="track-hero-kind">${kind} • ${escapeHtml(dateDisplay)}</p>
                        <h1 class="track-hero-title">${escapeHtml(track.title)}</h1>
                        <p class="track-hero-artist">frnk ness</p>
                        <p class="track-hero-meta" id="track-hero-meta">Трек ${track.num} из ${release.tracks.length}</p>
                        <div class="track-hero-actions">
                            <button class="track-play-btn" onclick="App.playTrackFromPage('${escapeHtml(releaseId)}', ${trackIndex})">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                                <span>Слушать</span>
                            </button>
                            <button class="track-share-btn" onclick="App.copyTrackLink(this)">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                <span>Скопировать ссылку</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div id="track-dynamic">
                    <section class="track-section">
                        <h2 class="track-section-title">Текст</h2>
                        <div class="track-lyrics-body"><p class="track-lyrics-empty">Загружаем текст...</p></div>
                    </section>
                </div>

                ${renderSiblings(releaseId, release, trackIndex)}
            </div>
        `

        window.scrollTo(0, 0)

        const [notes, lyricsText] = await Promise.all([loadNotes(), fetchPlainLyrics(release, track)])
        if (token !== renderToken) return

        const entry = notes[notesKey(release, track)] || null
        const noteMap = buildNoteMap(entry)
        const dynamic = container.querySelector('#track-dynamic')
        if (!dynamic) return

        const lyrics = renderLyricsHtml(lyricsText, noteMap)
        dynamic.innerHTML = `
            ${renderAboutHtml(entry)}
            <section class="track-section">
                <h2 class="track-section-title">Текст</h2>
                <div class="track-lyrics-body">${lyrics.html}</div>
            </section>
        `
        bindNoteToggles(dynamic)
        renderedLyricsKey = `${releaseId}:${trackIndex}`
        applyPendingLineFocus()

        // Счётчик прослушиваний приходит позже и не блокирует отрисовку.
        ctx.modules.chart.getTrackPlayCount(releaseId, trackIndex).then(plays => {
            if (token !== renderToken) return
            const meta = container.querySelector('#track-hero-meta')
            if (!meta) return
            const base = `Трек ${track.num} из ${release.tracks.length}`
            meta.textContent = plays > 0 ? `${base} • ${plays} ${pluralPlays(plays)}` : base
        })
    }

    function pluralPlays(count) {
        const mod10 = count % 10
        const mod100 = count % 100
        if (mod10 === 1 && mod100 !== 11) return 'прослушивание'
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'прослушивания'
        return 'прослушиваний'
    }

    // Запуск трека со страницы: явно по (релиз, индекс), не уходя со страницы.
    function playTrackFromPage(releaseId, trackIndex) {
        ctx.modules.player.playTrackByRef(releaseId, trackIndex, 'fade')
    }

    async function copyTrackLink(button) {
        const url = window.location.href
        const label = button && button.querySelector('span')
        const done = () => {
            if (!label) return
            const previous = label.textContent
            label.textContent = 'Ссылка скопирована'
            setTimeout(() => { label.textContent = previous }, 1600)
        }
        try {
            await navigator.clipboard.writeText(url)
            done()
        } catch {
            // Clipboard API недоступен (http или отказ в доступе) — выделяем
            // адрес через временное поле, это работает везде.
            const input = document.createElement('input')
            input.value = url
            document.body.appendChild(input)
            input.select()
            try { document.execCommand('copy'); done() } catch { /* молча */ }
            document.body.removeChild(input)
        }
    }

    return { renderTrackPage, playTrackFromPage, copyTrackLink, focusLyricLine }
}
