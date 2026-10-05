<template>
  <!-- «О треке» из .notes.json: абзацы через пустую строку. Общий с админкой. -->
  <section v-if="paragraphs.length" class="track-section">
    <h2 class="track-section-title">О треке</h2>
    <div class="track-about"><p v-for="(p, i) in paragraphs" :key="i">{{ p }}</p></div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ about?: string | null }>()

const paragraphs = computed(() => {
  const about = typeof props.about === 'string' ? props.about.trim() : ''
  return about ? about.split(/\n{2,}/).map((block) => block.trim()) : []
})
</script>
