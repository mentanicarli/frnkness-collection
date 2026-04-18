<template>
  <div id="lyrics-panel" class="lyrics-panel fixed top-0 right-0 w-full sm:w-[400px] h-full bg-[var(--bg-elevated)] z-50 overflow-hidden flex flex-col">
    <div class="p-6 border-b border-white/5 flex items-center justify-between flex-shrink-0">
      <div>
        <h4 id="lyrics-track-title" class="font-semibold text-lg"></h4>
        <p class="text-sm text-[var(--fg-muted)]">frnk ness</p>
      </div>
      <div id="lyrics-mode-switch" class="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 mr-2">
        <button onclick="App.setLyricsMode('text')" id="lyrics-mode-text" class="px-3 py-1 text-[11px] rounded-full text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Обычный текст">Текст</button>
        <button onclick="App.setLyricsMode('karaoke')" id="lyrics-mode-karaoke" class="px-3 py-1 text-[11px] rounded-full text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Караоке">Караоке</button>
      </div>
      <button onclick="App.closeLyrics()" class="flex items-center justify-center w-8 h-8 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-colors" aria-label="Закрыть текст">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div id="lyrics-content" class="flex-1 overflow-y-auto p-6 text-base leading-loose text-[var(--fg-muted)]">
      <p class="italic">Текст загружается...</p>
    </div>
  </div>

  <div id="fullscreen-player" class="fullscreen-player">
    <div id="fs-bg" class="fullscreen-bg"></div>
    <div class="fs-track-info">
      <h2 id="fs-track-title" class="fs-track-title">Название трека</h2>
      <p class="fs-track-artist">frnk ness</p>
    </div>
    <div class="fs-header-buttons">
      <button id="fs-lyrics-toggle" onclick="App.toggleFsLyrics()" class="fs-header-btn" aria-label="Текст песни">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      </button>
      <button onclick="App.closeFsPlayer()" class="fs-header-btn" aria-label="Закрыть">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div class="fs-main-area">
      <div class="fs-cover-container">
        <div id="fs-cover" class="fs-cover">
          <img id="fs-cover-a" class="fs-cover-img" src="" alt="Обложка" crossorigin="anonymous" loading="lazy">
          <img id="fs-cover-b" class="fs-cover-img" src="" alt="Обложка" crossorigin="anonymous" loading="lazy">
        </div>
      </div>
      <div class="fs-lyrics-panel">
        <div class="fs-lyrics-header">
          <div>
            <h4 id="fs-lyrics-title" class="font-semibold text-sm">Текст песни</h4>
            <p class="text-xs text-[var(--fg-muted)]">frnk ness</p>
          </div>
          <div id="fs-lyrics-mode-switch" class="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 mr-2">
            <button onclick="App.setLyricsMode('text')" id="fs-lyrics-mode-text" class="px-2.5 py-1 text-[10px] rounded-full text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Обычный текст">Текст</button>
            <button onclick="App.setLyricsMode('karaoke')" id="fs-lyrics-mode-karaoke" class="px-2.5 py-1 text-[10px] rounded-full text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Караоке">Караоке</button>
          </div>
          <button onclick="App.toggleFsLyrics()" class="w-7 h-7 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div id="fs-lyrics-body" class="fs-lyrics-body">
          <p class="text-[var(--fg-muted)] italic">Текст загружается...</p>
        </div>
      </div>
    </div>
    <div class="fs-controls">
      <div class="fs-progress-container" onclick="App.seekTrackFs(event)">
        <div id="fs-progress-bar" class="fs-progress-bar" style="width: 0%"></div>
      </div>
      <div class="fs-controls-inner">
        <div class="fs-time">
          <span id="fs-time-current">0:00</span>
          <span>/</span>
          <span id="fs-time-total">0:00</span>
        </div>
        <button onclick="App.prevTrack()" class="fs-btn" aria-label="Предыдущий трек">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>
        <button id="fs-play-btn" onclick="App.togglePlay()" class="fs-btn fs-play-btn" aria-label="Воспроизвести">
          <svg id="fs-icon-play" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          <svg id="fs-icon-pause" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style="display:none">
            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          </svg>
        </button>
        <button onclick="App.nextTrack()" class="fs-btn" aria-label="Следующий трек">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
        <div class="fs-volume-wrap">
          <button onclick="App.toggleMute()" class="fs-btn" aria-label="Громкость">
            <svg id="fs-volume-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path id="fs-vol-wave-1" d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path id="fs-vol-wave-2" d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          </button>
          <input type="range" id="fs-volume-slider" min="0" max="1" step="0.01" value="1" class="w-20">
        </div>
      </div>
    </div>
  </div>

  <div id="player" class="player fixed bottom-0 left-0 right-0 bg-[var(--bg-elevated)] z-30">
    <div class="progress-container rounded-none" onclick="App.seekTrack(event)">
      <div id="progress-bar" class="progress-bar" style="width: 0%"></div>
    </div>
    <div style="width: 100%; padding: 0 clamp(12px, 3vw, 48px);">
      <div class="py-3 flex items-center justify-between w-full" style="gap: clamp(8px, 1.5vw, 16px);">
        <div class="flex items-center flex-1 min-w-0" style="gap: clamp(12px, 2vw, 16px);">
          <div id="player-cover" class="w-12 h-12 rounded bg-[var(--bg-card)] flex-shrink-0 overflow-hidden shadow-lg">
            <div class="cover-overlay">
              <button onclick="event.stopPropagation(); App.openFsPlayer()" class="fullscreen-trigger-btn" aria-label="Открыть на весь экран">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              </button>
            </div>
          </div>
          <div class="min-w-0 flex items-center" style="gap: clamp(8px, 1.5vw, 12px);">
            <div>
              <p id="player-track" class="font-medium truncate text-sm"></p>
              <p class="text-xs text-[var(--fg-muted)] truncate">frnk ness</p>
            </div>
            <button id="lyrics-btn" onclick="App.toggleLyrics()" class="lyrics-action-btn hidden sm:flex" aria-label="Открыть текст">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <span>Текст</span>
            </button>
          </div>
        </div>
        <div class="flex items-center flex-shrink-0" style="gap: clamp(6px, 1.2vw, 12px);">
          <button onclick="App.prevTrack()" class="play-btn p-2 text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Предыдущий трек">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>
          <button id="play-pause-btn" onclick="App.togglePlay()" class="play-btn w-10 h-10 rounded-full bg-white text-black flex items-center justify-center relative" aria-label="Воспроизвести">
            <svg id="icon-play" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            <svg id="icon-pause" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="hidden">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
          </button>
          <button onclick="App.nextTrack()" class="play-btn p-2 text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Следующий трек">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>
        </div>
        <div class="hidden sm:flex items-center flex-1 justify-end ml-auto" style="gap: clamp(8px, 1.5vw, 16px);">
          <div class="flex items-center gap-2 text-xs text-[var(--fg-muted)] font-mono">
            <span id="time-current">0:00</span>
            <span>/</span>
            <span id="time-total">0:00</span>
          </div>
          <div class="flex items-center gap-2 pl-4 border-l border-white/10">
            <button onclick="App.toggleMute()" class="text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Громкость">
              <svg id="volume-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path id="vol-wave-1" d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path id="vol-wave-2" d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            </button>
            <input type="range" id="volume-slider" min="0" max="1" step="0.01" value="1">
          </div>
          <button onclick="App.closeMiniPlayer()" class="close-player-btn p-1" aria-label="Закрыть плеер">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="flex sm:hidden items-center">
          <button id="lyrics-btn-mobile" onclick="App.toggleLyrics()" class="p-2 text-[var(--fg-muted)] hover:text-[var(--player-accent)] transition-colors" aria-label="Текст песни">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </button>
          <button onclick="App.closeMiniPlayer()" class="close-player-btn p-2 text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Закрыть плеер">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <audio id="audio-player" preload="metadata"></audio>
</template>
