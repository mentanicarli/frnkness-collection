<template>
  <button
    class="fav-btn track-action"
    :class="{ on }"
    type="button"
    :aria-pressed="on ? 'true' : 'false'"
    :aria-label="on ? 'Убрать из избранного' : 'В избранное'"
    :title="on ? 'Убрать из избранного' : 'В избранное'"
    data-testid="favorite-btn"
    @click.stop="toggle"
    @pointerdown.stop
  >
    <svg :width="size" :height="size" viewBox="0 0 24 24" :fill="on ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
    </svg>
  </button>
</template>

<script setup lang="ts">
// Сердечко: треклист, страница трека, мини- и полноэкранный плеер.
import { computed } from 'vue'
import { isFavorite, toggleFavorite } from '../social/favorites'

const props = withDefaults(defineProps<{ trackId: string | null; size?: number }>(), { size: 16 })
const on = computed(() => isFavorite(props.trackId))

function toggle() {
  if (props.trackId) void toggleFavorite(props.trackId)
}
</script>
