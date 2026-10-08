<template>
  <!-- Промо «последний релиз» на главной. Та же карточка — в превью админки. -->
  <div
    ref="card"
    class="release-card promo-release-card text-left relative w-full"
    data-fixed-accent="true"
    style="cursor: pointer; padding: clamp(1rem,2vw,1.625rem);"
    @click="emit('open', releaseId)"
  >
    <div class="flex flex-col sm:flex-row items-start sm:items-center" style="gap: clamp(1.125rem,3vw,2.5rem);">
      <div class="promo-cover-wrap aspect-square overflow-hidden bg-[var(--bg)] flex-shrink-0" style="border-radius: 0.5rem;">
        <img :src="release.cover" :srcset="coverSrcset(release.cover)" sizes="(max-width: 640px) 100vw, 480px" :alt="release.title" class="card-image w-full h-full object-cover" loading="eager" decoding="async" fetchpriority="high" @error="hideBrokenImage">
      </div>
      <div class="flex-1 min-w-0 flex flex-col" style="gap: 1rem;">
        <div class="promo-badge">последний релиз</div>
        <h3 class="promo-title line-clamp-2 relative z-10" style="font-size: clamp(1.5rem,4vw,3.125rem); line-height: 1;">{{ release.title }}</h3>
        <div class="flex items-center gap-3">
          <button class="promo-cta inline-flex items-center gap-2" style="height: 2.75rem; padding: 0 1.25rem; border-radius: 0.375rem; font-size: 0.8125rem;">
            Перейти
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { coverSrcset } from '@/utils/cover'
import { onMounted, ref, watch } from 'vue'
import type { Release } from '@/types'
import { applyCardAccent } from '../services/colors'
import { hideBrokenImage, useCardHover } from '../composables/useCardHover'

const props = defineProps<{ releaseId: string; release: Release }>()
const emit = defineEmits<{ open: [releaseId: string] }>()

const card = ref<HTMLElement | null>(null)
useCardHover(card, { fixedAccent: true })

// Промо всегда в цветах своей обложки, не только под курсором.
onMounted(() => {
  if (card.value) void applyCardAccent(card.value, props.release.cover)
})
watch(() => props.release.cover, (cover) => {
  if (card.value) void applyCardAccent(card.value, cover)
})
</script>
