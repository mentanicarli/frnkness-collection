<template>
  <button ref="card" class="release-card text-left transition-all group relative" :data-id="releaseId" @click="goRelease(releaseId)">
    <div class="aspect-square overflow-hidden mb-3 bg-[var(--bg)] relative">
      <!-- loading и fetchpriority — до src: браузер решает, как грузить, в момент установки адреса. -->
      <img
        :loading="priority < 6 ? 'eager' : 'lazy'"
        decoding="async"
        :fetchpriority="priority < 4 ? 'high' : 'low'"
        :src="release.cover" :srcset="coverSrcset(release.cover)" sizes="(max-width: 640px) 50vw, 300px"
        :alt="release.title"
        class="card-image w-full h-full object-cover"
        @error="hideBrokenImage"
      >
    </div>
    <h3 class="font-semibold text-[var(--fg)] transition-colors line-clamp-2 relative z-10">{{ release.title }}</h3>
    <p class="text-xs text-[var(--fg-muted)] mt-1 relative z-10">{{ release.type === 'album' ? `${release.tracks.length} треков` : 'Сингл' }} • {{ release.year }}</p>
  </button>
</template>

<script setup lang="ts">
import { coverSrcset } from '@/utils/cover'
import { ref } from 'vue'
import type { Release } from '@/types'
import { goRelease } from '../router'
import { hideBrokenImage, useCardHover } from '../composables/useCardHover'

defineProps<{
  releaseId: string
  release: Release
  /** Место карточки на главной: первые грузятся сразу и с высоким приоритетом. */
  priority: number
}>()

const card = ref<HTMLElement | null>(null)
useCardHover(card)
</script>
