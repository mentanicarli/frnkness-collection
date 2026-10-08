<template>
  <ul class="pl-grid">
    <li v-for="p in playlists" :key="p.id">
      <RouterLink class="pl-card" :to="{ name: 'playlist', params: { id: p.id } }" data-testid="playlist-card">
        <PlaylistCover :first-tracks="p.first_tracks" :url="urls[p.id]" />
        <span class="pl-card-title">{{ p.title }}</span>
        <span class="pl-card-meta">{{ p.track_count }} {{ plural(p.track_count, 'трек', 'трека', 'треков') }}<template v-if="p.is_public"> · публичный</template></span>
      </RouterLink>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { PlaylistSummary } from '../social/api'
import { coverUrls } from '../social/playlists'
import { plural } from '../social/format'
import PlaylistCover from './PlaylistCover.vue'

const props = defineProps<{ playlists: readonly PlaylistSummary[] }>()
const urls = ref<Record<string, string>>({})

watch(
  () => props.playlists,
  async (list) => {
    const got = await coverUrls(list)
    if (list === props.playlists) urls.value = got
  },
  { immediate: true }
)
</script>
