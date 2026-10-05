<template>
  <div id="page-home" class="page active">
    <div class="shell px-6" style="padding-top: clamp(1.75rem,5vw,4rem); padding-bottom: 0.5rem;">
      <section class="stagger-item" style="margin-bottom: clamp(1.625rem,4vw,3.25rem);">
        <h1 class="hero-title">Pupsiks<br><span class="hero-accent">Saga</span></h1>
        <p class="text-[var(--fg-muted)] max-w-xl leading-relaxed" style="margin-top: 1.5rem; font-size: clamp(0.9375rem,1.4vw,1.0625rem);">Полная коллекция релизов frnk ness про компанию Пупсиков. Альбомы, синглы и тексты песен в одном месте.</p>
        <div class="mt-8 flex flex-wrap items-center gap-3">
          <button
            id="flow-mode-btn"
            @click="toggleFlowMode"
            class="chart-btn flow-btn flex items-center gap-2 px-7 transition-all"
            style="height: 3.125rem;"
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
      <section id="home-promo" class="stagger-item" style="margin-bottom: clamp(1.625rem,4vw,3.25rem);"></section>
      <section class="stagger-item" style="animation-delay: 0.1s; margin-bottom: clamp(1.625rem,3.5vw,2.875rem);">
        <h2 class="text-xs mb-5">Альбомы</h2>
        <div id="albums-grid"></div>
      </section>
      <section class="stagger-item" style="animation-delay: 0.2s;">
        <h2 class="text-xs mb-5">Синглы</h2>
        <div id="singles-grid"></div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { legacyBridge } from '@/runtime/legacyBridge'

const toggleFlowMode = () => legacyBridge.toggleFlowMode()
</script>
