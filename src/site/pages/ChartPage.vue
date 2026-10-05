<template>
  <div id="page-chart" class="page">
    <div class="shell shell-narrow px-6" style="padding-top: 1.5rem; padding-bottom: 8.125rem;">
      <BackButton />
      <div class="mb-8">
        <h1 class="text-3xl font-bold tracking-tight">Чарт песен</h1>
      </div>
      <div id="chart-list" class="flex flex-col"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import BackButton from '../components/BackButton.vue'
</script>
