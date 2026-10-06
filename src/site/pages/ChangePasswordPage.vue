<template>
  <div class="acc-shell">
    <div class="acc-card">
      <p class="acc-brand"><b>frnk ness</b><small>collection</small></p>
      <h1 class="acc-title">Придумай новый пароль</h1>
      <p class="acc-sub">Ты вошёл с временным паролем. Чтобы продолжить, задай свой — временный больше не подойдёт.</p>
      <form class="acc-form" novalidate @submit.prevent="submit">
        <input class="sr-only" type="text" name="username" autocomplete="username" :value="session.user?.nick ?? ''" readonly tabindex="-1" aria-hidden="true">
        <div class="acc-field">
          <label class="acc-label" for="cp-pass">Новый пароль</label>
          <input id="cp-pass" v-model="password" class="acc-input" type="password" name="new-password" autocomplete="new-password" aria-describedby="cp-pass-hint" required>
          <span id="cp-pass-hint" class="acc-hint">Минимум 8 символов, не совпадает с ником</span>
        </div>
        <label class="acc-field">
          <span class="acc-label">Повтор пароля</span>
          <input v-model="password2" class="acc-input" type="password" name="new-password-repeat" autocomplete="new-password" required>
        </label>
        <div v-if="error" class="acc-alert acc-alert-error" role="alert">{{ error }}</div>
        <button class="acc-btn acc-btn-primary" type="submit" :disabled="busy">
          <span v-if="busy" class="acc-spinner"></span>
          Сохранить и продолжить
        </button>
      </form>
      <div class="acc-links">
        <button class="acc-link" type="button" @click="logout">Выйти</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { callFunction, refreshAccount, session, signOut } from '@/site/session'
import { goAfterLogin } from '@/site/router'
import { validatePassword } from '../../../supabase/functions/_shared/accounts.ts'

const route = useRoute()
const router = useRouter()
const password = ref('')
const password2 = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  if (busy.value) return
  error.value = validatePassword(password.value, session.user?.nick ?? '') ?? (password.value !== password2.value ? 'Пароли не совпадают' : '')
  if (error.value) return
  busy.value = true
  try {
    const res = await callFunction('account', { action: 'change-password', password: password.value })
    if (!res.ok) {
      error.value = res.error ?? 'Не удалось сменить пароль'
      return
    }
    await refreshAccount()
    goAfterLogin(route.query.next)
  } finally {
    busy.value = false
  }
}

async function logout() {
  await signOut()
  void router.replace({ name: 'welcome' })
}
</script>
