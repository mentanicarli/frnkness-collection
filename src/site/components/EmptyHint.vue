<template>
  <div class="empty-hint" role="note" data-testid="empty-hint">
    <p class="empty-hint-title">{{ title }}</p>
    <p class="empty-hint-text">{{ text }}</p>
    <div v-if="$slots.default" class="empty-hint-actions"><slot /></div>
  </div>
</template>

<script setup lang="ts">
// Подсказка вместо пустого раздела: что здесь будет, как это заполнить, и
// кнопка-действие (слот). Тексты выводятся интерполяцией — с экранированием.
defineProps<{ title: string; text: string }>()
</script>
