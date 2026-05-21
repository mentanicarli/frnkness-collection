export function createFullscreenModule(ctx) {
    const { dom, state, perf } = ctx

    function openFsPlayer() {
        if (dom.fsPlayer) {
            dom.fsPlayer.classList.add('open')
            document.body.style.overflow = 'hidden'
            syncFsPlayerModeState()
        }
    }

    function closeFsPlayer() {
        if (dom.fsPlayer) {
            dom.fsPlayer.classList.remove('open')
            state.fsLyricsOpen = false
            perf.fsLyricsToggleGuardUntil = 0
            syncFsPlayerModeState()
            if (dom.fsLyricsToggle && typeof dom.fsLyricsToggle.blur === 'function') dom.fsLyricsToggle.blur()
            document.body.style.overflow = ''
        }
    }

    function updateFullscreen(title, cover, direction) {
        if (dom.fsTitle) dom.fsTitle.textContent = title
        if (dom.fsLyricsTitle) dom.fsLyricsTitle.textContent = title
        animateCover(cover, direction)
    }

    function animateCover(src, dir) {
        const active = state.currentCoverSlot === 'a' ? dom.fsCoverA : dom.fsCoverB
        const inactive = state.currentCoverSlot === 'a' ? dom.fsCoverB : dom.fsCoverA

        if (state.animationInProgress) {
            active.classList.remove('enter-left', 'enter-right')
            active.classList.add('active')
            inactive.classList.remove('active', 'exit-left', 'exit-right')
        }

        state.animationInProgress = true

        if (!dir) {
            active.src = src
            active.classList.add('active')
            active.classList.remove('exit-left', 'exit-right', 'enter-left', 'enter-right')
            inactive.classList.remove('active', 'exit-left', 'exit-right')
            state.animationInProgress = false
            return
        }

        inactive.src = src
        const [exitClass, enterClass] = dir === 'next' ? ['exit-left', 'enter-right'] : ['exit-right', 'enter-left']

        active.classList.remove('playing')
        inactive.classList.remove('playing')
        active.classList.remove('exit-left', 'exit-right', 'enter-left', 'enter-right')
        inactive.classList.remove('active', 'exit-left', 'exit-right', 'enter-left', 'enter-right')
        inactive.classList.add(enterClass)

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                active.classList.remove('active')
                active.classList.add(exitClass)
                inactive.classList.remove(enterClass)
                inactive.classList.add('active')
                state.currentCoverSlot = state.currentCoverSlot === 'a' ? 'b' : 'a'
                if (state.isPlaying) inactive.classList.add('playing')
                setTimeout(() => {
                    state.animationInProgress = false
                    active.classList.remove(exitClass)
                }, 650)
            })
        })
    }

    function updateFsPlayPauseIcon() {
        if (dom.fsIconPlay) dom.fsIconPlay.style.display = state.isPlaying ? 'none' : 'block'
        if (dom.fsIconPause) dom.fsIconPause.style.display = state.isPlaying ? 'block' : 'none'
        if (dom.fsPlayBtn) dom.fsPlayBtn.classList.toggle('playing', state.isPlaying)
        const active = state.currentCoverSlot === 'a' ? dom.fsCoverA : dom.fsCoverB
        const inactive = state.currentCoverSlot === 'a' ? dom.fsCoverB : dom.fsCoverA
        if (active) active.classList.toggle('playing', state.isPlaying)
        if (inactive) inactive.classList.remove('playing')
    }

    function syncFsPlayerModeState() {
        if (!dom.fsPlayer) return
        const karaokeOpen = state.fsLyricsOpen && state.lyricsMode === 'karaoke'
        const lyricsVisible = dom.fsPlayer.classList.contains('open') && state.fsLyricsOpen
        dom.fsPlayer.classList.toggle('lyrics-open', state.fsLyricsOpen)
        dom.fsPlayer.classList.toggle('karaoke-open', karaokeOpen)
        if (dom.fsLyricsToggle) {
            dom.fsLyricsToggle.classList.toggle('active', lyricsVisible)
            dom.fsLyricsToggle.setAttribute('aria-pressed', lyricsVisible ? 'true' : 'false')
        }
    }

    function toggleFsLyrics() {
        const now = performance.now()
        if (now < perf.fsLyricsToggleGuardUntil) return
        perf.fsLyricsToggleGuardUntil = now + 260

        state.fsLyricsOpen = !state.fsLyricsOpen
        syncFsPlayerModeState()

        if (dom.fsLyricsToggle && typeof dom.fsLyricsToggle.blur === 'function') dom.fsLyricsToggle.blur()

        if (state.fsLyricsOpen && state.lyricsMode === 'karaoke') {
            ctx.modules.lyrics.updateKaraoke()
        }
    }

    return { openFsPlayer, closeFsPlayer, updateFullscreen, animateCover, updateFsPlayPauseIcon, syncFsPlayerModeState, toggleFsLyrics }
}
