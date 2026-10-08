<template>
  <div class="acc-shell">
    <div class="acc-card">
      <RouterLink class="acc-brand" :to="{ name: 'welcome' }"><b>frnk ness</b><small>collection</small></RouterLink>
      <h1 class="acc-title">Забыли пароль?</h1>
      <!-- У меня есть код восстановления: ник + код + новый пароль -->
      <template v-if="mode === 'code'">
        <p class="acc-sub">Введи ник, код восстановления, который тебе показали при регистрации, и новый пароль. Код подходит один раз.</p>
        <form class="acc-form" novalidate @submit.prevent="submitCode">
          <label class="acc-field">
            <span class="acc-label">Ник</span>
            <input v-model="nick" class="acc-input" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="40" required data-testid="code-nick">
          </label>
          <label class="acc-field">
            <span class="acc-label">Код восстановления</span>
            <input v-model="code" class="acc-input" style="font-family: 'JetBrains Mono', monospace; letter-spacing: 0.06em;" name="recovery-code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" placeholder="XXXX-XXXX-XXXX-XXXX" required data-testid="code-input">
          </label>
          <label class="acc-field">
            <span class="acc-label">Новый пароль</span>
            <input v-model="newPassword" class="acc-input" type="password" name="new-password" autocomplete="new-password" required data-testid="code-password">
          </label>
          <label class="acc-field">
            <span class="acc-label">Повтор нового пароля</span>
            <input v-model="newPassword2" class="acc-input" type="password" name="new-password-repeat" autocomplete="new-password" required data-testid="code-password2">
          </label>
          <TurnstileWidget ref="captcha" @token="captchaToken = $event" />
          <div v-if="error" class="acc-alert acc-alert-error" role="alert" data-testid="code-error">{{ error }}</div>
          <button class="acc-btn acc-btn-primary" type="submit" :disabled="busy" data-testid="code-submit">
            <span v-if="busy" class="acc-spinner"></span>
            Сменить пароль
          </button>
        </form>
        <div class="acc-links">
          <button class="acc-link" type="button" data-testid="mode-request" @click="setMode('request')">Кода нет — отправить заявку владельцу</button>
          <RouterLink class="acc-link" :to="{ name: 'login' }">Вспомнил — войти</RouterLink>
        </div>
      </template>
      <template v-else-if="sent">
        <div class="acc-alert acc-alert-ok" role="status" data-testid="recovery-sent">
          Заявка отправлена. Если такой ник есть, владелец сайта свяжется с тобой по указанному контакту и передаст временный пароль.
        </div>
        <div class="acc-links">
          <RouterLink class="acc-link" :to="{ name: 'login' }">Ко входу</RouterLink>
        </div>
      </template>
      <template v-else>
        <p class="acc-sub">Если у тебя есть код восстановления, нажми «У меня есть код» внизу. Иначе пароль восстанавливает владелец сайта лично: он свяжется с тобой и передаст временный пароль. При входе с ним нужно будет придумать новый.</p>
        <form class="acc-form" novalidate @submit.prevent="submit">
          <label class="acc-field">
            <span class="acc-label">Ник</span>
            <input v-model="nick" class="acc-input" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="40" required>
          </label>
          <div class="acc-field">
            <label class="acc-label" for="rec-contact">Как с тобой связаться</label>
            <input id="rec-contact" v-model="contact" class="acc-input" name="contact" maxlength="200" placeholder="Например, Telegram: @nick" aria-describedby="rec-contact-hint" required>
            <span id="rec-contact-hint" class="acc-hint">Контакт удаляется, как только заявку закроют</span>
          </div>
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
          <button class="acc-link" type="button" data-testid="mode-code" @click="setMode('code')">У меня есть код</button>
          <RouterLink class="acc-link" :to="{ name: 'login' }">Вспомнил — войти</RouterLink>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { callFunction, signIn } from '@/site/session'
import { validatePassword } from '../../../supabase/functions/_shared/accounts.ts'
import TurnstileWidget from '@/site/components/TurnstileWidget.vue'

const router = useRouter()
const mode = ref<'request' | 'code'>('request')
const code = ref('')
const newPassword = ref('')
const newPassword2 = ref('')
const nick = ref('')
const contact = ref('')
const comment = ref('')
const captchaToken = ref('')
const captcha = ref<InstanceType<typeof TurnstileWidget> | null>(null)
const error = ref('')
const busy = ref(false)
const sent = ref(false)

function setMode(next: 'request' | 'code') {
  mode.value = next
  error.value = ''
  captchaToken.value = ''
}

/** Вход по коду: сервер меняет пароль, сжигает код и завершает все сеансы; потом входим с новым паролем. */
async function submitCode() {
  if (busy.value) return
  error.value = ''
  if (!nick.value.trim() || !code.value.trim() || !newPassword.value) error.value = 'Введи ник, код и новый пароль'
  else if (validatePassword(newPassword.value, nick.value)) error.value = validatePassword(newPassword.value, nick.value) ?? ''
  else if (newPassword.value !== newPassword2.value) error.value = 'Пароли не совпадают'
  else if (!captchaToken.value) error.value = 'Пройди проверку «я не робот»'
  if (error.value) return
  busy.value = true
  try {
    const res = await callFunction('recovery-request', { mode: 'code', nick: nick.value, code: code.value, password: newPassword.value, captchaToken: captchaToken.value }, false)
    if (!res.ok) {
      error.value = res.error ?? 'Не удалось сменить пароль'
      captcha.value?.reset()
      captchaToken.value = ''
      return
    }
    const failed = await signIn(nick.value, newPassword.value)
    if (failed) {
      // Пароль уже сменён, но войти автоматически не вышло — отправляем ко входу.
      void router.replace({ name: 'login' })
      return
    }
    // Код сгорел: предлагаем создать новый (можно «Позже»).
    void router.replace({ name: 'recovery-code', query: { offer: '1' } })
  } finally {
    busy.value = false
  }
}

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
