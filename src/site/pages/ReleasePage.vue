<template>
  <div id="page-release" class="page">
    <div class="shell px-6" style="padding-top: 1.5rem; padding-bottom: 0.5rem;">
      <BackButton />
      <div class="flex flex-col lg:flex-row gap-8 lg:gap-16" style="padding-bottom: 8.125rem;">
        <div class="lg:w-80 flex-shrink-0">
          <div id="release-cover" class="aspect-square overflow-hidden bg-[var(--bg-card)] mb-6"></div>
          <h1 id="release-title" class="text-3xl mb-3 leading-tight"></h1>
          <p class="text-[var(--page-accent)] text-sm mb-3 tracking-wide lowercase">frnk ness</p>
          <p id="release-meta" class="text-sm text-[var(--fg-muted)] font-mono"></p>
          <p id="release-plays" class="hidden text-sm text-[var(--fg-muted)] font-mono mt-1.5"></p>
          <div id="download-container" class="mt-6 hidden">
            <a
              id="download-lyrics-btn"
              href="#"
              download
              class="inline-flex items-center gap-2 text-xs px-5 py-2.5 transition-all group"
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
              <div class="flex-1 h-px bg-[var(--line)]"></div>
            </div>
            <div class="aspect-video overflow-hidden bg-[var(--bg-card)] border border-white/5">
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
          <div class="flex items-center gap-4 mb-5">
            <h3 class="text-xs tracking-[0.2em] uppercase text-[var(--fg-muted)]">Треклист</h3>
            <div class="flex-1 h-px bg-[var(--line)]"></div>
          </div>
          <div id="tracklist"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import BackButton from '../components/BackButton.vue'
</script>
