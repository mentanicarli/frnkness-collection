<template>
  <div class="shell shell-narrow social-page">
    <h1 class="social-h1">Избранное</h1>
    <p class="social-meta">{{ count }} {{ plural(count, 'трек', 'трека', 'треков') }}</p>
    <div v-if="ids.length" class="social-actions">
      <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" @click="play(0)">Слушать</button>
      <button class="acc-btn acc-btn-sm" type="button" @click="shuffle">Перемешать</button>
      <button class="acc-btn acc-btn-sm" type="button" data-testid="favorites-flow" @click="flow">Поток по избранному</button>
    </div>
    <p v-if="!favorites.loaded && !ids.length" class="acc-hint">Загрузка…</p>
    <p v-else-if="!ids.length" class="acc-alert acc-alert-info">Пока пусто. Нажимай ♡ у треков — они появятся здесь.</p>
    <TrackList v-else :track-ids="ids" :source="source" label="Избранное" @play="play" />
  </div>
</template>

<script setup lang="ts">
// Моё избранное: список (новые сверху), воспроизведение подряд,
// перемешанно и «Поток» по избранному.
import { computed, onMounted } from 'vue'
import { session } from '@/site/session'
import { favorites, loadFavorites } from '../social/favorites'
import { playList, playListShuffled, startFavoritesFlow } from '../player/engine'
import type { QueueSource } from '../player/queue'
import { plural } from '../social/format'
import TrackList from '../components/TrackList.vue'

const ids = computed(() => favorites.items.map((f) => f.track_id))
const count = computed(() => ids.value.length)
const source = computed<QueueSource>(() => ({ kind: 'favorites', ownerId: session.user?.id ?? '' }))

onMounted(() => void loadFavorites())

const play = (index: number) => playList(source.value, ids.value, index)
const shuffle = () => playListShuffled(source.value, ids.value)
const flow = () => startFavoritesFlow(session.user?.id ?? '', ids.value)
</script>
