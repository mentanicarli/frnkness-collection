<template>
  <main class="min-h-screen relative z-10">
    <HomePage />
    <ChartPage />
    <ReleasePage />
    <TrackPage />
  </main>
</template>

<script setup lang="ts">
// Все страницы смонтированы всегда, видна только активная (класс .active):
// legacy-код ещё рисует содержимое внутри них по id.
import HomePage from '@/site/pages/HomePage.vue'
import ChartPage from '@/site/pages/ChartPage.vue'
import ReleasePage from '@/site/pages/ReleasePage.vue'
import TrackPage from '@/site/pages/TrackPage.vue'
</script>
