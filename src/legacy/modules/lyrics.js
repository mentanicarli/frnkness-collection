export function createLyricsModule(ctx) {
    const { dom, state, utils } = ctx
    const { buildAssetUrl, parseLRC, fetchTextFile } = utils

    // Адреса файлов текста трека. Загрузка — через fetchTextFile: один и тот же
    // файл плеер, страница трека и поиск получают одним запросом.
    function lrcUrl(release, track) {
        return buildAssetUrl(release.lyricsPath, track.lyricsFile.replace(/\.[^/.]+$/, '') + '.lrc')
    }

    function txtUrl(release, track) {
        return buildAssetUrl(release.lyricsPath, track.lyricsFile)
    }

    // Синхротекст трека. Используется запасным путём индекса поиска (когда нет
    // собранного lyrics-index.json); .txt для треков без караоке поиск берёт сам.
    function fetchTrackLrc(release, track) {
        return fetchTextFile(lrcUrl(release, track))
    }

    function fetchTrackTxt(release, track) {
        return fetchTextFile(txtUrl(release, track))
    }

    function updateKaraoke() {
        if (!state.parsedLyrics.length) return

        const currentTime = dom.audio.currentTime
        let newIndex
        const hardStartActive = Boolean(state.karaokeHardStart) && currentTime <= 1.2

        if (hardStartActive || currentTime < state.parsedLyrics[0].time) {
            newIndex = 0
        } else if (state.currentLyricIndex >= 0) {
            newIndex = state.currentLyricIndex
            while (newIndex + 1 < state.parsedLyrics.length && currentTime >= state.parsedLyrics[newIndex + 1].time) newIndex += 1
            while (newIndex > 0 && currentTime < state.parsedLyrics[newIndex].time) newIndex -= 1
        } else {
            newIndex = 0
            for (let i = state.parsedLyrics.length - 1; i >= 0; i--) {
                if (currentTime >= state.parsedLyrics[i].time) { newIndex = i; break }
            }
        }

        if (newIndex !== state.currentLyricIndex) {
            state.currentLyricIndex = newIndex
            markActiveLine(newIndex)
            if (!state.karaokeJustOpened) requestAnimationFrame(() => scrollToLine(newIndex, 'smooth'))
        }

        if (state.karaokeHardStart && currentTime > 1.2) state.karaokeHardStart = false
    }

    function markActiveLine(index) {
        state.lyricsNodes.fullscreen.forEach((el, i) => {
            el.classList.remove('active', 'd1', 'd2', 'd3')
            const d = Math.abs(i - index)
            if (d === 0) el.classList.add('active')
            else if (d === 1) el.classList.add('d1')
            else if (d === 2) el.classList.add('d2')
            else if (d === 3) el.classList.add('d3')
        })
    }

    function scrollToLine(index, behavior) {
        const container = dom.fsLyricsBody
        const active = state.lyricsNodes.fullscreen[index]
        if (!container || !active || !container.clientHeight) return
        const targetTop = active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2
        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
        const clampedTop = Math.max(0, Math.min(targetTop, maxTop))
        if (Math.abs(container.scrollTop - clampedTop) > 8) {
            container.scrollTo({ top: clampedTop, behavior })
        }
    }

    function lineIndexAt(time) {
        for (let i = state.parsedLyrics.length - 1; i >= 0; i--) {
            if (time >= state.parsedLyrics[i].time) return i
        }
        return 0
    }

    // Переход из поиска к строке караоке: дожидаемся текста трека и его
    // метаданных (к этому моменту seekTo уже перемотал), подсвечиваем строку
    // и сразу, без плавной прокрутки, ставим её по центру.
    async function revealKaraokeAt(time) {
        const session = state.playSession
        await loadPromise
        if (dom.audio.readyState < 1) {
            await new Promise(resolve => {
                dom.audio.addEventListener('loadedmetadata', resolve, { once: true })
                setTimeout(resolve, 8000)
            })
        }
        if (state.playSession !== session || !state.parsedLyrics.length) return
        state.karaokeHardStart = false
        state.karaokeJustOpened = false
        ctx.modules.fullscreen.syncFsPlayerModeState()
        const index = lineIndexAt(time)
        state.currentLyricIndex = index
        markActiveLine(index)
        requestAnimationFrame(() => scrollToLine(index, 'auto'))
    }

    function updateLyricsModeControls(hasKaraoke) {
        ;[dom.fsLyricsModeSwitch].forEach(el => {
            if (!el) return
            el.classList.toggle('hidden', !hasKaraoke)
            el.classList.toggle('flex', hasKaraoke)
        })
        ;[dom.fsLyricsModeText].forEach(btn => {
            if (!btn) return
            btn.classList.toggle('bg-white/10', state.lyricsMode === 'text')
            btn.classList.toggle('text-[var(--fg)]', state.lyricsMode === 'text')
            btn.classList.toggle('text-[var(--fg-muted)]', state.lyricsMode !== 'text')
        })
        ;[dom.fsLyricsModeKaraoke].forEach(btn => {
            if (!btn) return
            btn.classList.toggle('bg-white/10', state.lyricsMode === 'karaoke')
            btn.classList.toggle('text-[var(--fg)]', state.lyricsMode === 'karaoke')
            btn.classList.toggle('text-[var(--fg-muted)]', state.lyricsMode !== 'karaoke')
        })
    }

    function renderLyricsByMode() {
        const hasKaraoke = state.parsedLyrics.length > 0
        const plainText = state.currentLyricsPlainText || 'Текст не найден'
        // Метки секций вида [Припев] показываем приглушённо, а не как строку песни.
        const plainHtml = plainText.split('\n').map(l => {
            const line = l.trim()
            if (!line) return '<p class="mb-2">&nbsp;</p>'
            const cls = /^\[.+\]$/.test(line) ? 'mb-2 lyrics-section-label' : 'mb-2'
            return `<p class="${cls}">${line}</p>`
        }).join('')

        state.lyricsNodes.regular = []

        // Полноэкранный: караоке, если есть синхротекст, иначе обычный текст
        if (hasKaraoke) {
            const renderFs = l => l.map(x => `<p class="fs-lrc-line" onclick="App.seekTo(${x.time})">${x.text || '...'}</p>`).join('')
            if (dom.fsLyricsBody) dom.fsLyricsBody.innerHTML = renderFs(state.parsedLyrics)
            state.lyricsNodes.fullscreen = dom.fsLyricsBody ? Array.from(dom.fsLyricsBody.querySelectorAll('.fs-lrc-line')) : []
            if (dom.fsLyricsBody) dom.fsLyricsBody.scrollTop = 0
            state.karaokeJustOpened = true
            setTimeout(() => { state.karaokeJustOpened = false }, 3000)

            const shouldHardStart = !Number.isFinite(dom.audio.currentTime) || dom.audio.currentTime <= 1.2
            if (shouldHardStart && state.parsedLyrics.length) {
                state.currentLyricIndex = 0
                state.karaokeHardStart = true
                const firstFullscreen = state.lyricsNodes.fullscreen[0]
                if (firstFullscreen) {
                    firstFullscreen.classList.add('active')
                    if (dom.fsLyricsBody) dom.fsLyricsBody.scrollTop = 0
                }
            } else {
                state.currentLyricIndex = -1
                state.karaokeHardStart = false
                if (dom.fsLyricsBody) dom.fsLyricsBody.scrollTop = 0
                updateKaraoke()
            }
        } else {
            if (dom.fsLyricsBody) dom.fsLyricsBody.innerHTML = plainHtml
            state.lyricsNodes.fullscreen = []
            state.currentLyricIndex = -1
            state.karaokeHardStart = false
        }

        updateLyricsModeControls(hasKaraoke)
    }

    function setLyricsMode(mode) {
        if (!['text', 'karaoke'].includes(mode)) return
        if (mode === 'karaoke' && !state.parsedLyrics.length) return
        state.lyricsMode = mode
        state.preferredLyricsMode = mode
        renderLyricsByMode()
        ctx.modules.fullscreen.syncFsPlayerModeState()
    }

    // Промис последней загрузки текста: revealKaraokeAt ждёт именно его.
    let loadPromise = Promise.resolve()
    // Токен последней загрузки: ответ для трека, с которого уже переключились,
    // не должен перезаписать текст текущего (как renderToken в track.js).
    let loadToken = 0

    function loadLyrics(index) {
        loadPromise = fetchAndRenderLyrics(index).catch(() => {})
        return loadPromise
    }

    async function fetchAndRenderLyrics(index) {
        const release = state.currentRelease
        if (!release) return
        const track = release.tracks[index]
        if (!track) return

        const token = ++loadToken
        state.currentLyricsTrackIndex = index
        state.currentLyricIndex = -1

        // .lrc и .txt — параллельно.
        const [lrcText, txt] = await Promise.all([fetchTrackLrc(release, track), fetchTrackTxt(release, track)])
        // Пока грузили, заиграл другой трек — его текст уже грузится своим вызовом.
        if (token !== loadToken || state.currentRelease !== release || state.currentTrackIndex !== index) return
        const plainText = txt.trim() ? txt : 'Текст будет позже...'

        const fsCoverTitle = document.getElementById('fs-cover-title')
        if (fsCoverTitle) fsCoverTitle.textContent = track.title

        state.currentLyricsPlainText = plainText
        state.currentLyricsLrcRaw = lrcText
        state.parsedLyrics = lrcText ? parseLRC(lrcText) : []

        // Полноэкранный режим — всегда караоке при наличии синхротекста.
        state.lyricsMode = state.parsedLyrics.length ? 'karaoke' : 'text'

        renderLyricsByMode()
    }

    return { fetchTrackLrc, fetchTrackTxt, updateKaraoke, renderLyricsByMode, setLyricsMode, loadLyrics, revealKaraokeAt }
}
