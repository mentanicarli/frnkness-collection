<template>
  <div class="shell social-page">
    <h1 class="social-h1">Мои плейлисты</h1>
    <p class="social-meta">{{ myPlaylists.items.length }} из {{ PLAYLISTS_MAX }}</p>
    <form class="social-create" @submit.prevent="create">
      <input ref="titleInput" v-model="title" class="acc-input" :maxlength="PLAYLIST_TITLE_MAX" placeholder="Название нового плейлиста" aria-label="Название нового плейлиста" autocomplete="off">
      <button class="acc-btn acc-btn-primary acc-btn-sm" style="height: auto;" type="submit" :disabled="busy || !title.trim() || myPlaylists.items.length >= PLAYLISTS_MAX">Создать</button>
    </form>
    <p v-if="!myPlaylists.loaded" class="acc-hint">Загрузка…</p>
    <EmptyHint v-else-if="!myPlaylists.items.length" title="Плейлистов пока нет" text="Плейлист — твоя подборка треков. Назови его выше и создай, а потом добавляй треки кнопкой «В плейлист» на странице трека.">
      <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" data-testid="hint-create-playlist" @click="titleInput?.focus()">Создать плейлист</button>
      <RouterLink class="acc-btn acc-btn-sm" :to="{ name: 'home' }">Выбрать треки</RouterLink>
    </EmptyHint>
    <PlaylistGrid v-else :playlists="myPlaylists.items" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { PLAYLISTS_MAX, createPlaylist, loadMyPlaylists, myPlaylists } from '../social/playlists'
import EmptyHint from '../components/EmptyHint.vue'
import PlaylistGrid from '../components/PlaylistGrid.vue'
import { PLAYLIST_TITLE_MAX } from '../../../supabase/functions/_shared/accounts.ts'

const router = useRouter()
const title = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)

onMounted(() => void loadMyPlaylists())

async function create() {
  busy.value = true
  try {
    const created = await createPlaylist(title.value)
    if (created) {
      title.value = ''
      void router.push({ name: 'playlist', params: { id: created.id } })
    }
  } finally {
    busy.value = false
  }
}
</script>
