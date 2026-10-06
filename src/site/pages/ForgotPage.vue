<template>
  <div class="acc-shell">
    <div class="acc-card">
      <RouterLink class="acc-brand" :to="{ name: 'welcome' }"><b>frnk ness</b><small>collection</small></RouterLink>
      <h1 class="acc-title">Забыли пароль?</h1>
      <template v-if="sent">
        <div class="acc-alert acc-alert-ok" role="status" data-testid="recovery-sent">
          Заявка отправлена. Если такой ник есть, владелец сайта свяжется с тобой по указанному контакту и передаст временный пароль.
        </div>
        <div class="acc-links">
          <RouterLink class="acc-link" :to="{ name: 'login' }">Ко входу</RouterLink>
        </div>
      </template>
      <template v-else>
        <p class="acc-sub">Почты на сайте нет, поэтому пароль восстанавливает владелец сайта лично: он свяжется с тобой и передаст временный пароль. При входе с ним нужно будет придумать новый.</p>
        <form class="acc-form" novalidate @submit.prevent="submit">
          <label class="acc-field">
            <span class="acc-label">Ник</span>
            <input v-model="nick" class="acc-input" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="40" required>
          </label>
          <label class="acc-field">
            <span class="acc-label">Как с тобой связаться</span>
            <input v-model="contact" class="acc-input" name="contact" maxlength="200" placeholder="Например, Telegram: @nick" required>
            <span class="acc-hint">Контакт удаляется, как только заявку закроют</span>
          </label>
          <label class="acc-field">
            <span class="acc-label">Комментарий (по желанию)</span>
            <textarea v-model="comment" class="acc-textarea" name="comment" maxlength="500"></textarea>
          </label>
          <TurnstileWidget ref="captcha" @token="captchaToken = $event" />
          <div v-if="error" class="acc-alert acc-alert-error" role="alert">{{ error }}</div>
          <button class="acc-btn acc-btn-primary" type="submit" :disabled="busy">
            <span v-if="busy" class="acc-spinner"></span>
            Отправить заявку
          </button>
        </form>
        <div class="acc-links">
          <RouterLink class="acc-link" :to="{ name: 'login' }">Вспомнил — войти</RouterLink>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { callFunction } from '@/site/session'
import TurnstileWidget from '@/site/components/TurnstileWidget.vue'

const nick = ref('')
const contact = ref('')
const comment = ref('')
const captchaToken = ref('')
const captcha = ref<InstanceType<typeof TurnstileWidget> | null>(null)
const error = ref('')
const busy = ref(false)
const sent = ref(false)

async function submit() {
  if (busy.value) return
  error.value = ''
  if (!nick.value.trim()) error.value = 'Укажи ник'
  else if (!contact.value.trim()) error.value = 'Укажи, как с тобой связаться — иначе некуда передать временный пароль'
  else if (!captchaToken.value) error.value = 'Пройди проверку «я не робот»'
  if (error.value) return
  busy.value = true
  try {
    const res = await callFunction('recovery-request', { nick: nick.value, contact: contact.value, comment: comment.value, captchaToken: captchaToken.value }, false)
    if (!res.ok) {
      error.value = res.error ?? 'Не удалось отправить заявку'
      captcha.value?.reset()
      return
    }
    sent.value = true
  } finally {
    busy.value = false
  }
}
</script>
