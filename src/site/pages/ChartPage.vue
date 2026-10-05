<template>
  <div id="page-chart" class="page active">
    <div class="shell shell-narrow px-6" style="padding-top: 1.5rem; padding-bottom: 8.125rem;">
      <BackButton />
      <div class="mb-8">
        <h1 class="text-3xl font-bold tracking-tight">Чарт песен</h1>
      </div>
      <div id="chart-list" class="flex flex-col">
        <template v-if="chart">
          <p v-if="!chart.ok" class="text-center text-[var(--fg-muted)] mt-10">{{ chart.reason === 'no-db' ? 'База недоступна.' : 'Ошибка загрузки.' }}</p>
          <p v-else-if="!chart.tracks.length" class="text-center text-[var(--fg-muted)] mt-10">Список пуст.</p>
          <template v-else>
            <div
              v-for="(t, i) in chart.tracks"
              :key="`${t.releaseId}-${t.trackIndex}`"
              class="chart-row cursor-pointer group"
              @click="play(t.releaseId, t.trackIndex)"
            >
              <div class="chart-num" :class="i < 3 ? `top-${i + 1}` : ''">{{ i + 1 }}</div>
              <div class="chart-cover"><img :loading="i < 8 ? 'eager' : 'lazy'" decoding="async" :fetchpriority="i < 3 ? 'high' : 'low'" :src="t.cover" alt=""></div>
              <div class="chart-info"><div class="chart-title">{{ t.title }}</div><div class="chart-artist">frnk ness</div></div>
              <div class="chart-plays"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>{{ t.plays }}</div>
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { playTrackByRef } from '../player/engine'
import { loadChart, statsVersion, type ChartResult } from '../services/stats'
import { goRelease } from '../router'
import BackButton from '../components/BackButton.vue'

const route = useRoute()
// Пока цифры грузятся, на экране остаётся прежний список.
const chart = shallowRef<ChartResult | null>(null)
let token = 0

// Чарт перечитывается при каждом открытии и после засчитанного
// прослушивания, пока он открыт.
watch([() => route.name, statsVersion], async () => {
  if (route.name !== 'chart') return
  const mine = ++token
  const result = await loadChart()
  if (mine === token) chart.value = result
}, { immediate: true })

// Клик по строке — релиз этого трека и сразу воспроизведение.
function play(releaseId: string, trackIndex: number) {
  goRelease(releaseId)
  playTrackByRef(releaseId, trackIndex, 'fade')
}
</script>
