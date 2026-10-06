<template>
  <div class="acc-shell">
    <div class="acc-card">
      <RouterLink class="acc-brand" :to="{ name: 'welcome', query: nextQuery }"><b>frnk ness</b><small>collection</small></RouterLink>
      <h1 class="acc-title">Вход</h1>
      <form class="acc-form" novalidate @submit.prevent="submit">
        <label class="acc-field">
          <span class="acc-label">Ник</span>
          <input v-model="nick" class="acc-input" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="40" required>
        </label>
        <label class="acc-field">
          <span class="acc-label">Пароль</span>
          <input v-model="password" class="acc-input" type="password" name="password" autocomplete="current-password" required>
        </label>
        <div v-if="error" class="acc-alert acc-alert-error" role="alert">{{ error }}</div>
        <button class="acc-btn acc-btn-primary" type="submit" :disabled="busy">
          <span v-if="busy" class="acc-spinner"></span>
          Войти
        </button>
      </form>
      <div class="acc-links">
        <RouterLink class="acc-link" :to="{ name: 'forgot' }">Забыли пароль?</RouterLink>
        <RouterLink class="acc-link" :to="{ name: 'register', query: nextQuery }">Зарегистрироваться</RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { signIn } from '@/site/session'
import { sanitizeNext } from '@/site/auth/redirect'
import { goAfterLogin } from '@/site/router'

const route = useRoute()
const nextQuery = computed(() => {
  const next = sanitizeNext(route.query.next)
  return next ? { next } : {}
})

const nick = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    const message = await signIn(nick.value, password.value)
    if (message) {
      error.value = message
      return
    }
    password.value = ''
    goAfterLogin(route.query.next)
  } finally {
    busy.value = false
  }
}
</script>
