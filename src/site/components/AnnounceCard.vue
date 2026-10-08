<template>
  <!--
    Анонс «скоро выйдет» на главной, с живым отсчётом. Та же карточка — в
    превью админки. Время вышло — событие expire (сайт убирает карточку).
  -->
  <div
    ref="card"
    class="release-card promo-release-card announce-card text-left relative w-full"
    :data-release-at="dated ? at : undefined"
    style="padding: clamp(1rem,2vw,1.625rem);"
  >
    <div class="flex flex-col sm:flex-row items-start sm:items-center" style="gap: clamp(1.125rem,3vw,2.5rem);">
      <div class="promo-cover-wrap aspect-square overflow-hidden bg-[var(--bg)] flex-shrink-0" style="border-radius: 0.5rem;">
        <img :src="announce.cover" :srcset="coverSrcset(announce.cover)" sizes="(max-width: 640px) 100vw, 480px" :alt="announce.title" class="card-image w-full h-full object-cover" loading="eager" decoding="async" @error="hideBrokenImage">
      </div>
      <div class="flex-1 min-w-0 flex flex-col" style="gap: 1rem;">
        <div class="promo-badge">{{ dated ? 'скоро' : 'анонс' }}</div>
        <h3 class="promo-title line-clamp-2 relative z-10" style="font-size: clamp(1.5rem,4vw,3.125rem); line-height: 1;">{{ announce.title }}</h3>
        <template v-if="dated">
          <div class="announce-countdown" aria-live="off" role="timer">{{ countdown }}</div>
          <p class="announce-when">Выйдет {{ formatReleaseMoment(announce.releaseAt!) }}</p>
        </template>
        <div v-else class="announce-countdown announce-soon">Скоро</div>
        <p v-if="announce.text" class="announce-text">{{ announce.text }}</p>
        <a
          v-if="link"
          class="promo-cta announce-cta inline-flex items-center gap-2"
          :href="link"
          target="_blank"
          rel="noopener"
          style="height: 2.75rem; padding: 0 1.25rem; border-radius: 0.375rem; font-size: 0.8125rem;"
        >
          Подробнее
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { coverSrcset } from '@/utils/cover'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Announce } from '@/types'
import { formatCountdown, formatReleaseMoment, hasReleaseDate, releaseTime, safeAnnounceUrl } from '@/utils/announceCard'
import { applyCardAccent } from '../services/colors'
import { hideBrokenImage, useCardHover } from '../composables/useCardHover'

const props = defineProps<{ announce: Announce }>()
const emit = defineEmits<{ expire: [] }>()

const card = ref<HTMLElement | null>(null)
useCardHover(card)

const dated = computed(() => hasReleaseDate(props.announce))
const at = computed(() => releaseTime(props.announce))
const link = computed(() => safeAnnounceUrl(props.announce.url))

const now = ref(Date.now())
const countdown = computed(() => formatCountdown(at.value - now.value))

let timer: ReturnType<typeof setInterval> | null = null
function stop() {
  if (timer !== null) clearInterval(timer)
  timer = null
}
function tick() {
  now.value = Date.now()
  if (!dated.value) return
  if (!Number.isFinite(at.value) || at.value - now.value <= 0) {
    stop()
    emit('expire')
  }
}
function start() {
  stop()
  tick()
  if (dated.value && Number.isFinite(at.value) && at.value > Date.now()) timer = setInterval(tick, 1000)
}

onMounted(() => {
  start()
  if (card.value) void applyCardAccent(card.value, props.announce.cover)
})
watch(() => [props.announce.releaseAt, props.announce.cover], () => {
  start()
  if (card.value) void applyCardAccent(card.value, props.announce.cover)
})
onBeforeUnmount(stop)
</script>
