<template>
  <span class="pl-cover" :class="{ grid: layout.kind === 'grid' }" :data-cover-kind="layout.kind" aria-hidden="true">
    <img v-if="layout.kind === 'custom'" :src="layout.covers[0]" alt="" loading="lazy" decoding="async" data-testid="playlist-cover-img" @error="fail(layout.covers[0])">
    <template v-else-if="layout.kind === 'grid'">
      <img v-for="c in layout.covers" :key="c" :src="c" alt="" loading="eager" decoding="async" data-testid="playlist-collage-img" @error="fail(c)">
    </template>
    <img v-else-if="layout.kind === 'single'" :src="layout.covers[0]" alt="" loading="lazy" decoding="async" data-testid="playlist-collage-img" @error="fail(layout.covers[0])">
    <svg v-else width="40%" height="40%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" data-testid="playlist-cover-empty"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
  </span>
</template>

<script setup lang="ts">
// Обложка плейлиста: своя картинка — всегда одна и на весь квадрат; иначе коллаж
// из обложек разных релизов (см. coverLayout). Пустых клеток не бывает.
import { computed, ref } from 'vue'
import { coverLayout } from '../social/tracks'

const props = defineProps<{ firstTracks: readonly string[]; url?: string | null }>()
const failed = ref<ReadonlySet<string>>(new Set())
const layout = computed(() => coverLayout(props.firstTracks, props.url, failed.value))
function fail(src: string) {
  failed.value = new Set(failed.value).add(src)
}
</script>
