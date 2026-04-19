<template>
  <div id="particles-js"></div>
  <AppHeader />
  <MainPages />
  <LyricsAndPlayers />
</template>

<script setup lang="ts">
// Корневая композиция экранов.
// Логику отрисовки и интеракций держим в дочерних модулях.
import AppHeader from '@components/AppHeader.vue'
import MainPages from '@components/MainPages.vue'
import LyricsAndPlayers from '@components/LyricsAndPlayers.vue'
</script>
