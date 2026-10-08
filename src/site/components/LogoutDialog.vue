<template>
  <div v-if="logoutUi.open" class="cropper-backdrop" @click.self="close">
    <div class="cropper-box confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="logout-title" data-testid="logout-confirm" @keydown.esc="close">
      <p id="logout-title" class="acc-title" style="font-size: 1.125rem;">Выйти из аккаунта?</p>
      <div class="acc-actions" style="justify-content: flex-end; margin-top: 1rem;">
        <button ref="cancelBtn" class="acc-btn acc-btn-sm" type="button" data-testid="logout-cancel" @click="close">Отмена</button>
        <button class="acc-btn acc-btn-danger acc-btn-sm" type="button" :disabled="busy" data-testid="logout-confirm-btn" @click="confirm">Выйти</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Подтверждение выхода в стиле сайта (не системный confirm).
import { nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { signOut } from '../session'
import { logoutUi } from '../logout'

const router = useRouter()
const busy = ref(false)
const cancelBtn = ref<HTMLButtonElement | null>(null)

function close() {
  logoutUi.open = false
}

// Фокус на «Отмене»: случайный Enter не выходит из аккаунта.
watch(
  () => logoutUi.open,
  (open) => {
    if (open) void nextTick(() => cancelBtn.value?.focus())
  }
)

async function confirm() {
  busy.value = true
  try {
    await signOut()
    close()
    void router.replace({ name: 'welcome' })
  } finally {
    busy.value = false
  }
}
</script>
