<template>
  <div v-if="status === 'loading'" class="acc-shell" aria-busy="true"><span class="acc-spinner" aria-label="Загрузка"></span></div>
  <RecapStory v-else-if="status === 'ready' && data" :recap="data" :catalog="catalog" @close="close" />
  <div v-else class="acc-shell">
    <div class="acc-card">
      <p class="acc-alert acc-alert-error" role="alert" data-testid="recap-error">Не получилось открыть итоги. Попробуй ещё раз позже.</p>
      <button class="acc-btn acc-btn-sm" type="button" @click="close">На главную</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Итоги года: загрузка и полноэкранный просмотр. Адрес чужого или
// закрытого года ведёт на главную — следа функции не остаётся.
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { releases } from '@/config'
import RecapStory from '../recap/RecapStory.vue'
import { recapApi } from '../recap/api'
import { catalogFromReleases } from '../recap/catalog'
import { loadRecapState, recapStore } from '../recap/store'
import type { Recap } from '../recap/types'

const route = useRoute()
const router = useRouter()
const catalog = catalogFromReleases(releases)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const data = ref<Recap | null>(null)

function close() {
  if (window.history.state?.back) router.back()
  else void router.replace({ name: 'home' })
}

onMounted(async () => {
  const year = Number(route.params.year)
  if (!recapStore.loaded) await loadRecapState()
  if (!recapStore.state || !recapStore.state.years.includes(year)) {
    void router.replace({ name: 'home' })
    return
  }
  try {
    data.value = await recapApi.get(year)
    status.value = 'ready'
  } catch (e) {
    // «Недоступно» — как будто страницы нет.
    if ((e as { code?: string }).code === '42501') {
      void router.replace({ name: 'home' })
      return
    }
    status.value = 'error'
  }
})
</script>
