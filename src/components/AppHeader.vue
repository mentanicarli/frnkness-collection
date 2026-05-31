<template>
  <header>
    <div
      style="height: 62px; display: flex; align-items: center; justify-content: space-between; padding: 0 clamp(16px, 2.4vw, 48px); width: 100%; position: relative;"
    >
      <button @click="showHome" class="flex items-center gap-2 group" aria-label="На главную">
        <span class="text-lg text-white/95 group-hover:text-white transition-colors">frnk ness</span>
        <span class="font-mono text-[9px] tracking-[0.2em] uppercase text-[var(--fg-faint)]">collection</span>
      </button>

      <!-- inline search field (раскрывается между логотипом и кнопками) -->
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
            <button @click="closeSearchPanel" class="flex items-center justify-center w-7 h-7 rounded text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Закрыть поиск">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <div id="search-results" class="header-search-results"></div>
        </div>
      </div>

      <nav class="flex items-center gap-2">
        <button id="search-toggle-btn" class="chart-btn header-animated-btn flex items-center justify-center transition-all" aria-label="Поиск">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
        <button
          id="header-chart-btn"
          @click="openChartFromInteraction"
          class="chart-btn header-animated-btn flex items-center gap-2 px-5 transition-all"
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

    <div id="search-backdrop" class="search-backdrop" @click="closeSearchPanel"></div>
  </header>
</template>

<script setup lang="ts">
import { legacyBridge } from '@/runtime/legacyBridge'

const showHome = () => legacyBridge.showPage('home')
let lastChartOpenAt = 0
const openChartFromInteraction = (event: MouseEvent | PointerEvent) => {
  const now = performance.now()
  if (now - lastChartOpenAt < 250) return
  if (event.type === 'pointerdown') {
    event.preventDefault()
  }
  lastChartOpenAt = now
  legacyBridge.showPage('chart')
}
const closeSearchPanel = () => legacyBridge.toggleSearchPanel(false)
</script>
