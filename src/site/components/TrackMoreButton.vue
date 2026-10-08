<template>
  <button
    class="track-more"
    type="button"
    aria-label="Действия с треком"
    aria-haspopup="dialog"
    data-testid="track-more"
    @click.stop="openTrackMenu(trackId, extras)"
    @pointerdown.stop
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
    </svg>
  </button>
</template>

<script setup lang="ts">
// Одна кнопка «⋯» вместо набора иконок: открывает нижнюю панель с действиями трека.
import { openTrackMenu, type MenuAction } from '../social/trackMenu'

withDefaults(defineProps<{ trackId: string; extras?: MenuAction[] }>(), { extras: () => [] })
</script>
