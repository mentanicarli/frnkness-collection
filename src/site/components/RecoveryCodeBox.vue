<template>
  <div class="recovery-box" data-testid="recovery-box">
    <p class="recovery-code" data-testid="recovery-code" aria-label="Код восстановления">{{ code }}</p>
    <p class="acc-hint">Код показывается один раз и подходит один раз. Сохрани его там, где его не потеряешь: по нему можно сменить пароль без помощи владельца.</p>
    <div class="acc-actions" style="margin-top: 0.75rem;">
      <button class="acc-btn acc-btn-sm" type="button" data-testid="recovery-copy" @click="copy">{{ copied ? 'Скопировано' : 'Скопировать' }}</button>
      <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" :disabled="busy || !(copied || written)" data-testid="recovery-saved" @click="emit('saved')">
        <span v-if="busy" class="acc-spinner"></span>
        Я сохранил
      </button>
    </div>
    <label class="acc-check" style="margin-top: 0.75rem;">
      <input v-model="written" type="checkbox" name="recovery-written" data-testid="recovery-written">
      <span>Я записал код другим способом</span>
    </label>
    <p v-if="copyFailed" class="acc-hint" role="status">Не получилось скопировать — выдели код и скопируй вручную.</p>
    <p v-if="error" class="acc-alert acc-alert-error" role="alert" data-testid="recovery-error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
// Показ кода восстановления: «Скопировать» и «Я сохранил». «Я сохранил» доступно
// после копирования (или если человек отметил, что записал код сам): пропустить
// экран, не взяв код, нельзя. Текст кода выводится интерполяцией.
import { ref } from 'vue'
import { copyToClipboard } from '../share'

const props = defineProps<{ code: string; busy?: boolean; error?: string }>()
const emit = defineEmits<{ saved: [] }>()

const copied = ref(false)
const copyFailed = ref(false)
const written = ref(false)

async function copy() {
  copyFailed.value = false
  copied.value = await copyToClipboard(props.code)
  copyFailed.value = !copied.value
}
</script>
