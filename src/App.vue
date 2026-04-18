<template>
<div id="particles-js"></div>

    <!-- Шапка -->
    <header class="fixed top-0 left-0 right-0 z-40">
        <div
            style="height: 100%; display: flex; align-items: center; justify-content: space-between; padding: clamp(10px, 2vw, 20px) clamp(12px, 3vw, 48px); width: 100%;">
            <button onclick="App.showPage('home')" class="flex items-center gap-3 group" aria-label="На главную">
                <span
                    class="text-lg font-medium tracking-tight text-white/90 group-hover:text-white transition-colors">frnk
                    ness collection</span>
            </button>
            <nav class="hidden sm:flex items-center gap-4 text-sm text-[var(--fg-muted)]">
                <button id="search-toggle-btn"
                    class="chart-btn header-animated-btn flex items-center justify-center px-3.5 py-2.5 rounded-full hover:scale-105 transition-all duration-300"
                    aria-label="Поиск">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="7"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                </button>
                <button onclick="App.showPage('chart')"
                    class="chart-btn header-animated-btn flex items-center gap-2 px-6 py-2.5 text-sm tracking-widest uppercase font-semibold rounded-full hover:scale-105 transition-all duration-300">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="20" x2="18" y2="10"></line>
                        <line x1="12" y1="20" x2="12" y2="4"></line>
                        <line x1="6" y1="20" x2="6" y2="14"></line>
                    </svg>
                    <span>Чарт</span>
                </button>
            </nav>
        </div>
        <div id="header-search-panel" class="header-search-panel">
            <div class="header-search-inner">
                <div class="header-search-input-wrap">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="7"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input id="global-search" type="search" placeholder="Искать трек, альбом или строку из текста..." aria-label="Глобальный поиск">
                </div>
                <div id="search-results" class="header-search-results"></div>
            </div>
        </div>
    </header>

    <div id="search-backdrop" class="search-backdrop" onclick="App.toggleSearchPanel(false)"></div>

    <main class="min-h-screen relative z-10">
        <!-- Главная страница -->
        <div id="page-home" class="page active">
            <div class="shell px-6 pt-12 pb-2">
                <section class="mb-20 stagger-item">
                    <h1 class="hero-title mb-6">Pupsiks Saga</h1>
                    <p class="text-[var(--fg-muted)] text-lg max-w-xl leading-relaxed">Полная коллекция релизов frnk
                        ness про компанию Пупсиков. Альбомы, синглы и тексты песен в одном месте.</p>
                    <div class="mt-8 flex flex-wrap items-center gap-3">
                        <button id="flow-mode-btn" onclick="App.toggleFlowMode()"
                            class="chart-btn flow-btn flex items-center gap-2 px-7 py-3 text-base tracking-widest uppercase font-semibold rounded-full hover:scale-105 transition-all duration-300 shadow-lg shadow-black/30"
                            aria-pressed="false" aria-label="Включить поток">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M4 7h6m0 0L7 4m3 3L7 10" />
                                <path d="M20 17h-6m0 0 3-3m-3 3 3 3" />
                                <path d="M4 17c3.5 0 5.5-3 8-7s4.5-7 8-7" />
                            </svg>
                            <span id="flow-mode-label">Поток</span>
                        </button>
                    </div>
                </section>
                <section id="home-promo" class="mb-10 stagger-item"></section>
                <section class="mb-16 stagger-item" style="animation-delay: 0.1s;">
                    <h2 class="text-xs tracking-widest uppercase text-[var(--fg-muted)] mb-8">Альбомы</h2>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8" id="albums-grid"></div>
                </section>
                <section class="stagger-item" style="animation-delay: 0.2s;">
                    <h2 class="text-xs tracking-widest uppercase text-[var(--fg-muted)] mb-8">Синглы</h2>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8" id="singles-grid"></div>
                </section>
                <section class="mt-2 pb-0 text-center stagger-item" style="animation-delay: 0.25s;">
                    <p class="text-[10px] sm:text-xs text-[var(--fg-muted)]/30 leading-relaxed">
                        Версия: v1.4
                    </p>
                </section>
            </div>
        </div>

        <!-- Страница чарта -->
        <div id="page-chart" class="page">
            <div class="shell shell-narrow px-6 py-8">
                <button onclick="App.showPage('home')"
                    class="flex items-center gap-2 text-[var(--fg-muted)] hover:text-[var(--page-accent)] transition-colors mb-12 group">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        class="group-hover:-translate-x-1 transition-transform">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    <span class="text-sm">Назад</span>
                </button>
                <div class="text-center mb-12">
                    <h1 class="text-3xl font-bold mb-2 tracking-tight">Чарт Песен</h1>
                    <p class="text-sm text-[var(--fg-muted)]">Рейтинг формируется на основе количества прослушиваний</p>
                </div>
                <div id="chart-list" class="space-y-2"></div>
            </div>
        </div>

        <!-- Страница релиза -->
        <div id="page-release" class="page">
            <div class="shell px-6 py-8">
                <button onclick="App.showPage('home')"
                    class="flex items-center gap-2 text-[var(--fg-muted)] hover:text-[var(--page-accent)] transition-colors mb-12 group">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        class="group-hover:-translate-x-1 transition-transform">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    <span class="text-sm">Назад</span>
                </button>
                <div class="flex flex-col lg:flex-row gap-8 lg:gap-16">
                    <div class="lg:w-80 flex-shrink-0">
                        <div id="release-cover"
                            class="aspect-square rounded-xl overflow-hidden bg-[var(--bg-card)] mb-6 shadow-2xl shadow-black/80">
                        </div>
                        <h1 id="release-title" class="text-3xl font-bold mb-2 tracking-tight leading-tight"></h1>
                        <p class="text-[var(--page-accent)] text-sm font-medium mb-4 tracking-wide lowercase">frnk ness
                        </p>
                        <p id="release-meta" class="text-sm text-[var(--fg-muted)] tracking-wide"></p>
                        <p id="release-plays" class="hidden text-sm text-[var(--fg-muted)] tracking-wide mt-2"></p>
                        <div id="download-container" class="mt-6 hidden">
                            <a id="download-lyrics-btn" href="#" download
                                class="inline-flex items-center gap-2 text-xs tracking-widest uppercase text-[var(--page-accent)] hover:text-black hover:bg-[var(--page-accent)] border border-[var(--page-accent)]/40 rounded-full px-5 py-2.5 transition-all duration-300 group">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    stroke-width="2" class="group-hover:translate-y-0.5 transition-transform">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                <span>Lyrics Book</span>
                            </a>
                        </div>
                    </div>
                    <div class="flex-1 max-w-none xl:max-w-4xl">
                        <div id="video-container" class="mb-10 hidden">
                            <div class="flex items-center gap-4 mb-4">
                                <h3 class="text-xs tracking-[0.2em] uppercase text-[var(--fg-muted)]">Видео</h3>
                                <div class="flex-1 h-px bg-[var(--border)]"></div>
                            </div>
                            <div
                                class="aspect-video rounded-xl overflow-hidden bg-[var(--bg-card)] shadow-lg border border-white/5">
                                <iframe id="video-iframe" class="w-full h-full" src=""
                                    referrerpolicy="strict-origin-when-cross-origin" title="YouTube video player"
                                    frameborder="0"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                    allowfullscreen></iframe>
                            </div>
                        </div>
                        <div class="flex items-center gap-4 mb-6">
                            <h3 class="text-xs tracking-[0.2em] uppercase text-[var(--fg-muted)]">Треклист</h3>
                            <div class="flex-1 h-px bg-[var(--border)]"></div>
                        </div>
                        <div id="tracklist" class="space-y-0 rounded-xl overflow-hidden border border-white/5"></div>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <!-- Панель текста -->
    <div id="lyrics-panel"
        class="lyrics-panel fixed top-0 right-0 w-full sm:w-[400px] h-full bg-[var(--bg-elevated)] z-50 overflow-hidden flex flex-col">
        <div class="p-6 border-b border-white/5 flex items-center justify-between flex-shrink-0">
            <div>
                <h4 id="lyrics-track-title" class="font-semibold text-lg"></h4>
                <p class="text-sm text-[var(--fg-muted)]">frnk ness</p>
            </div>
            <div id="lyrics-mode-switch" class="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 mr-2">
                <button onclick="App.setLyricsMode('text')" id="lyrics-mode-text" class="px-3 py-1 text-[11px] rounded-full text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Обычный текст">Текст</button>
                <button onclick="App.setLyricsMode('karaoke')" id="lyrics-mode-karaoke" class="px-3 py-1 text-[11px] rounded-full text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Караоке">Караоке</button>
            </div>
            <button onclick="App.closeLyrics()"
                class="flex items-center justify-center w-8 h-8 bg-white/5 hover:bg-white/10 rounded-full text-sm transition-colors"
                aria-label="Закрыть текст">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
            </button>
        </div>
        <div id="lyrics-content" class="flex-1 overflow-y-auto p-6 text-base leading-loose text-[var(--fg-muted)]">
            <p class="italic">Текст загружается...</p>
        </div>
    </div>

    <!-- Полноэкранный плеер -->
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
                    <img id="fs-cover-a" class="fs-cover-img" src="" alt="Обложка" crossorigin="anonymous"
                        loading="lazy">
                    <img id="fs-cover-b" class="fs-cover-img" src="" alt="Обложка" crossorigin="anonymous"
                        loading="lazy">
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
                    <button onclick="App.toggleFsLyrics()"
                        class="w-7 h-7 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center transition-colors">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
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
                <button id="fs-play-btn" onclick="App.togglePlay()" class="fs-btn fs-play-btn"
                    aria-label="Воспроизвести">
                    <svg id="fs-icon-play" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                    <svg id="fs-icon-pause" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"
                        style="display:none">
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
                        <svg id="fs-volume-icon" width="20" height="20" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" stroke-width="2">
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

    <!-- Мини-плеер -->
    <div id="player" class="player fixed bottom-0 left-0 right-0 bg-[var(--bg-elevated)] z-30">
        <div class="progress-container rounded-none" onclick="App.seekTrack(event)">
            <div id="progress-bar" class="progress-bar" style="width: 0%"></div>
        </div>
        <div style="width: 100%; padding: 0 clamp(12px, 3vw, 48px);">
            <div class="py-3 flex items-center justify-between w-full" style="gap: clamp(8px, 1.5vw, 16px);">
                <!-- ЛЕВАЯ ЧАСТЬ -->
                <div class="flex items-center flex-1 min-w-0" style="gap: clamp(12px, 2vw, 16px);">
                    <div id="player-cover"
                        class="w-12 h-12 rounded bg-[var(--bg-card)] flex-shrink-0 overflow-hidden shadow-lg">
                        <div class="cover-overlay">
                            <button onclick="event.stopPropagation(); App.openFsPlayer()" class="fullscreen-trigger-btn"
                                aria-label="Открыть на весь экран">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    stroke-width="2">
                                    <path
                                        d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="min-w-0 flex items-center" style="gap: clamp(8px, 1.5vw, 12px);">
                        <div>
                            <p id="player-track" class="font-medium truncate text-sm"></p>
                            <p class="text-xs text-[var(--fg-muted)] truncate">frnk ness</p>
                        </div>
                        <button id="lyrics-btn" onclick="App.toggleLyrics()" class="lyrics-action-btn hidden sm:flex"
                            aria-label="Открыть текст">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                            </svg>
                            <span>Текст</span>
                        </button>
                    </div>
                </div>
                <!-- ЦЕНТР (кнопки воспроизведения) -->
                <div class="flex items-center flex-shrink-0" style="gap: clamp(6px, 1.2vw, 12px);">
                    <button onclick="App.prevTrack()"
                        class="play-btn p-2 text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
                        aria-label="Предыдущий трек">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                        </svg>
                    </button>
                    <button id="play-pause-btn" onclick="App.togglePlay()"
                        class="play-btn w-10 h-10 rounded-full bg-white text-black flex items-center justify-center relative"
                        aria-label="Воспроизвести">
                        <svg id="icon-play" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                        <svg id="icon-pause" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"
                            class="hidden">
                            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                        </svg>
                    </button>
                    <button onclick="App.nextTrack()"
                        class="play-btn p-2 text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
                        aria-label="Следующий трек">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
                        </svg>
                    </button>
                </div>
                <!-- ПРАВАЯ ЧАСТЬ (время и громкость) -->
                <div class="hidden sm:flex items-center flex-1 justify-end ml-auto"
                    style="gap: clamp(8px, 1.5vw, 16px);">
                    <div class="flex items-center gap-2 text-xs text-[var(--fg-muted)] font-mono">
                        <span id="time-current">0:00</span>
                        <span>/</span>
                        <span id="time-total">0:00</span>
                    </div>
                    <div class="flex items-center gap-2 pl-4 border-l border-white/10">
                        <button onclick="App.toggleMute()"
                            class="text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
                            aria-label="Громкость">
                            <svg id="volume-icon" width="18" height="18" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" stroke-width="2">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                <path id="vol-wave-1" d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                                <path id="vol-wave-2" d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                            </svg>
                        </button>
                        <input type="range" id="volume-slider" min="0" max="1" step="0.01" value="1">
                    </div>
                    <button onclick="App.closeMiniPlayer()" class="close-player-btn p-1" aria-label="Закрыть плеер">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div class="flex sm:hidden items-center">
                    <button id="lyrics-btn-mobile" onclick="App.toggleLyrics()"
                        class="p-2 text-[var(--fg-muted)] hover:text-[var(--player-accent)] transition-colors"
                        aria-label="Текст песни">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                        </svg>
                    </button>
                    <button onclick="App.closeMiniPlayer()"
                        class="close-player-btn p-2 text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
                        aria-label="Закрыть плеер">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <audio id="audio-player" preload="metadata"></audio>

</template>

<script setup>
import { onMounted } from 'vue'
import { initLegacyApp } from './legacy/app-core'

onMounted(() => {
  initLegacyApp()
})
</script>


