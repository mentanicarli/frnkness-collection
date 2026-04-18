<template>
  <header class="fixed top-0 left-0 right-0 z-40">
    <div
      style="height: 100%; display: flex; align-items: center; justify-content: space-between; padding: clamp(10px, 2vw, 20px) clamp(12px, 3vw, 48px); width: 100%;"
    >
      <button onclick="App.showPage('home')" class="flex items-center gap-3 group" aria-label="На главную">
        <span class="text-lg font-medium tracking-tight text-white/90 group-hover:text-white transition-colors">frnk ness collection</span>
      </button>
      <nav class="hidden sm:flex items-center gap-4 text-sm text-[var(--fg-muted)]">
        <button
          id="search-toggle-btn"
          class="chart-btn header-animated-btn flex items-center justify-center px-3.5 py-2.5 rounded-full hover:scale-105 transition-all duration-300"
          aria-label="Поиск"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
        <button
          onclick="App.showPage('chart')"
          class="chart-btn header-animated-btn flex items-center gap-2 px-6 py-2.5 text-sm tracking-widest uppercase font-semibold rounded-full hover:scale-105 transition-all duration-300"
        >
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
          <input
            id="global-search"
            type="search"
            placeholder="Искать трек, альбом или строку из текста..."
            aria-label="Глобальный поиск"
          >
        </div>
        <div id="search-results" class="header-search-results"></div>
      </div>
    </div>
  </header>

  <div id="search-backdrop" class="search-backdrop" onclick="App.toggleSearchPanel(false)"></div>
</template>
