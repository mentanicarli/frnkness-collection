<template>
  <ModalFrame :open="Boolean(trackMenu.trackId)" sheet :label="`Действия: ${info.title}`" testid="track-sheet" @close="closeTrackMenu">
    <div ref="panel">
        <div class="sheet-head">
          <span class="tl-cover"><img v-if="info.cover" :src="info.cover" :srcset="coverSrcset(info.cover)" sizes="48px" alt="" decoding="async"></span>
          <span class="tl-text">
            <span class="tl-title">{{ info.title }}</span>
            <span class="tl-sub">{{ info.releaseTitle }}</span>
          </span>
        </div>
        <div class="sheet-actions">
          <template v-if="info.available">
            <button class="sheet-action" type="button" data-testid="sheet-favorite" @click="toggleFav">
              <span class="sheet-ico" :class="{ on: favorite }" aria-hidden="true">{{ favorite ? '♥' : '♡' }}</span>
              {{ favorite ? 'Убрать из избранного' : 'В избранное' }}
            </button>
            <button class="sheet-action" type="button" data-testid="sheet-playlist" @click="toPlaylist">
              <span class="sheet-ico" aria-hidden="true">＋</span>В плейлист
            </button>
            <button class="sheet-action" type="button" data-testid="sheet-lyrics" @click="toLyrics">
              <span class="sheet-ico" aria-hidden="true">≡</span>Текст
            </button>
            <button class="sheet-action" type="button" data-testid="sheet-share" @click="share">
              <span class="sheet-ico" aria-hidden="true">↗</span>Поделиться
            </button>
            <button v-if="nextAvailable" class="sheet-action" type="button" data-testid="sheet-play-next" @click="playAfterCurrent">
              <span class="sheet-ico" aria-hidden="true">⏭</span>Играть следующим
            </button>
          </template>
          <button
            v-for="a in trackMenu.extras"
            :key="a.id"
            class="sheet-action"
            :class="{ danger: a.danger }"
            type="button"
            :disabled="a.disabled"
            :data-testid="`sheet-${a.id}`"
            @click="runExtra(a)"
          >{{ a.label }}</button>
        </div>
        <button class="sheet-close" type="button" data-testid="sheet-close" @click="closeTrackMenu">Закрыть</button>
    </div>
  </ModalFrame>
</template>

<script setup lang="ts">
// Нижняя панель действий трека («⋯» в любом списке треков).
import { computed, nextTick, ref, watch } from 'vue'
import ModalFrame from './ModalFrame.vue'
import { coverSrcset } from '@/utils/cover'
import { releases } from '@/config'
import { trackShareUrl } from '@/utils/share'
import { canPlayNext, playNext } from '../player/engine'
import { player } from '../player/state'
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
// Очередь «играет сейчас» — от неё зависит, есть ли «Играть следующим».
const nextAvailable = computed(() => player.visible && canPlayNext())

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

function playAfterCurrent() {
  const id = trackMenu.trackId
  closeTrackMenu()
  if (id) showNotice(playNext(id) ? 'Сыграет следующим' : 'Не получилось добавить в очередь', false)
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
