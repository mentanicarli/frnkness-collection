<template>
  <div class="welcome" data-testid="welcome">
    <div>
      <p class="acc-brand"><b>frnk ness</b><small>collection</small></p>
      <h1 class="welcome-title">Pupsiks<br><span>Saga</span></h1>
      <p class="welcome-text">Коллекция релизов frnk ness для своих. Войди или зарегистрируйся, чтобы слушать музыку, читать тексты и разборы.</p>
      <div v-if="session.expired" class="acc-alert acc-alert-info" style="margin-bottom: 1rem;" role="status">Сессия закончилась — войди снова.</div>
      <div class="acc-actions">
        <RouterLink class="acc-btn acc-btn-primary" :to="{ name: 'login', query: nextQuery }">Войти</RouterLink>
        <RouterLink class="acc-btn" :to="{ name: 'register', query: nextQuery }">Зарегистрироваться</RouterLink>
      </div>
      <div class="acc-links" style="justify-content: flex-start; gap: 1.25rem;">
        <RouterLink class="acc-link" :to="{ name: 'forgot' }">Забыли пароль?</RouterLink>
        <RouterLink class="acc-link" :to="{ name: 'privacy' }">Какие данные мы храним</RouterLink>
      </div>
    </div>
    <div v-if="cover" class="welcome-cover">
      <img :src="cover.src" :alt="cover.title" decoding="async" fetchpriority="high">
    </div>
  </div>
</template>

<script setup lang="ts">
// Заставка для гостя: логотип, обложка последнего релиза, вход и регистрация.
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { PROMO_RELEASE_ID, releases } from '@/config'
import { session } from '@/site/session'
import { sanitizeNext } from '@/site/auth/redirect'

const route = useRoute()
const nextQuery = computed(() => {
  const next = sanitizeNext(route.query.next)
  return next ? { next } : {}
})

// «Последний релиз» — тот, что в промо на главной (его выбирают в админке).
const latest = releases[PROMO_RELEASE_ID] ?? Object.values(releases).find((r) => !r.upcoming) ?? null
const cover = latest ? { src: latest.cover, title: latest.title } : null
</script>
