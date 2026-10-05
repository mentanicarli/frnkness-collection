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
            :class="{ active: state.flowModeActive }"
            style="height: 3.125rem;"
            :aria-pressed="state.flowModeActive ? 'true' : 'false'"
            :aria-label="state.flowModeActive ? 'Остановить поток' : 'Включить поток'"
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
      <!-- Промо-блок: анонс будущего релиза (если включён и время не вышло), под ним — последний релиз. -->
      <section id="home-promo" class="stagger-item" style="margin-bottom: clamp(1.625rem,4vw,3.25rem);">
        <AnnounceCard v-if="showAnnounce" :announce="ANNOUNCE!" @expire="announceExpired = true" />
        <PromoCard v-if="promoRelease" :release-id="PROMO_RELEASE_ID" :release="promoRelease" @open="goRelease" />
      </section>
      <section class="stagger-item" style="animation-delay: 0.1s; margin-bottom: clamp(1.625rem,3.5vw,2.875rem);">
        <h2 class="text-xs mb-5">Альбомы</h2>
        <div id="albums-grid">
          <ReleaseCard v-for="card in albums" :key="card.id" :release-id="card.id" :release="card.release" :priority="card.priority" />
        </div>
      </section>
      <section class="stagger-item" style="animation-delay: 0.2s;">
        <h2 class="text-xs mb-5">Синглы</h2>
        <div id="singles-grid">
          <ReleaseCard v-for="card in singles" :key="card.id" :release-id="card.id" :release="card.release" :priority="card.priority" />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ANNOUNCE, PROMO_RELEASE_ID, SHOW_NEW_RELEASE_PROMO, releases } from '@/config'
import { runtimeState as state } from '@/runtime/sharedState'
import { legacyBridge } from '@/runtime/legacyBridge'
import { isAnnounceActive } from '@/utils/announceCard'
import { goRelease } from '../router'
import AnnounceCard from '../components/AnnounceCard.vue'
import PromoCard from '../components/PromoCard.vue'
import ReleaseCard from '../components/ReleaseCard.vue'

const toggleFlowMode = () => legacyBridge.toggleFlowMode()

const promoRelease = SHOW_NEW_RELEASE_PROMO ? releases[PROMO_RELEASE_ID] ?? null : null
// Анонс проверяется при открытии сайта; время вышло — карточка исчезает.
const announceExpired = ref(false)
const showAnnounce = computed(() => !announceExpired.value && isAnnounceActive(ANNOUNCE))

// Порядок карточек — порядок релизов в releases.json; priority — место
// карточки среди всех (первые грузятся сразу).
const cards = Object.entries(releases).map(([id, release], priority) => ({ id, release, priority }))
const albums = cards.filter((c) => c.release.type === 'album')
const singles = cards.filter((c) => c.release.type !== 'album')
</script>
