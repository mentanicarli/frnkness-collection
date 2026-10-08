<template>
  <div class="notice-toast" :class="{ show: Boolean(notice.text), error: notice.error }" role="status" aria-live="polite" data-testid="notice">{{ notice.text }}</div>
</template>

<script setup lang="ts">
import { notice } from '../social/notice'
</script>
