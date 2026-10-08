<template>
  <ModalFrame :open="Boolean(trackMenu.trackId)" sheet box-class="menu-sheet" :label="`Действия: ${info.title}`" testid="track-sheet" @close="closeTrackMenu">
    <div ref="panel">
      <div class="sheet-head">
        <span class="tl-cover"><img v-if="info.cover" :src="info.cover" :srcset="coverSrcset(info.cover)" sizes="48px" alt="" decoding="async"></span>
        <span class="tl-text">
          <span class="tl-title">{{ info.title }}</span>
          <span class="tl-sub">{{ info.releaseTitle }}</span>
        </span>
      </div>
      <div class="menu-group" role="group">
        <template v-if="info.available">
          <button class="menu-item" type="button" data-testid="sheet-favorite" @click="toggleFav">
            <MenuIcon name="heart" :filled="favorite" :class="{ 'fav-on': favorite }" />{{ favorite ? 'Убрать из избранного' : 'В избранное' }}
          </button>
          <button class="menu-item" type="button" data-testid="sheet-lyrics" @click="toLyrics"><MenuIcon name="text" />Текст</button>
          <button class="menu-item" type="button" data-testid="sheet-playlist" @click="toPlaylist"><MenuIcon name="playlist" />В плейлист</button>
          <button class="menu-item" type="button" data-testid="sheet-share" @click="share"><MenuIcon name="share" />Поделиться</button>
        </template>
        <button
          v-for="a in trackMenu.extras"
          :key="a.id"
          class="menu-item"
          :class="{ 'menu-item-danger': a.danger }"
          type="button"
          :disabled="a.disabled"
          :data-testid="`sheet-${a.id}`"
          @click="runExtra(a)"
        >{{ a.label }}</button>
      </div>
    </div>
  </ModalFrame>
</template>

<script setup lang="ts">
// Нижняя панель действий трека («⋯» в любом списке треков).
import { computed, nextTick, ref, watch } from 'vue'
import ModalFrame from './ModalFrame.vue'
import MenuIcon from './MenuIcon.vue'
import { coverSrcset } from '@/utils/cover'
import { releases } from '@/config'
import { trackShareUrl } from '@/utils/share'
import { goTrack } from '../router'
import { canNativeShare, copyToClipboard, nativeShare } from '../share'
import { openAddToPlaylist } from '../social/addDialog'
import { isFavorite, toggleFavorite } from '../social/favorites'
import { showNotice } from '../social/notice'
import { trackInfo } from '../social/tracks'
import { closeTrackMenu, trackMenu, type MenuAction } from '../social/trackMenu'

const panel = ref<HTMLElement | null>(null)
const info = computed(() => trackInfo(trackMenu.trackId ?? ''))
const favorite = computed(() => isFavorite(trackMenu.trackId))

function toggleFav() {
  const id = trackMenu.trackId
  closeTrackMenu()
  if (id) void toggleFavorite(id)
}

function toPlaylist() {
  const id = trackMenu.trackId
  closeTrackMenu()
  if (id) openAddToPlaylist(id)
}

function toLyrics() {
  const { releaseId, trackIndex } = info.value
  closeTrackMenu()
  if (releaseId) goTrack(releaseId, trackIndex)
}

async function share() {
  const { releaseId, trackIndex, title } = info.value
  const track = releaseId ? releases[releaseId]?.tracks[trackIndex] : null
  closeTrackMenu()
  if (!releaseId || !track) return
  const url = trackShareUrl(releaseId, track)
  if (canNativeShare()) await nativeShare(title, url)
  else showNotice((await copyToClipboard(url)) ? 'Ссылка скопирована' : 'Не удалось скопировать ссылку', false)
}

function runExtra(a: MenuAction) {
  closeTrackMenu()
  a.run()
}

watch(
  () => trackMenu.trackId,
  (id) => {
    if (id) void nextTick(() => panel.value?.querySelector<HTMLElement>('button')?.focus())
  }
)
</script>
