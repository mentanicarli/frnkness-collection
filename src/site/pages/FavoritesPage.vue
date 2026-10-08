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
    <EmptyHint v-else-if="!ids.length" title="Здесь будут твои любимые треки" text="Нажимай ♡ у трека — он сохранится здесь, а из избранного можно включить свой Поток. Для начала включи общий Поток и отмечай то, что нравится.">
      <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" data-testid="hint-flow" @click="startFlowMode()">Слушать Поток</button>
      <RouterLink class="acc-btn acc-btn-sm" :to="{ name: 'home' }">Выбрать треки</RouterLink>
    </EmptyHint>
    <TrackList v-else :track-ids="ids" :source="source" label="Избранное" @play="play" />
  </div>
</template>

<script setup lang="ts">
// Моё избранное: список (новые сверху), воспроизведение подряд,
// перемешанно и «Поток» по избранному.
import { computed, onMounted } from 'vue'
import { session } from '@/site/session'
import { favorites, loadFavorites } from '../social/favorites'
import { playList, playListShuffled, startFavoritesFlow, startFlowMode } from '../player/engine'
import type { QueueSource } from '../player/queue'
import { plural } from '../social/format'
import { RouterLink } from 'vue-router'
import EmptyHint from '../components/EmptyHint.vue'
import TrackList from '../components/TrackList.vue'

const ids = computed(() => favorites.items.map((f) => f.track_id))
const count = computed(() => ids.value.length)
const source = computed<QueueSource>(() => ({ kind: 'favorites', ownerId: session.user?.id ?? '' }))

onMounted(() => void loadFavorites())

const play = (index: number) => playList(source.value, ids.value, index)
const shuffle = () => playListShuffled(source.value, ids.value)
const flow = () => startFavoritesFlow(session.user?.id ?? '', ids.value)
</script>
