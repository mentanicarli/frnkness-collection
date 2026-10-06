<template>
  <div v-if="addDialog.trackId" class="cropper-backdrop" @click.self="closeAddToPlaylist">
    <div class="cropper-box" role="dialog" aria-modal="true" aria-labelledby="add-pl-title" data-testid="add-to-playlist" @keydown.esc="closeAddToPlaylist">
      <p id="add-pl-title" class="acc-title" style="font-size: 1.125rem;">В плейлист</p>
      <p class="acc-sub" style="margin-bottom: 0.875rem;">{{ info.title }}<template v-if="info.releaseTitle"> · {{ info.releaseTitle }}</template></p>

      <p v-if="!myPlaylists.loaded" class="acc-hint">Загрузка…</p>
      <ul v-else-if="myPlaylists.items.length" class="pl-pick-list">
        <li v-for="p in myPlaylists.items" :key="p.id">
          <button class="pl-pick" type="button" :disabled="busy" @click="add(p)">
            <span class="pl-pick-title">{{ p.title }}</span>
            <span class="acc-hint">{{ p.track_count }} / {{ PLAYLIST_TRACKS_MAX }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="acc-hint" style="margin-bottom: 0.75rem;">Плейлистов пока нет — создай первый.</p>

      <form class="acc-form" style="margin-top: 1rem;" @submit.prevent="create">
        <label class="acc-label" for="add-pl-new">Новый плейлист</label>
        <div class="flex gap-2">
          <input id="add-pl-new" ref="input" v-model="title" class="acc-input" :maxlength="PLAYLIST_TITLE_MAX" placeholder="Название" autocomplete="off">
          <button class="acc-btn acc-btn-primary acc-btn-sm" style="height: auto;" type="submit" :disabled="busy || !title.trim() || myPlaylists.items.length >= PLAYLISTS_MAX">Создать</button>
        </div>
        <p v-if="myPlaylists.items.length >= PLAYLISTS_MAX" class="acc-hint">Не больше {{ PLAYLISTS_MAX }} плейлистов.</p>
      </form>

      <div class="acc-actions" style="justify-content: flex-end; margin-top: 1rem;">
        <button class="acc-btn acc-btn-sm" type="button" @click="closeAddToPlaylist">Закрыть</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Выбор плейлиста для трека или создание нового сразу с ним.
import { computed, nextTick, ref, watch } from 'vue'
import { addDialog, closeAddToPlaylist } from '../social/addDialog'
import { PLAYLISTS_MAX, PLAYLIST_TRACKS_MAX, addToPlaylist, createPlaylist, loadMyPlaylists, myPlaylists } from '../social/playlists'
import type { PlaylistSummary } from '../social/api'
import { trackInfo } from '../social/tracks'
import { PLAYLIST_TITLE_MAX } from '../../../supabase/functions/_shared/accounts.ts'

const title = ref('')
const busy = ref(false)
const input = ref<HTMLInputElement | null>(null)
const info = computed(() => trackInfo(addDialog.trackId ?? ''))

watch(
  () => addDialog.trackId,
  (id) => {
    title.value = ''
    if (!id) return
    void loadMyPlaylists()
    void nextTick(() => input.value?.focus())
  }
)

async function add(p: PlaylistSummary) {
  const trackId = addDialog.trackId
  if (!trackId) return
  busy.value = true
  try {
    if (await addToPlaylist(p, trackId)) closeAddToPlaylist()
  } finally {
    busy.value = false
  }
}

async function create() {
  const trackId = addDialog.trackId
  if (!trackId || !title.value.trim()) return
  busy.value = true
  try {
    if (await createPlaylist(title.value, trackId)) closeAddToPlaylist()
  } finally {
    busy.value = false
  }
}
</script>
