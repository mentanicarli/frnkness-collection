<template>
  <span class="pl-cover" :class="{ grid: shown.length === 4 }" aria-hidden="true">
    <img v-if="url" :src="url" alt="" loading="lazy" decoding="async" data-testid="playlist-cover-img">
    <template v-else-if="shown.length">
      <img v-for="c in shown" :key="c" :src="c" alt="" loading="lazy" decoding="async" data-testid="playlist-collage-img">
    </template>
    <svg v-else width="40%" height="40%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
  </span>
</template>

<script setup lang="ts">
// Обложка плейлиста: своя картинка или коллаж из обложек первых треков
// (четыре разные — сеткой 2×2, меньше — одна).
import { computed } from 'vue'
import { collageCovers } from '../social/tracks'

const props = defineProps<{ firstTracks: readonly string[]; url?: string | null }>()
const shown = computed(() => {
  const covers = collageCovers(props.firstTracks)
  return covers.length >= 4 ? covers : covers.slice(0, 1)
})
</script>
