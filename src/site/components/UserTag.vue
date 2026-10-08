<template>
  <span v-if="tag" class="user-tag" :style="{ background: tag.color, color: textColor }" :title="`Тег: ${tag.name}`" data-testid="user-tag">{{ tag.name }}</span>
</template>

<script setup lang="ts">
// Значок-тег рядом с ником. Название выводится интерполяцией (с экранированием),
// цвет перед подстановкой в стиль уже проверен как #RRGGBB (social/tags.ts).
import { computed } from 'vue'
import { tagOf } from '../social/tags'
import { tagTextColor } from '@/utils/tagColor'

const props = defineProps<{ userId?: string | null }>()
const tag = computed(() => tagOf(props.userId))
const textColor = computed(() => (tag.value ? tagTextColor(tag.value.color) : '#ffffff'))
</script>
