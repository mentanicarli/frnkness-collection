<template>
  <section class="settings-section room-play" aria-labelledby="room-play" data-testid="room-play">
    <h2 id="room-play">Включить</h2>
    <label class="sr-only" for="room-play-search">Поиск по каталогу</label>
    <input id="room-play-search" v-model="query" class="acc-input" type="search" placeholder="Найти трек или релиз" autocomplete="off" data-testid="room-play-search">

    <ul v-if="query.trim()" class="pick-list" data-testid="room-play-results">
      <li v-for="t in hits" :key="t.trackId">
        <button class="pick-row" type="button" data-testid="room-play-hit" @click="playTrack(t)">
          <img v-if="t.cover" class="pick-cover" :src="t.cover" alt="" loading="lazy" decoding="async" width="40" height="40">
          <span class="pick-text">
            <span class="pick-title">{{ t.title }}</span>
            <span class="pick-sub">{{ t.releaseTitle }}</span>
          </span>
          <span class="pick-mark" aria-hidden="true">▶ играть</span>
        </button>
      </li>
      <li v-if="!hits.length" class="acc-hint" data-testid="room-play-empty">Ничего не найдено.</li>
    </ul>

    <template v-else>
      <div class="pick-quick" role="group" aria-label="Быстрый выбор">
        <button class="pick-chip" type="button" :disabled="busy" data-testid="room-play-flow" @click="playFlow">Поток</button>
        <button class="pick-chip" type="button" :disabled="busy" data-testid="room-play-favorites" @click="playFavorites">Избранное</button>
      </div>
      <template v-if="myPlaylists.items.length">
        <p class="pick-kicker">Мои плейлисты</p>
        <div class="pick-quick" role="group" aria-label="Мои плейлисты">
          <button v-for="p in myPlaylists.items" :key="p.id" class="pick-chip" type="button" :disabled="busy" data-testid="room-play-playlist" @click="playPlaylist(p)">{{ p.title }}</button>
        </div>
      </template>
      <p class="pick-kicker">Релизы</p>
      <div class="pick-quick" role="group" aria-label="Релизы">
        <button v-for="r in releaseList" :key="r.id" class="pick-chip" type="button" :disabled="busy" data-testid="room-play-release" @click="playRelease(r.id)">{{ r.title }}</button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
// Блок «Включить» на странице комнаты (только хозяину): хозяин запускает музыку,
// не уходя со страницы. Выбор сразу играет у всех — комната повторяет плеер хозяина.
import { computed, onMounted, ref } from 'vue'
import { releases } from '@/config'
import { session } from '../session'
import { api, errorText, type PlaylistSummary } from '../social/api'
import { favorites, loadFavorites } from '../social/favorites'
import { loadMyPlaylists, myPlaylists } from '../social/playlists'
import { showNotice } from '../social/notice'
import { searchTracks } from '../social/trackSearch'
import type { TrackInfo } from '../social/tracks'
import { playList, playTrackByRef, startFlowMode } from '../player/engine'

const query = ref('')
const busy = ref(false)

onMounted(() => {
  void loadMyPlaylists()
  void loadFavorites()
})

const releaseList = computed(() => Object.entries(releases).map(([id, r]) => ({ id, title: r.title })))
const hits = computed(() => searchTracks(query.value, 30).filter((t) => t.available))

function playTrack(t: TrackInfo) {
  if (t.releaseId === null) return
  playTrackByRef(t.releaseId, t.trackIndex)
}

const playFlow = () => startFlowMode()

function playRelease(id: string) {
  playList({ kind: 'release', releaseId: id }, releases[id].tracks.map((t) => t.id), 0)
}

function playFavorites() {
  const ids = favorites.items.map((f) => f.track_id)
  if (!ids.length) return showNotice('В избранном пока пусто', true)
  playList({ kind: 'favorites', ownerId: session.user?.id ?? '' }, ids, 0)
}

async function playPlaylist(p: PlaylistSummary) {
  busy.value = true
  try {
    const full = await api.playlistGet(p.id)
    if (!full.tracks.length) return showNotice('В плейлисте пока нет треков', true)
    playList({ kind: 'playlist', playlistId: p.id, title: p.title }, full.tracks, 0)
  } catch (e) {
    showNotice(errorText(e), true)
  } finally {
    busy.value = false
  }
}
</script>
