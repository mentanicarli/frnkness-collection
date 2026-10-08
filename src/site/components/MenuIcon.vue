<template>
  <!-- Один набор иконок меню: линейные, 24×24, как у остальных значков сайта. -->
  <svg class="menu-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path v-if="name === 'heart'" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    <template v-else-if="name === 'playlist'"><path d="M3 6h12M3 12h12M3 18h7" /><circle cx="18" cy="17" r="2.5" /><path d="M20.5 17V7l-4 1" /></template>
    <template v-else-if="name === 'friends'"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></template>
    <path v-else-if="name === 'feed'" d="M22 12h-4l-3 9L9 3l-3 9H2" />
    <template v-else-if="name === 'plus'"><circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" /></template>
    <path v-else-if="name === 'enter'" d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
    <path v-else-if="name === 'settings'" d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    <path v-else-if="name === 'flag'" d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />
    <path v-else-if="name === 'shield'" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path v-else-if="name === 'logout'" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    <path v-else-if="name === 'star'" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    <path v-else-if="name === 'chevron'" d="M9 18l6-6-6-6" />
  </svg>
</template>

<script setup lang="ts">
export type MenuIconName = 'heart' | 'playlist' | 'friends' | 'feed' | 'plus' | 'enter' | 'settings' | 'flag' | 'shield' | 'logout' | 'star' | 'chevron'

defineProps<{ name: MenuIconName }>()
</script>
