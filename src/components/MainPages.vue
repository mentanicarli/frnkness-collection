<template>
  <main class="min-h-screen relative z-10">
    <div id="page-home" class="page active">
      <div class="shell px-6 pt-12 pb-2">
        <section class="mb-20 stagger-item">
          <h1 class="hero-title mb-6">Pupsiks Saga</h1>
          <p class="text-[var(--fg-muted)] text-lg max-w-xl leading-relaxed">Полная коллекция релизов frnk ness про компанию Пупсиков. Альбомы, синглы и тексты песен в одном месте.</p>
          <div class="mt-8 flex flex-wrap items-center gap-3">
            <button
              id="flow-mode-btn"
              @click="toggleFlowMode"
              class="chart-btn flow-btn flex items-center gap-2 px-7 py-3 text-base tracking-widest uppercase font-semibold rounded-full hover:scale-105 transition-all duration-300 shadow-lg shadow-black/30"
              aria-pressed="false"
              aria-label="Включить поток"
            >
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
          <p class="text-[10px] sm:text-xs text-[var(--fg-muted)]/30 leading-relaxed">Версия: v1.4</p>
        </section>
      </div>
    </div>

    <div id="page-chart" class="page">
      <div class="shell shell-narrow px-6 py-8">
        <button @click="showHome" class="flex items-center gap-2 text-[var(--fg-muted)] hover:text-[var(--page-accent)] transition-colors mb-12 group">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="group-hover:-translate-x-1 transition-transform">
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

    <div id="page-release" class="page">
      <div class="shell px-6 py-8">
        <button @click="showHome" class="flex items-center gap-2 text-[var(--fg-muted)] hover:text-[var(--page-accent)] transition-colors mb-12 group">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="group-hover:-translate-x-1 transition-transform">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span class="text-sm">Назад</span>
        </button>
        <div class="flex flex-col lg:flex-row gap-8 lg:gap-16">
          <div class="lg:w-80 flex-shrink-0">
            <div id="release-cover" class="aspect-square rounded-xl overflow-hidden bg-[var(--bg-card)] mb-6 shadow-2xl shadow-black/80"></div>
            <h1 id="release-title" class="text-3xl font-bold mb-2 tracking-tight leading-tight"></h1>
            <p class="text-[var(--page-accent)] text-sm font-medium mb-4 tracking-wide lowercase">frnk ness</p>
            <p id="release-meta" class="text-sm text-[var(--fg-muted)] tracking-wide"></p>
            <p id="release-plays" class="hidden text-sm text-[var(--fg-muted)] tracking-wide mt-2"></p>
            <div id="download-container" class="mt-6 hidden">
              <a
                id="download-lyrics-btn"
                href="#"
                download
                class="inline-flex items-center gap-2 text-xs tracking-widest uppercase text-[var(--page-accent)] hover:text-black hover:bg-[var(--page-accent)] border border-[var(--page-accent)]/40 rounded-full px-5 py-2.5 transition-all duration-300 group"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="group-hover:translate-y-0.5 transition-transform">
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
              <div class="aspect-video rounded-xl overflow-hidden bg-[var(--bg-card)] shadow-lg border border-white/5">
                <iframe
                  id="video-iframe"
                  class="w-full h-full"
                  src=""
                  referrerpolicy="strict-origin-when-cross-origin"
                  title="YouTube video player"
                  frameborder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowfullscreen
                ></iframe>
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
</template>

<script setup lang="ts">
import { legacyBridge } from '@/runtime/legacyBridge'

// Страницы и навигация пока управляются legacy runtime,
// Vue-компонент выступает декларативной оболочкой.
const showHome = () => legacyBridge.showPage('home')
const toggleFlowMode = () => legacyBridge.toggleFlowMode()
</script>
