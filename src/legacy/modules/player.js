export function createPlayerModule(ctx) {
    const { dom, state, perf, releases, utils } = ctx
    const { formatTime, throttle } = utils

    // ── Flow mode helpers ───────────────────────────────────────────────

    function getAllTrackRefs() {
        return Object.entries(releases).flatMap(([releaseId, release]) =>
            release.tracks.map((_, trackIndex) => ({ releaseId, trackIndex }))
        )
    }

    function isSameTrackRef(a, b) {
        return Boolean(a && b && a.releaseId === b.releaseId && a.trackIndex === b.trackIndex)
    }

    function pickRandomTrackRef(excludeRef = null) {
        const refs = getAllTrackRefs().filter(ref => !excludeRef || !isSameTrackRef(ref, excludeRef))
        if (!refs.length) return null
        return refs[Math.floor(Math.random() * refs.length)]
    }

    function updateFlowButtonState() {
        if (dom.flowModeBtn) {
            dom.flowModeBtn.classList.toggle('active', state.flowModeActive)
            dom.flowModeBtn.setAttribute('aria-pressed', String(state.flowModeActive))
            dom.flowModeBtn.setAttribute('aria-label', state.flowModeActive ? 'Остановить поток' : 'Включить поток')
        }
        if (dom.flowModeLabel) dom.flowModeLabel.textContent = 'Поток'
    }

    function playTrackByRef(releaseId, trackIndex, direction = 'fade') {
        const release = releases[releaseId]
        if (!release || !release.tracks[trackIndex]) return
        state.currentRelease = release
        state.currentReleaseId = releaseId
        playTrack(trackIndex, direction)
    }

    function startFlowMode() {
        const nextRef = pickRandomTrackRef()
        if (!nextRef) return
        state.flowModeActive = true
        updateFlowButtonState()
        playTrackByRef(nextRef.releaseId, nextRef.trackIndex, 'fade')
    }

    function stopFlowMode() {
        state.flowModeActive = false
        updateFlowButtonState()
    }

    function toggleFlowMode() {
        if (state.flowModeActive) stopFlowMode()
        else startFlowMode()
    }

    function playFlowNext(direction = 'next') {
        const currentRef = state.currentReleaseId !== null
            ? { releaseId: state.currentReleaseId, trackIndex: state.currentTrackIndex }
            : null
        const nextRef = pickRandomTrackRef(currentRef)
        if (!nextRef) return
        playTrackByRef(nextRef.releaseId, nextRef.trackIndex, direction)
    }

    // ── Preload helpers ─────────────────────────────────────────────────

    function runWhenIdle(fn) {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(fn, { timeout: 800 })
        } else {
            setTimeout(fn, 16)
        }
    }

    function preloadTrackMetadata(releaseId, trackIndex) {
        const release = releases[releaseId]
        const track = release && release.tracks[trackIndex]
        if (!release || !track) return
        const src = release.audioPath + track.file
        if (perf.preloadedAudio.has(src)) return
        if (perf.preloadedAudio.size > 14) {
            const oldest = perf.preloadedAudio.values().next().value
            if (oldest) perf.preloadedAudio.delete(oldest)
        }
        const probe = new Audio()
        probe.preload = 'metadata'
        probe.src = src
        perf.preloadedAudio.add(src)
    }

    // ── Playback ────────────────────────────────────────────────────────

    function handleTrackClick(index, source = 'click') {
        if (source === 'click' && perf.pendingTrackClickGuard) {
            const now = performance.now()
            if (perf.pendingTrackClickGuard.index === index && now <= perf.pendingTrackClickGuard.expiresAt) {
                perf.pendingTrackClickGuard = null
                return
            }
            if (now > perf.pendingTrackClickGuard.expiresAt) perf.pendingTrackClickGuard = null
        }
        if (state.currentReleaseId && state.currentTrackIndex === index) togglePlay()
        else playTrack(index, 'fade')
    }

    function playTrack(index, direction = null) {
        if (!state.currentRelease) return

        state.currentTrackIndex = index
        state.trackCounted = false
        state.trackCountPending = false
        const track = state.currentRelease.tracks[index]
        if (!track) return

        state.karaokeHardStart = true

        dom.audio.src = state.currentRelease.audioPath + track.file
        if (dom.playerTrack) dom.playerTrack.textContent = track.title

        dom.playerCover.innerHTML = `
            <img src="${state.currentRelease.cover}" class="w-full h-full object-cover" loading="eager" fetchpriority="high" decoding="async" onerror="this.style.display='none'">
            <div class="cover-overlay">
                <button onclick="event.stopPropagation(); App.openFsPlayer()" class="fullscreen-trigger-btn" aria-label="Открыть на весь экран">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                    </svg>
                </button>
            </div>
        `

        setMiniPlayerVisible(true)
        if (dom.lyricsBtn) dom.lyricsBtn.classList.remove('hidden')
        if (dom.lyricsBtnMobile) dom.lyricsBtnMobile.classList.remove('hidden')

        document.querySelectorAll('.track-row').forEach((row, i) => {
            row.classList.toggle('playing', i === index)
            row.classList.remove('paused')
        })

        ctx.modules.fullscreen.updateFullscreen(track.title, state.currentRelease.cover, direction)
        ctx.modules.colors.updatePlayerAccent(state.currentRelease.cover)
        ctx.modules.colors.updatePageAccent(state.currentRelease.cover)
        updateFlowButtonState()

        if (state.currentReleaseId) {
            const nextIndex = (index + 1) % state.currentRelease.tracks.length
            preloadTrackMetadata(state.currentReleaseId, nextIndex)
        }

        const playPromise = dom.audio.play()
        if (playPromise && typeof playPromise.then === 'function') {
            playPromise.then(() => {
                state.isPlaying = true
                updatePlayPauseIcon()
            }).catch(err => {
                state.isPlaying = false
                updatePlayPauseIcon()
                console.log('Play error:', err)
            })
        } else {
            state.isPlaying = true
            updatePlayPauseIcon()
        }

        ctx.modules.lyrics.loadLyrics(index)
    }

    function togglePlay() {
        if (dom.audio.paused) {
            dom.audio.play()
            state.isPlaying = true
            setMiniPlayerVisible(true)
            const rows = document.querySelectorAll('.track-row')
            if (rows[state.currentTrackIndex]) {
                rows[state.currentTrackIndex].classList.add('playing')
                rows[state.currentTrackIndex].classList.remove('paused')
            }
        } else {
            dom.audio.pause()
            state.isPlaying = false
        }
        updatePlayPauseIcon()
    }

    function updatePlayPauseIcon() {
        if (dom.iconPlay) dom.iconPlay.classList.toggle('hidden', state.isPlaying)
        if (dom.iconPause) dom.iconPause.classList.toggle('hidden', !state.isPlaying)
        if (dom.playPauseBtn) dom.playPauseBtn.classList.toggle('playing-state', state.isPlaying)
        if (dom.playerCover) dom.playerCover.classList.toggle('playing-glow', state.isPlaying)
        const activeRow = document.querySelector('.track-row.playing')
        if (activeRow) activeRow.classList.toggle('paused', !state.isPlaying)
        ctx.modules.fullscreen.updateFsPlayPauseIcon()
    }

    function nextTrack() {
        if (state.flowModeActive) { playFlowNext('next'); return }
        if (state.currentRelease) {
            playTrack((state.currentTrackIndex + 1) % state.currentRelease.tracks.length, 'next')
        }
    }

    function prevTrack() {
        if (state.currentRelease) {
            playTrack(state.currentTrackIndex === 0 ? state.currentRelease.tracks.length - 1 : state.currentTrackIndex - 1, 'prev')
        }
    }

    function seekTrack(e) {
        if (!dom.audio.duration) return
        const rect = e.currentTarget.getBoundingClientRect()
        dom.audio.currentTime = ((e.clientX - rect.left) / rect.width) * dom.audio.duration
    }

    function seekTrackFs(e) {
        if (!dom.audio.duration) return
        const rect = e.currentTarget.getBoundingClientRect()
        dom.audio.currentTime = ((e.clientX - rect.left) / rect.width) * dom.audio.duration
    }

    function seekTo(time) {
        if (!Number.isFinite(time) || time < 0) return

        const applySeek = () => {
            dom.audio.currentTime = time
            if (state.lyricsMode === 'karaoke') ctx.modules.lyrics.updateKaraoke()
            if (dom.audio.paused) {
                const resumePromise = dom.audio.play()
                if (resumePromise && typeof resumePromise.then === 'function') {
                    resumePromise.then(() => { state.isPlaying = true; updatePlayPauseIcon() })
                        .catch(() => { state.isPlaying = false; updatePlayPauseIcon() })
                } else {
                    state.isPlaying = true; updatePlayPauseIcon()
                }
            }
        }

        if (dom.audio.readyState >= 1 || Number.isFinite(dom.audio.duration)) {
            applySeek()
            return
        }
        const onMetadata = () => { dom.audio.removeEventListener('loadedmetadata', onMetadata); applySeek() }
        dom.audio.addEventListener('loadedmetadata', onMetadata)
    }

    // ── Audio events ────────────────────────────────────────────────────

    function setupAudioEvents() {
        dom.audio.addEventListener('timeupdate', () => {
            if (!dom.audio.duration) return
            const currentTime = dom.audio.currentTime
            const progress = (currentTime / dom.audio.duration) * 100
            const roundedProgress = Math.round(progress * 5) / 5
            if (roundedProgress !== perf.lastProgressPercent) {
                perf.lastProgressPercent = roundedProgress
                if (dom.progress) dom.progress.style.width = roundedProgress + '%'
                if (dom.fsProgress) dom.fsProgress.style.width = roundedProgress + '%'
            }
            const currentSecond = Math.floor(currentTime)
            if (currentSecond !== perf.lastSecond) {
                perf.lastSecond = currentSecond
                const cur = formatTime(currentTime)
                const timeCurrent = document.getElementById('time-current')
                if (timeCurrent) timeCurrent.textContent = cur
                if (dom.fsTimeCurrent) dom.fsTimeCurrent.textContent = cur
            }
            ctx.modules.lyrics.updateKaraoke()
            if (currentTime >= 10 && !state.trackCounted && !state.trackCountPending) {
                ctx.modules.chart.incrementPlayCount()
            }
        })

        dom.audio.addEventListener('loadedmetadata', () => {
            const total = formatTime(dom.audio.duration)
            const timeTotal = document.getElementById('time-total')
            if (timeTotal) timeTotal.textContent = total
            if (dom.fsTimeTotal) dom.fsTimeTotal.textContent = total
        })

        dom.audio.addEventListener('ended', nextTrack)
    }

    // ── Volume ──────────────────────────────────────────────────────────

    function setupVolumeControls() {
        dom.audio.volume = dom.volumeSlider ? parseFloat(dom.volumeSlider.value) : 1
        updateVolumeIcon(dom.audio.volume)
        ;[dom.volumeSlider, dom.fsVolumeSlider].forEach(slider => {
            if (!slider) return
            slider.addEventListener('input', e => {
                const vol = parseFloat(e.target.value)
                dom.audio.volume = vol
                dom.audio.muted = false
                updateVolumeIcon(vol)
                if (dom.volumeSlider) dom.volumeSlider.value = vol
                if (dom.fsVolumeSlider) dom.fsVolumeSlider.value = vol
            })
        })
    }

    function toggleMute() {
        dom.audio.muted = !dom.audio.muted
        const vol = dom.audio.muted ? 0 : (dom.audio.volume || 0.5)
        if (dom.volumeSlider) dom.volumeSlider.value = vol
        if (dom.fsVolumeSlider) dom.fsVolumeSlider.value = vol
        updateVolumeIcon(vol)
    }

    function updateVolumeIcon(vol) {
        const show1 = vol > 0 && !dom.audio.muted
        const show2 = vol >= 0.5 && !dom.audio.muted
        ;[dom.volWave1, dom.fsVolWave1].forEach(el => { if (el) el.style.opacity = show1 ? '1' : '0' })
        ;[dom.volWave2, dom.fsVolWave2].forEach(el => { if (el) el.style.opacity = show2 ? '1' : '0' })
    }

    // ── Mini player ─────────────────────────────────────────────────────

    function setMiniPlayerVisible(isVisible) {
        if (!dom.player) return
        dom.player.classList.toggle('visible', isVisible)
        document.body.classList.toggle('mini-player-visible', isVisible)
    }

    function closeMiniPlayer() {
        dom.audio.pause()
        state.isPlaying = false
        updatePlayPauseIcon()
        setMiniPlayerVisible(false)
        document.querySelectorAll('.track-row.playing').forEach(row => row.classList.remove('playing', 'paused'))
    }

    return {
        handleTrackClick,
        playTrack,
        togglePlay,
        updatePlayPauseIcon,
        nextTrack,
        prevTrack,
        seekTrack,
        seekTrackFs,
        seekTo,
        setupAudioEvents,
        setupVolumeControls,
        toggleMute,
        setMiniPlayerVisible,
        closeMiniPlayer,
        toggleFlowMode,
        startFlowMode,
        stopFlowMode,
        playFlowNext,
        updateFlowButtonState,
        runWhenIdle,
        preloadTrackMetadata
    }
}
