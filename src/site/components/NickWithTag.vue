<template>
  <span class="nick-tag" data-testid="nick-tag"><span class="nick-tag-name"><slot>{{ nick }}</slot></span><UserTag :user-id="userId" /></span>
</template>

<script setup lang="ts">
// Ник (или любой его вывод через слот, например ссылка) и тег одной неразрывной
// группой: тег не растягивается и не уходит на новую строку отдельно от ника.
import UserTag from './UserTag.vue'

defineProps<{ userId?: string | null; nick?: string }>()
</script>
