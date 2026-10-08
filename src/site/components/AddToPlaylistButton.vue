<template>
  <button
    class="fav-btn track-action"
    type="button"
    aria-label="В плейлист"
    title="В плейлист"
    data-testid="add-to-playlist-btn"
    @click.stop="trackId && openAddToPlaylist(trackId)"
    @pointerdown.stop
  >
    <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="M3 6h12M3 12h12M3 18h8M18 13v8M14 17h8" />
    </svg>
  </button>
</template>

<script setup lang="ts">
// «+ в плейлист» из любого места: открывает общий диалог выбора.
import { openAddToPlaylist } from '../social/addDialog'

withDefaults(defineProps<{ trackId: string | null; size?: number }>(), { size: 16 })
</script>
