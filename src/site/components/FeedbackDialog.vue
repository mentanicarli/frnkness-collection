<template>
  <ModalFrame :open="feedbackUi.open" label="Сообщить о проблеме" testid="feedback-dialog" @close="close">
    <div>
      <template v-if="sent">
        <p id="feedback-title" class="acc-title" style="font-size: 1.125rem;">Спасибо, получили</p>
        <p class="acc-sub" data-testid="feedback-thanks">Мы прочитаем и починим, что сможем.</p>
        <div class="acc-actions" style="justify-content: flex-end; margin-top: 0.75rem;">
          <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" data-testid="feedback-close" @click="close">Закрыть</button>
        </div>
      </template>
      <template v-else>
        <p id="feedback-title" class="acc-title" style="font-size: 1.125rem;">Сообщить о проблеме</p>
        <p class="acc-sub" style="margin-bottom: 0.875rem;">Опиши, что случилось. Страницу, браузер и версию сайта мы приложим сами.</p>
        <form class="acc-form" @submit.prevent="send">
          <label class="acc-label" for="feedback-text">Что не так</label>
          <textarea id="feedback-text" ref="input" v-model="text" class="acc-input" rows="5" :maxlength="FEEDBACK_MAX" data-testid="feedback-text"></textarea>
          <p class="acc-hint" data-testid="feedback-counter">{{ text.length }} / {{ FEEDBACK_MAX }}. Не пиши пароли и личные данные.</p>
          <p v-if="error" class="acc-alert acc-alert-error" role="alert" data-testid="feedback-error">{{ error }}</p>
          <div class="acc-actions" style="justify-content: flex-end; margin-top: 0.5rem;">
            <button class="acc-btn acc-btn-sm" type="button" @click="close">Отмена</button>
            <button class="acc-btn acc-btn-primary acc-btn-sm" type="submit" :disabled="busy || !text.trim()" data-testid="feedback-submit">Отправить</button>
          </div>
        </form>
      </template>
    </div>
  </ModalFrame>
</template>

<script setup lang="ts">
// Окно «Сообщить о проблеме» из меню профиля: текст до 1000 символов.
// Лимиты (5 в сутки) и вычистку личных данных держит база.
import { nextTick, ref, watch } from 'vue'
import ModalFrame from './ModalFrame.vue'
import { api, errorText } from '../social/api'
import { FEEDBACK_MAX, closeFeedback, feedbackUi } from '../feedback/store'

const text = ref('')
const busy = ref(false)
const error = ref('')
const sent = ref(false)
const input = ref<HTMLTextAreaElement | null>(null)

const close = closeFeedback

watch(
  () => feedbackUi.open,
  (open) => {
    if (!open) return
    text.value = ''
    error.value = ''
    sent.value = false
    void nextTick(() => input.value?.focus())
  }
)

async function send() {
  const ctx = feedbackUi.context
  if (busy.value || !text.value.trim() || !ctx) return
  busy.value = true
  error.value = ''
  try {
    await api.submitFeedback(text.value, ctx.page, ctx.browser, ctx.build)
    sent.value = true
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
</script>
