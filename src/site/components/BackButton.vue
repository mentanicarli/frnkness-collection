<template>
  <button @click="goHome" class="flex items-center gap-2 text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors mb-8 group">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="group-hover:-translate-x-1 transition-transform">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
    <span class="text-sm">Назад</span>
  </button>
</template>

<script setup lang="ts">
// «Назад» на чарте и странице релиза ведёт на главную, а не по истории.
import { goHome } from '../router'
</script>
