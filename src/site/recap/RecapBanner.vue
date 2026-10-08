<template>
  <aside v-if="show" class="recap-banner" role="region" aria-label="Итоги года" data-testid="recap-banner">
    <div class="recap-banner-text">
      <b>Твои итоги {{ recapStore.state?.year }} готовы</b>
      <span>Посмотри, как прошёл твой год в музыке</span>
    </div>
    <div class="recap-banner-actions">
      <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" data-testid="recap-banner-open" @click="open">Смотреть</button>
      <button class="acc-btn acc-btn-sm" type="button" data-testid="recap-banner-close" @click="dismissBanner()">Закрыть</button>
    </div>
  </aside>
</template>

<script setup lang="ts">
// Плашка «Твои итоги <год> готовы» при входе. «Закрыть» запоминается (на
// этом устройстве, по году) — сама больше не появляется; ссылка «Итоги» в
// меню профиля остаётся.
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { bannerVisible, dismissBanner, recapStore } from './store'

const route = useRoute()
const router = useRouter()
const show = computed(() => bannerVisible() && route.name !== 'recap' && !route.meta.bare)

function open() {
  const year = recapStore.state?.year
  dismissBanner()
  if (year) void router.push({ name: 'recap', params: { year } })
}
</script>

<style scoped>
.recap-banner {
  position: fixed; z-index: 120; left: 50%; transform: translateX(-50%);
  bottom: calc(1rem + env(safe-area-inset-bottom, 0px)); width: min(34rem, calc(100% - 1.5rem));
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
  padding: 0.875rem 1rem; border-radius: var(--r-lg); background: var(--bg-card, #161618); border: 1px solid var(--border, rgba(255, 255, 255, 0.13));
  box-shadow: var(--shadow-pop, 0 1.5rem 3.75rem -1.75rem #000); animation: recap-banner-in 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.recap-banner-text { display: flex; flex-direction: column; gap: 0.125rem; min-width: 0; }
.recap-banner-text b { font-family: 'Unbounded'; font-size: 0.9375rem; }
.recap-banner-text span { color: var(--fg-muted, #a7a7ad); font-size: 0.8125rem; }
.recap-banner-actions { display: flex; gap: 0.5rem; }
@keyframes recap-banner-in { from { opacity: 0; transform: translate(-50%, 1rem); } to { opacity: 1; transform: translate(-50%, 0); } }
@media (prefers-reduced-motion: reduce) { .recap-banner { animation: none; } }
</style>
