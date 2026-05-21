export function createLyricsModule(ctx) {
    const { dom, state, utils } = ctx
    const { parseLRC } = utils

    async function fetchTrackLyrics(release, track) {
        const base = track.lyricsFile.replace(/\.[^/.]+$/, '')
        let txt = '', lrc = ''
        try {
            const txtRes = await fetch(release.lyricsPath + track.lyricsFile)
            if (txtRes.ok) txt = await txtRes.text()
        } catch { }
        try {
            const lrcRes = await fetch(release.lyricsPath + base + '.lrc')
            if (lrcRes.ok) lrc = await lrcRes.text()
        } catch { }
        return { txt, lrc }
    }

    function updateKaraoke() {
        if (state.lyricsMode !== 'karaoke' || !state.parsedLyrics.length) return

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
            const prevIndex = state.currentLyricIndex
            state.currentLyricIndex = newIndex
            ;[
                { container: dom.lyricsContent, lines: state.lyricsNodes.regular },
                { container: dom.fsLyricsBody, lines: state.lyricsNodes.fullscreen }
            ].forEach(({ container, lines }) => {
                if (!container || !lines.length) return
                if (prevIndex !== -1 && lines[prevIndex]) {
                    lines[prevIndex].classList.remove('active', 'entering')
                }
                if (newIndex !== -1 && lines[newIndex]) {
                    const active = lines[newIndex]
                    active.classList.add('active', 'entering')
                    requestAnimationFrame(() => active.classList.remove('entering'))
                    const isKaraokeMode = container === dom.fsLyricsBody && state.lyricsMode === 'karaoke'
                    const isMobileScreen = window.innerWidth <= 768
                    if (isKaraokeMode && typeof active.scrollIntoView === 'function' && !isMobileScreen) {
                        active.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
                    } else {
                        const verticalOffset = 0.4
                        const targetTop = active.offsetTop - (container.clientHeight * verticalOffset) + (active.clientHeight / 2)
                        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
                        const clampedTop = Math.max(0, Math.min(targetTop, maxTop))
                        if (Math.abs(container.scrollTop - clampedTop) > 8) {
                            container.scrollTo({ top: clampedTop, behavior: 'smooth' })
                        }
                    }
                }
            })
        }

        if (state.karaokeHardStart && currentTime > 1.2) state.karaokeHardStart = false
    }

    function updateLyricsModeControls(hasKaraoke) {
        ;[dom.lyricsModeSwitch, dom.fsLyricsModeSwitch].forEach(el => {
            if (!el) return
            el.classList.toggle('hidden', !hasKaraoke)
            el.classList.toggle('flex', hasKaraoke)
        })
        ;[dom.lyricsModeText, dom.fsLyricsModeText].forEach(btn => {
            if (!btn) return
            btn.classList.toggle('bg-white/10', state.lyricsMode === 'text')
            btn.classList.toggle('text-[var(--fg)]', state.lyricsMode === 'text')
            btn.classList.toggle('text-[var(--fg-muted)]', state.lyricsMode !== 'text')
        })
        ;[dom.lyricsModeKaraoke, dom.fsLyricsModeKaraoke].forEach(btn => {
            if (!btn) return
            btn.classList.toggle('bg-white/10', state.lyricsMode === 'karaoke')
            btn.classList.toggle('text-[var(--fg)]', state.lyricsMode === 'karaoke')
            btn.classList.toggle('text-[var(--fg-muted)]', state.lyricsMode !== 'karaoke')
        })
    }

    function renderLyricsByMode() {
        const hasKaraoke = state.parsedLyrics.length > 0
        const plainText = state.currentLyricsPlainText || 'Текст не найден'

        if (hasKaraoke && state.lyricsMode === 'karaoke') {
            const render = l => l.map(x => `<p class="lrc-line" onclick="App.seekTo(${x.time})">${x.text || '...'}</p>`).join('')
            const renderFs = l => l.map(x => `<p class="fs-lrc-line" onclick="App.seekTo(${x.time})">${x.text || '...'}</p>`).join('')
            if (dom.lyricsContent) dom.lyricsContent.innerHTML = render(state.parsedLyrics)
            if (dom.fsLyricsBody) dom.fsLyricsBody.innerHTML = renderFs(state.parsedLyrics)
            state.lyricsNodes.regular = dom.lyricsContent ? Array.from(dom.lyricsContent.querySelectorAll('.lrc-line')) : []
            state.lyricsNodes.fullscreen = dom.fsLyricsBody ? Array.from(dom.fsLyricsBody.querySelectorAll('.fs-lrc-line')) : []
            if (dom.lyricsContent) dom.lyricsContent.scrollTop = 0
            if (dom.fsLyricsBody) dom.fsLyricsBody.scrollTop = 0

            const shouldHardStart = !Number.isFinite(dom.audio.currentTime) || dom.audio.currentTime <= 1.2
            if (shouldHardStart && state.parsedLyrics.length) {
                state.currentLyricIndex = 0
                state.karaokeHardStart = true
                const firstRegular = state.lyricsNodes.regular[0]
                if (firstRegular) firstRegular.classList.add('active')
                const firstFullscreen = state.lyricsNodes.fullscreen[0]
                if (firstFullscreen) {
                    firstFullscreen.classList.add('active')
                    if (typeof firstFullscreen.scrollIntoView === 'function') {
                        firstFullscreen.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
                    }
                }
            } else {
                state.currentLyricIndex = -1
                state.karaokeHardStart = false
                updateKaraoke()
            }
        } else {
            const html = plainText.split('\n').map(l => `<p class="mb-2">${l || '&nbsp;'}</p>`).join('')
            if (dom.lyricsContent) dom.lyricsContent.innerHTML = html
            if (dom.fsLyricsBody) dom.fsLyricsBody.innerHTML = html
            state.lyricsNodes.regular = []
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

    async function loadLyrics(index) {
        if (!state.currentRelease) return
        const track = state.currentRelease.tracks[index]
        if (!track) return

        const base = track.lyricsFile.replace(/\.[^/.]+$/, '')
        let plainText = 'Текст не найден'
        let lrcText = ''

        state.currentLyricsTrackIndex = index
        state.currentLyricIndex = -1

        try {
            const res = await fetch(state.currentRelease.lyricsPath + base + '.lrc')
            if (res.ok) lrcText = await res.text()
        } catch { }

        try {
            const res = await fetch(state.currentRelease.lyricsPath + track.lyricsFile)
            if (res.ok) plainText = await res.text()
        } catch { }

        const lyricsTrackTitle = document.getElementById('lyrics-track-title')
        if (lyricsTrackTitle) lyricsTrackTitle.textContent = track.title

        state.currentLyricsPlainText = plainText
        state.currentLyricsLrcRaw = lrcText
        state.parsedLyrics = lrcText ? parseLRC(lrcText) : []

        if (state.parsedLyrics.length && state.preferredLyricsMode === 'karaoke') {
            state.lyricsMode = 'karaoke'
        } else {
            state.lyricsMode = 'text'
        }

        renderLyricsByMode()
    }

    function showLyrics(index) {
        loadLyrics(index)
        if (dom.lyricsPanel) dom.lyricsPanel.classList.add('open')
    }

    function closeLyrics() {
        if (dom.lyricsPanel) dom.lyricsPanel.classList.remove('open')
    }

    function toggleLyrics() {
        if (dom.lyricsPanel) dom.lyricsPanel.classList.toggle('open')
    }

    return { fetchTrackLyrics, updateKaraoke, renderLyricsByMode, setLyricsMode, loadLyrics, showLyrics, closeLyrics, toggleLyrics }
}
