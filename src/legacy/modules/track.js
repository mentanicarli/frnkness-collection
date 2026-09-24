/**
 * Страница отдельного трека: обложка, метаданные, описание, текст с
 * разборами строк и ссылки на соседние треки релиза.
 */
export function createTrackModule(ctx) {
    const { dom, state, releases, utils, TRACK_NOTES_URL } = ctx
    const { buildAssetUrl, escapeHtml, getTrackSlug } = utils

    // Разборы и описания подгружаются одним файлом на весь сайт и кэшируются.
    let notesPromise = null
    let notesBundle = null

    function loadNotes() {
        if (notesBundle) return Promise.resolve(notesBundle)
        if (!TRACK_NOTES_URL) return Promise.resolve({})
        if (!notesPromise) {
            notesPromise = fetch(TRACK_NOTES_URL)
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

    // Строки сравниваем без учёта регистра, лишних пробелов и знаков по
    // краям. Иначе разбор отваливался бы из-за запятой в конце строки,
    // которую легко не скопировать при написании комментария.
    const EDGE_PUNCTUATION = /^[\s"'«»(\[]+|[\s"'«»)\],.!?;:—–-]+$/g

    function normalizeLine(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(EDGE_PUNCTUATION, '')
            .toLowerCase()
    }

    function buildNoteMap(entry) {
        const map = new Map()
        const list = entry && Array.isArray(entry.annotations) ? entry.annotations : []
        list.forEach(item => {
            if (!item || !item.line || !item.note) return
            map.set(normalizeLine(item.line), String(item.note))
        })
        return map
    }

    async function fetchPlainLyrics(release, track) {
        try {
            const res = await fetch(buildAssetUrl(release.lyricsPath, track.lyricsFile))
            if (!res.ok) return ''
            const text = await res.text()
            const contentType = (res.headers.get('content-type') || '').toLowerCase()
            if (contentType.includes('text/html')) return ''
            if (/<!doctype html|<html|<head|<body/i.test(text)) return ''
            return text.trim() ? text : ''
        } catch {
            return ''
        }
    }

    function renderLyrics(text, noteMap) {
        if (!text) {
            return { html: '<p class="track-lyrics-empty">Текст будет позже...</p>', annotated: 0 }
        }

        let noteIndex = 0
        // Разбор вешаем только на первое вхождение строки: иначе припев,
        // повторённый пять раз, подчёркивал бы полтекста одним и тем же
        // комментарием.
        const used = new Set()
        const html = text
            .split('\n')
            .map(rawLine => {
                const line = rawLine.trim()
                if (!line) return '<p class="lyric-line is-blank">&nbsp;</p>'

                // [Припев], [Куплет 2] и прочие метки секций — не строки песни,
                // поэтому они и не подсвечиваются, и не принимают разборы.
                if (/^\[.+\]$/.test(line)) {
                    return `<p class="lyric-section">${escapeHtml(line)}</p>`
                }

                const key = normalizeLine(line)
                const note = used.has(key) ? null : noteMap.get(key)
                if (!note) return `<p class="lyric-line">${escapeHtml(line)}</p>`
                used.add(key)

                const id = `lyric-note-${noteIndex++}`
                return `
                    <p class="lyric-line has-note" role="button" tabindex="0"
                       aria-expanded="false" aria-controls="${id}"
                       data-note-target="${id}">${escapeHtml(line)}</p>
                    <div class="lyric-note" id="${id}" hidden>${escapeHtml(note)}</div>
                `
            })
            .join('')
        return { html, annotated: noteIndex }
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

    function renderAbout(entry) {
        const about = entry && typeof entry.about === 'string' ? entry.about.trim() : ''
        if (!about) return ''
        const paragraphs = about
            .split(/\n{2,}/)
            .map(block => `<p>${escapeHtml(block.trim())}</p>`)
            .join('')
        return `
            <section class="track-section">
                <h2 class="track-section-title">О треке</h2>
                <div class="track-about">${paragraphs}</div>
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

    // Токен последней отрисовки: асинхронные куски (текст, разборы, счётчик)
    // применяются только если пользователь ещё не ушёл на другой трек.
    let renderToken = 0

    async function renderTrackPage(releaseId, trackIndex) {
        const container = dom.trackPage
        const release = releases[releaseId]
        const track = release && release.tracks[trackIndex]
        if (!container || !track) return

        const token = ++renderToken
        const cover = release.cover
        const kind = release.type === 'album' ? 'Альбом' : 'Сингл'
        const dateDisplay = release.releaseDate || release.year

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

        const lyrics = renderLyrics(lyricsText, noteMap)
        const noteCount = lyrics.annotated
        dynamic.innerHTML = `
            ${renderAbout(entry)}
            <section class="track-section">
                <h2 class="track-section-title">
                    Текст
                    ${noteCount ? `<span class="track-note-hint">${noteCount} ${pluralNotes(noteCount)} — нажмите на подчёркнутую строку</span>` : ''}
                </h2>
                <div class="track-lyrics-body">${lyrics.html}</div>
            </section>
        `
        bindNoteToggles(dynamic)

        // Счётчик прослушиваний приходит позже и не блокирует отрисовку.
        ctx.modules.chart.getTrackPlayCount(releaseId, trackIndex).then(plays => {
            if (token !== renderToken) return
            const meta = container.querySelector('#track-hero-meta')
            if (!meta) return
            const base = `Трек ${track.num} из ${release.tracks.length}`
            meta.textContent = plays > 0 ? `${base} • ${plays} ${pluralPlays(plays)}` : base
        })
    }

    function pluralNotes(count) {
        const mod10 = count % 10
        const mod100 = count % 100
        if (mod10 === 1 && mod100 !== 11) return 'разбор'
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'разбора'
        return 'разборов'
    }

    function pluralPlays(count) {
        const mod10 = count % 10
        const mod100 = count % 100
        if (mod10 === 1 && mod100 !== 11) return 'прослушивание'
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'прослушивания'
        return 'прослушиваний'
    }

    // Запуск трека со страницы: релиз мог быть не открыт, поэтому ставим
    // его в состояние явно, не уходя при этом со страницы трека.
    function playTrackFromPage(releaseId, trackIndex) {
        const release = releases[releaseId]
        if (!release || !release.tracks[trackIndex]) return
        state.currentRelease = release
        state.currentReleaseId = releaseId
        ctx.modules.ui.renderTracklist()
        ctx.modules.player.playTrack(trackIndex, 'fade')
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

    return { renderTrackPage, playTrackFromPage, copyTrackLink }
}
