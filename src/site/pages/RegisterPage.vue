<template>
  <div class="acc-shell">
    <div class="acc-card">
      <RouterLink class="acc-brand" :to="{ name: 'welcome', query: nextQuery }"><b>frnk ness</b><small>collection</small></RouterLink>
      <h1 class="acc-title">Регистрация</h1>
      <p class="acc-sub">Почта не нужна. Запомни ник и пароль: восстановить доступ можно только заявкой владельцу сайта.</p>
      <form class="acc-form" novalidate @submit.prevent="submit">
        <label class="acc-field">
          <span class="acc-label">Ник</span>
          <input
            v-model="nick"
            class="acc-input"
            name="username"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            maxlength="20"
            :aria-invalid="nickError ? 'true' : 'false'"
            required
            @blur="nickTouched = true"
          >
          <span v-if="nickTouched && nickError" class="acc-hint" style="color: #ffb3b5;">{{ nickError }}</span>
          <span v-else class="acc-hint">3–20 символов: русские и латинские буквы, цифры, «_», «.», «-»</span>
        </label>
        <label class="acc-field">
          <span class="acc-label">Пароль</span>
          <input v-model="password" class="acc-input" type="password" name="new-password" autocomplete="new-password" required>
          <span class="acc-hint">Минимум 8 символов, не совпадает с ником</span>
        </label>
        <label class="acc-field">
          <span class="acc-label">Повтор пароля</span>
          <input v-model="password2" class="acc-input" type="password" name="new-password-repeat" autocomplete="new-password" required>
        </label>
        <label class="acc-check">
          <input v-model="agree" type="checkbox" name="agree">
          <span>Согласен с тем, <RouterLink class="acc-link" :to="{ name: 'privacy' }" target="_blank">какие данные хранятся</RouterLink></span>
        </label>
        <TurnstileWidget ref="captcha" @token="captchaToken = $event" />
        <div v-if="error" class="acc-alert acc-alert-error" role="alert">{{ error }}</div>
        <button class="acc-btn acc-btn-primary" type="submit" :disabled="busy">
          <span v-if="busy" class="acc-spinner"></span>
          Зарегистрироваться
        </button>
      </form>
      <div class="acc-links">
        <RouterLink class="acc-link" :to="{ name: 'login', query: nextQuery }">Уже есть аккаунт? Войти</RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { register } from '@/site/session'
import { sanitizeNext } from '@/site/auth/redirect'
import { goAfterLogin } from '@/site/router'
import TurnstileWidget from '@/site/components/TurnstileWidget.vue'
import { validateNick, validatePassword } from '../../../supabase/functions/_shared/accounts.ts'

const route = useRoute()
const nextQuery = computed(() => {
  const next = sanitizeNext(route.query.next)
  return next ? { next } : {}
})

const nick = ref('')
const nickTouched = ref(false)
const password = ref('')
const password2 = ref('')
const agree = ref(false)
const captchaToken = ref('')
const captcha = ref<InstanceType<typeof TurnstileWidget> | null>(null)
const error = ref('')
const busy = ref(false)

const nickError = computed(() => (nick.value ? validateNick(nick.value) : 'Придумай ник'))

function check(): string | null {
  if (nickError.value) return nickError.value
  const pass = validatePassword(password.value, nick.value)
  if (pass) return pass
  if (password.value !== password2.value) return 'Пароли не совпадают'
  if (!agree.value) return 'Нужно согласие с тем, какие данные мы храним'
  if (!captchaToken.value) return 'Пройди проверку «я не робот»'
  return null
}

async function submit() {
  if (busy.value) return
  nickTouched.value = true
  error.value = check() ?? ''
  if (error.value) return
  busy.value = true
  try {
    const message = await register(nick.value, password.value, captchaToken.value)
    if (message) {
      error.value = message
      captcha.value?.reset()
      return
    }
    goAfterLogin(route.query.next)
  } finally {
    busy.value = false
  }
}
</script>
