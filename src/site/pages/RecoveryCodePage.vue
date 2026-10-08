<template>
  <div class="acc-shell">
    <div class="acc-card" data-testid="recovery-page">
      <RouterLink class="acc-brand" :to="{ name: 'home' }"><b>frnk ness</b><small>collection</small></RouterLink>

      <!-- Предложение после входа по коду: код сгорел, можно создать новый -->
      <template v-if="mode === 'offer' && !code">
        <h1 class="acc-title">Пароль изменён</h1>
        <p class="acc-sub">Код восстановления сгорел. Создай новый, чтобы в следующий раз снова обойтись без владельца сайта.</p>
        <form class="acc-form" novalidate @submit.prevent="create">
          <label class="acc-field">
            <span class="acc-label">Пароль</span>
            <input v-model="password" class="acc-input" type="password" name="current-password" autocomplete="current-password" data-testid="recovery-offer-password">
          </label>
          <div v-if="error" class="acc-alert acc-alert-error" role="alert">{{ error }}</div>
          <div class="acc-actions">
            <button class="acc-btn acc-btn-primary" type="submit" :disabled="busy" data-testid="recovery-offer-create">Создать новый код</button>
            <button class="acc-btn" type="button" data-testid="recovery-later" @click="later">Позже</button>
          </div>
        </form>
      </template>

      <!-- Сам код -->
      <template v-else>
        <h1 class="acc-title">Код восстановления</h1>
        <p v-if="loading" class="acc-hint">Загрузка…</p>
        <RecoveryCodeBox v-else-if="code" :code="code" :busy="busy" :error="error" @saved="saved" />
        <div v-else class="acc-alert acc-alert-error" role="alert">
          {{ error || 'Не удалось получить код' }}
          <button class="acc-link" type="button" style="margin-left: 0.5rem;" @click="mint">Повторить</button>
        </div>
        <!-- Если сервер не отвечает, из экрана можно выйти из аккаунта (код появится при следующем входе). -->
        <div class="acc-links">
          <button class="acc-link" type="button" data-testid="recovery-logout" @click="logout">Выйти из аккаунта</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Экран с кодом восстановления. Два случая:
//  — после регистрации (и пока код не сохранён) он блокирующий: уйти можно только
//    после «Я сохранил», а оно доступно после копирования;
//  — после входа по коду (?offer=1) — необязательное предложение создать новый
//    код, с кнопкой «Позже».
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { clearRecoveryHandoff, recoveryHandoff } from '@/site/auth/recovery'
import { confirmRecoveryCode, createRecoveryCode, session, signOut } from '@/site/session'
import { goAfterLogin } from '@/site/router'
import RecoveryCodeBox from '../components/RecoveryCodeBox.vue'

const route = useRoute()
const router = useRouter()
const mode = computed(() => (session.recoveryPending ? 'gate' : 'offer'))
const code = ref<string | null>(null)
const password = ref('')
const error = ref('')
const busy = ref(false)
const loading = ref(false)

/** Код после регистрации лежит в памяти; если страницу обновили — выдаём новый (без пароля, пока прежний не подтверждён). */
async function mint() {
  loading.value = true
  error.value = ''
  const res = await createRecoveryCode()
  loading.value = false
  if (res.error) error.value = res.error
  else code.value = res.code ?? null
}

onMounted(() => {
  if (!session.recoveryPending) return
  if (recoveryHandoff.code) code.value = recoveryHandoff.code
  else void mint()
})

async function create() {
  if (busy.value) return
  if (!password.value) {
    error.value = 'Введи пароль'
    return
  }
  busy.value = true
  error.value = ''
  const res = await createRecoveryCode(password.value)
  busy.value = false
  if (res.error) error.value = res.error
  else code.value = res.code ?? null
}

async function saved() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  const message = await confirmRecoveryCode()
  busy.value = false
  if (message) {
    error.value = message
    return
  }
  clearRecoveryHandoff()
  goAfterLogin(route.query.next)
}

async function logout() {
  clearRecoveryHandoff()
  await signOut()
  void router.replace({ name: 'welcome' })
}

function later() {
  goAfterLogin(route.query.next)
}
</script>
