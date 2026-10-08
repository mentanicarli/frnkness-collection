<template>
  <div class="shell shell-narrow social-page">
    <p v-if="state === 'loading'" class="acc-hint">Загрузка…</p>
    <p v-else-if="state === 'missing'" class="acc-alert acc-alert-info">Плейлист не найден или скрыт владельцем.</p>
    <template v-else-if="pl">
      <div class="pl-head">
        <PlaylistCover class="pl-head-cover" :first-tracks="pl.tracks" :url="coverUrl" />
        <div class="min-w-0">
          <p class="social-kicker">Плейлист<template v-if="pl.is_public"> · публичный</template></p>
          <h1 class="social-h1" data-testid="playlist-title">{{ pl.title }}</h1>
          <p v-if="pl.description" class="profile-bio">{{ pl.description }}</p>
          <p class="social-meta">
            <RouterLink v-if="pl.owner" class="acc-link" :to="{ name: 'user', params: { nick: pl.owner.nick } }">{{ pl.owner.nick }}</RouterLink><UserTag :user-id="pl.owner.id" />
            · {{ pl.tracks.length }} {{ plural(pl.tracks.length, 'трек', 'трека', 'треков') }}
          </p>
          <div v-if="pl.tracks.length" class="social-actions">
            <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" data-testid="playlist-play" @click="play(0)">Слушать</button>
            <button class="acc-btn acc-btn-sm" type="button" @click="shuffle">Перемешать</button>
          </div>
        </div>
      </div>

      <p v-if="!pl.tracks.length" class="acc-alert acc-alert-info">В плейлисте пока нет треков. Добавляй их кнопкой «В плейлист» у любого трека.</p>
      <TrackList v-else :track-ids="pl.tracks" :source="source" :editable="isOwner" :busy="busy" label="Треки плейлиста" @play="play" @move="move" @remove="remove" />

      <template v-if="isOwner">
        <section class="settings-section" aria-labelledby="pl-s-edit" style="margin-top: 2rem;">
          <h2 id="pl-s-edit">Настройки плейлиста</h2>
          <form class="acc-form" @submit.prevent="saveInfo">
            <div class="acc-field">
              <label class="acc-label" for="pl-title">Название</label>
              <input id="pl-title" v-model="form.title" class="acc-input" :maxlength="PLAYLIST_TITLE_MAX" autocomplete="off">
            </div>
            <div class="acc-field">
              <label class="acc-label" for="pl-descr">Описание</label>
              <textarea id="pl-descr" v-model="form.description" class="acc-textarea" :maxlength="PLAYLIST_DESCRIPTION_MAX"></textarea>
            </div>
            <label class="acc-check"><input v-model="form.isPublic" type="checkbox" data-testid="playlist-public"> Публичный — виден всем, кто вошёл на сайт (иначе только друзьям)</label>
            <div><button class="acc-btn acc-btn-sm" type="submit" :disabled="busy || !infoChanged">Сохранить</button></div>
          </form>
        </section>

        <section class="settings-section" aria-labelledby="pl-s-cover">
          <h2 id="pl-s-cover">Обложка</h2>
          <div class="acc-actions">
            <label class="acc-btn acc-btn-sm" style="cursor: pointer;">
              Своя картинка…
              <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" data-testid="playlist-cover-file" @change="onFile">
            </label>
            <button v-if="pl.cover_version" class="acc-btn acc-btn-sm" type="button" :disabled="busy" @click="resetCover">Вернуть коллаж</button>
          </div>
          <p class="acc-hint" style="margin-top: 0.5rem;">jpg, png или webp до 5 МБ. Без своей картинки — коллаж из обложек первых треков.</p>
        </section>

        <section class="settings-section" aria-labelledby="pl-s-del">
          <h2 id="pl-s-del">Удалить плейлист</h2>
          <button class="acc-btn acc-btn-danger acc-btn-sm" type="button" :disabled="busy" @click="remove_">Удалить плейлист</button>
        </section>
      </template>

      <AvatarCropper v-if="cropImage" :image="cropImage" :busy="busy" :size="COVER_SIZE" :round="false" title="Обложка плейлиста" @cancel="closeCropper" @save="uploadCover" />
    </template>
  </div>
</template>

<script setup lang="ts">
// Плейлист: воспроизведение подряд и перемешанно. Владельцу — правка:
// название, описание, публичность, обложка, порядок, удаление.
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { session } from '@/site/session'
import { checkAvatarSource } from '@/site/auth/avatars'
import { api, errorText, type PlaylistFull } from '../social/api'
import { COVER_SIZE, coverUrls, deletePlaylist, moveItem, rememberPlaylist, removePlaylistCover, uploadPlaylistCover } from '../social/playlists'
import { showNotice } from '../social/notice'
import { plural } from '../social/format'
import { playList, playListShuffled } from '../player/engine'
import type { QueueSource } from '../player/queue'
import TrackList from '../components/TrackList.vue'
import PlaylistCover from '../components/PlaylistCover.vue'
import UserTag from '../components/UserTag.vue'
import AvatarCropper from '../components/AvatarCropper.vue'
import { PLAYLIST_DESCRIPTION_MAX, PLAYLIST_TITLE_MAX, cleanPlaylistTitle, validatePlaylistTitle } from '../../../supabase/functions/_shared/accounts.ts'

const route = useRoute()
const router = useRouter()
const pl = ref<PlaylistFull | null>(null)
const state = ref<'loading' | 'ok' | 'missing'>('loading')
const busy = ref(false)
const coverUrl = ref<string | null>(null)
const form = reactive({ title: '', description: '', isPublic: false })

const isOwner = computed(() => Boolean(pl.value && session.user && pl.value.owner_id === session.user.id))
const source = computed<QueueSource | null>(() => (pl.value ? { kind: 'playlist', playlistId: pl.value.id, title: pl.value.title } : null))
const infoChanged = computed(() => Boolean(pl.value) && (form.title !== pl.value!.title || form.description !== pl.value!.description || form.isPublic !== pl.value!.is_public))

function apply(next: PlaylistFull) {
  pl.value = next
  form.title = next.title
  form.description = next.description
  form.isPublic = next.is_public
  void coverUrls([next]).then((u) => {
    if (pl.value?.id === next.id) coverUrl.value = u[next.id] ?? null
  })
}

/** Ответ RPC без треков — дополняем тем, что уже на экране. */
function merge(summary: Partial<PlaylistFull>) {
  if (!pl.value) return
  const next = { ...pl.value, ...summary } as PlaylistFull
  apply(next)
  if (isOwner.value) rememberPlaylist(next)
}

watch(
  () => String(route.params.id ?? ''),
  async (id) => {
    state.value = 'loading'
    pl.value = null
    coverUrl.value = null
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      state.value = 'missing'
      return
    }
    try {
      apply(await api.playlistGet(id))
      state.value = 'ok'
    } catch {
      state.value = 'missing'
    }
  },
  { immediate: true }
)

const play = (index: number) => pl.value && source.value && playList(source.value, pl.value.tracks, index)
const shuffle = () => pl.value && source.value && playListShuffled(source.value, pl.value.tracks)

async function guarded(fn: () => Promise<void>) {
  busy.value = true
  try {
    await fn()
  } catch (e) {
    showNotice(errorText(e), true)
  } finally {
    busy.value = false
  }
}

function move(from: number, to: number) {
  if (!pl.value) return
  const before = pl.value.tracks
  const after = moveItem(before, from, to)
  pl.value = { ...pl.value, tracks: after }
  void guarded(async () => {
    try {
      merge(await api.playlistReorder(pl.value!.id, after))
    } catch (e) {
      if (pl.value) pl.value = { ...pl.value, tracks: before }
      throw e
    }
  })
}

function remove(index: number) {
  const p = pl.value
  if (!p) return
  const trackId = p.tracks[index]
  void guarded(async () => {
    const summary = await api.playlistRemoveTrack(p.id, trackId)
    merge({ ...summary, tracks: p.tracks.filter((t) => t !== trackId) })
  })
}

function saveInfo() {
  const p = pl.value
  if (!p) return
  const title = cleanPlaylistTitle(form.title)
  const problem = validatePlaylistTitle(title)
  if (problem) return showNotice(problem, true)
  void guarded(async () => {
    merge(await api.playlistUpdate(p.id, { title, description: form.description, isPublic: form.isPublic }))
    showNotice('Сохранено')
  })
}

// ── Обложка ──
const cropImage = ref<HTMLImageElement | null>(null)
let cropUrl = ''

function closeCropper() {
  cropImage.value = null
  if (cropUrl) URL.revokeObjectURL(cropUrl)
  cropUrl = ''
}

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const problem = checkAvatarSource(file)
  if (problem) return showNotice(problem, true)
  cropUrl = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => { cropImage.value = img }
  img.onerror = () => {
    closeCropper()
    showNotice('Не получилось открыть картинку', true)
  }
  img.src = cropUrl
}

function uploadCover(blob: Blob) {
  const p = pl.value
  if (!p) return
  void guarded(async () => {
    merge(await uploadPlaylistCover(p, blob))
    closeCropper()
    showNotice('Обложка обновлена')
  })
}

function resetCover() {
  const p = pl.value
  if (!p) return
  void guarded(async () => {
    merge(await removePlaylistCover(p))
    coverUrl.value = null
  })
}

function remove_() {
  const p = pl.value
  if (!p || !window.confirm(`Удалить плейлист «${p.title}»? Это нельзя отменить.`)) return
  void guarded(async () => {
    await deletePlaylist(p)
    showNotice('Плейлист удалён')
    void router.replace({ name: 'playlists' })
  })
}
</script>
