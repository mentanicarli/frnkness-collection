<template>
  <div class="shell shell-narrow social-page feed-page" data-testid="feed-page">
    <p class="social-kicker">Друзья</p>
    <h1 class="social-h1">Лента</h1>
    <p class="social-meta">Что слушают и делают друзья — за последние 7 дней.</p>

    <p v-if="state.status === 'idle' || state.status === 'loading'" class="acc-hint" data-testid="feed-loading">Загрузка…</p>
    <div v-else-if="state.status === 'error'" class="acc-alert acc-alert-error" role="alert" data-testid="feed-error">
      Не удалось загрузить ленту.
      <button class="acc-link" type="button" style="margin-left: 0.5rem;" @click="reload">Повторить</button>
    </div>
    <p v-else-if="!state.events.length && !state.hasMore" class="acc-alert acc-alert-info" data-testid="feed-empty">
      Пока тихо. Здесь появятся прослушивания, избранное, новые плейлисты, топ-4 и комнаты твоих друзей.
      <RouterLink :to="{ name: 'friends' }">Найти друзей</RouterLink>
    </p>

    <ul v-if="state.events.length" class="feed-list" aria-label="События друзей">
      <li v-for="e in state.events" :key="e.key" class="feed-item" :data-kind="e.kind" data-testid="feed-item">
        <RouterLink class="feed-avatar" :to="{ name: 'user', params: { nick: e.user.nick } }" :aria-label="`Профиль ${e.user.nick}`">
          <UserAvatar :avatar="e.user.avatar" :nick="e.user.nick" :user-id="e.user.id" :size="2.5" :cover-of="coverOf" />
        </RouterLink>
        <div class="feed-body">
          <p class="feed-text">
            <RouterLink class="feed-nick" :to="{ name: 'user', params: { nick: e.user.nick } }" data-testid="feed-nick">{{ e.user.nick }}</RouterLink>
            <template v-if="e.kind === 'listen'">
              слушал(а) <button class="feed-track" type="button" data-testid="feed-track" @click="play(e.trackId)">{{ info(e.trackId).title }}</button>
              <template v-if="e.more > 0"> <span class="feed-more" data-testid="feed-more">и ещё {{ e.more }}</span></template>
            </template>
            <template v-else-if="e.kind === 'favorite'">
              добавил(а) в избранное <button class="feed-track" type="button" data-testid="feed-track" @click="play(e.trackId)">{{ info(e.trackId).title }}</button>
            </template>
            <template v-else-if="e.kind === 'playlist'">
              создал(а) публичный плейлист <RouterLink class="feed-track" :to="{ name: 'playlist', params: { id: e.playlist.id } }">{{ e.playlist.title }}</RouterLink>
            </template>
            <template v-else-if="e.kind === 'top4'">обновил(а) топ-4</template>
            <template v-else-if="e.room">в комнате «{{ e.room.title }}»</template>
            <template v-else>слушает в комнате</template>
            <span class="feed-ago"> — {{ formatAgo(e.at, nowMs) }}</span>
          </p>
          <ul v-if="e.kind === 'top4'" class="feed-covers" aria-label="Топ-4">
            <li v-for="id in e.trackIds" :key="id"><img v-if="info(id).cover" :src="info(id).cover!" :alt="info(id).title" :title="info(id).title" width="40" height="40" loading="lazy" decoding="async"></li>
          </ul>
        </div>
        <RouterLink v-if="e.kind === 'room' && e.canJoin && e.room" class="acc-btn acc-btn-primary acc-btn-sm" :to="{ name: 'room', params: { id: e.room.id } }" data-testid="feed-join">Зайти</RouterLink>
      </li>
    </ul>

    <div v-if="state.hasMore && state.status === 'ready'" ref="sentinel" class="feed-more-wrap">
      <button class="acc-btn acc-btn-sm" type="button" :disabled="state.loadingMore" data-testid="feed-more-btn" @click="feed.loadMore()">
        {{ state.loadingMore ? 'Загрузка…' : 'Показать ещё' }}
      </button>
      <p v-if="state.moreFailed" class="acc-hint" role="status" data-testid="feed-more-error">Не получилось загрузить — попробуй ещё раз.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
// Лента «Что слушают друзья»: события друзей за 7 дней. Данные — только из
// RPC friends_feed (там проверка дружбы). Все тексты — интерполяцией, то есть
// с экранированием. Обновляется не чаще раза в минуту; «Показать ещё»
// подгружается по прокрутке и по кнопке.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { releases } from '@/config'
import UserAvatar from '../components/UserAvatar.vue'
import { playTrackByRef } from '../player/engine'
import { FEED_MIN_POLL_MS, formatAgo } from '../social/feed'
import { feed } from '../social/feedStore'
import { trackInfo } from '../social/tracks'

const state = feed.state
const nowMs = ref(Date.now())
const sentinel = ref<HTMLElement | null>(null)
const coverOf = (id: string) => releases[id]?.cover ?? null
const info = (trackId: string) => trackInfo(trackId)

function play(trackId: string) {
  const t = trackInfo(trackId)
  if (t.releaseId) playTrackByRef(t.releaseId, t.trackIndex, 'fade')
}

const reload = () => void feed.refresh(true)

let tick: ReturnType<typeof setInterval> | null = null
let observer: IntersectionObserver | null = null

function poll() {
  nowMs.value = Date.now()
  if (document.visibilityState === 'visible') void feed.refresh()
}

function observe() {
  observer?.disconnect()
  if (!sentinel.value || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) void feed.loadMore()
  }, { rootMargin: '400px 0px' })
  observer.observe(sentinel.value)
}

onMounted(() => {
  void feed.refresh()
  // Раз в минуту (feed.refresh сам не пускает чаще) и когда вкладка снова на экране.
  tick = setInterval(poll, FEED_MIN_POLL_MS)
  document.addEventListener('visibilitychange', poll)
})

// Контрольная точка «Показать ещё» появляется и исчезает вместе с hasMore.
watch(
  () => [state.hasMore, state.status, state.events.length] as const,
  () => void nextTick(observe),
  { immediate: true, flush: 'post' }
)

onBeforeUnmount(() => {
  if (tick) clearInterval(tick)
  document.removeEventListener('visibilitychange', poll)
  observer?.disconnect()
})
</script>
