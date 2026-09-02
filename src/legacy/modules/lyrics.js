export function createLyricsModule(ctx) {
    const { dom, state, utils } = ctx
    const { buildAssetUrl, parseLRC } = utils

    // Синхротекст трека. Используется индексом поиска, которому нужен только .lrc,
    // поэтому обычный .txt здесь не запрашивается.
    async function fetchTrackLrc(release, track) {
        const base = track.lyricsFile.replace(/\.[^/.]+$/, '')
        try {
            const res = await fetch(buildAssetUrl(release.lyricsPath, base + '.lrc'))
            if (!res.ok) return ''
            const text = await res.text()
            return isHtmlPayload(res, text) ? '' : text
        } catch {
            return ''
        }
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
            const container = dom.fsLyricsBody
            const lines = state.lyricsNodes.fullscreen
            if (container && lines.length) {
                lines.forEach((el, i) => {
                    el.classList.remove('active', 'd1', 'd2', 'd3')
                    const d = Math.abs(i - newIndex)
                    if (d === 0) el.classList.add('active')
                    else if (d === 1) el.classList.add('d1')
                    else if (d === 2) el.classList.add('d2')
                    else if (d === 3) el.classList.add('d3')
                })
                const active = lines[newIndex]
                if (active && !state.karaokeJustOpened) {
                    requestAnimationFrame(() => {
                        if (!container.clientHeight) return
                        const targetTop = active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2
                        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
                        const clampedTop = Math.max(0, Math.min(targetTop, maxTop))
                        if (Math.abs(container.scrollTop - clampedTop) > 8) {
                            container.scrollTo({ top: clampedTop, behavior: 'smooth' })
                        }
                    })
                }
            }
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
        const plainHtml = plainText.split('\n').map(l => `<p class="mb-2">${l || '&nbsp;'}</p>`).join('')

        // Мини-панель: ВСЕГДА обычный текст
        if (dom.lyricsContent) dom.lyricsContent.innerHTML = plainHtml
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

    function isHtmlPayload(res, text) {
        const contentType = (res?.headers?.get('content-type') || '').toLowerCase()
        if (contentType.includes('text/html')) return true
        return /<!doctype html|<html|<head|<link|<body/i.test(text || '')
    }

    async function loadLyrics(index) {
        if (!state.currentRelease) return
        const track = state.currentRelease.tracks[index]
        if (!track) return

        const base = track.lyricsFile.replace(/\.[^/.]+$/, '')
        const missingText = 'Текст будет позже...'
        let plainText = missingText
        let lrcText = ''

        state.currentLyricsTrackIndex = index
        state.currentLyricIndex = -1

        try {
            const res = await fetch(buildAssetUrl(state.currentRelease.lyricsPath, base + '.lrc'))
            if (res.ok) {
                const text = await res.text()
                if (!isHtmlPayload(res, text)) lrcText = text
            }
        } catch { }

        try {
            const res = await fetch(buildAssetUrl(state.currentRelease.lyricsPath, track.lyricsFile))
            if (res.ok) {
                const text = await res.text()
                if (!isHtmlPayload(res, text) && text.trim()) plainText = text
            }
        } catch { }

        const lyricsTrackTitle = document.getElementById('lyrics-track-title')
        if (lyricsTrackTitle) lyricsTrackTitle.textContent = track.title
        const fsCoverTitle = document.getElementById('fs-cover-title')
        if (fsCoverTitle) fsCoverTitle.textContent = track.title

        state.currentLyricsPlainText = plainText
        state.currentLyricsLrcRaw = lrcText
        state.parsedLyrics = lrcText ? parseLRC(lrcText) : []

        // Полноэкранный режим — всегда караоке при наличии синхротекста.
        state.lyricsMode = state.parsedLyrics.length ? 'karaoke' : 'text'

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

    return { fetchTrackLrc, updateKaraoke, renderLyricsByMode, setLyricsMode, loadLyrics, showLyrics, closeLyrics, toggleLyrics }
}
