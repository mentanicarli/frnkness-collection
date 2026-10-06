<template>
  <div class="acc-field">
    <div ref="box" class="turnstile-box"></div>
    <p v-if="!siteKey" class="acc-alert acc-alert-error">Капча не настроена (нет ключа Turnstile) — регистрация пока недоступна.</p>
    <p v-else-if="failed" class="acc-alert acc-alert-error">Не удалось загрузить проверку «я не робот». Обнови страницу или отключи блокировщик для этого сайта.</p>
  </div>
</template>

<script setup lang="ts">
// Cloudflare Turnstile: скрипт грузится один раз, виджет — явным вызовом.
// Токен одноразовый: после отправки формы виджет сбрасывается (reset()).
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { TURNSTILE_SITE_KEY } from '@/supabaseConfig'

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string
  reset(id?: string): void
  remove(id?: string): void
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SCRIPT_URL
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        scriptPromise = null
        reject(new Error('turnstile'))
      }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

const emit = defineEmits<{ token: [value: string] }>()
const siteKey = TURNSTILE_SITE_KEY
const box = ref<HTMLElement | null>(null)
const failed = ref(false)
let widgetId: string | undefined

onMounted(async () => {
  if (!siteKey) return
  try {
    await loadScript()
    if (!box.value || !window.turnstile) throw new Error('turnstile')
    widgetId = window.turnstile.render(box.value, {
      sitekey: siteKey,
      theme: 'dark',
      language: 'ru',
      callback: (token: string) => emit('token', token),
      'expired-callback': () => emit('token', ''),
      'error-callback': () => emit('token', '')
    })
  } catch {
    failed.value = true
  }
})

onBeforeUnmount(() => {
  if (widgetId !== undefined) window.turnstile?.remove(widgetId)
})

defineExpose({
  reset() {
    emit('token', '')
    if (widgetId !== undefined) window.turnstile?.reset(widgetId)
  }
})
</script>
