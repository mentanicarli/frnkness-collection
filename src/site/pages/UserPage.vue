<template>
  <div class="shell shell-narrow profile-page">
    <p v-if="state === 'loading'" class="acc-hint">Загрузка…</p>
    <p v-else-if="state === 'missing'" class="acc-alert acc-alert-info">Такого пользователя нет.</p>
    <template v-else-if="profile">
      <div class="profile-head">
        <UserAvatar :avatar="profile.avatar" :nick="profile.nick" :user-id="profile.id" :size="5.5" :cover-of="coverOf" />
        <div class="min-w-0">
          <h1 class="profile-nick">{{ profile.nick }}</h1>
          <p class="profile-meta">С нами с {{ formatDate(profile.created_at) }} · <span data-testid="friends-count">{{ profile.friends_count }} {{ plural(profile.friends_count, 'друг', 'друга', 'друзей') }}</span></p>
          <p v-if="profile.bio" class="profile-bio">{{ profile.bio }}</p>
          <div class="social-actions" style="margin-top: 1rem;">
            <RouterLink v-if="profile.relation === 'self'" class="acc-btn acc-btn-sm" :to="{ name: 'me' }">Настройки профиля</RouterLink>
            <button v-else-if="profile.relation === 'none'" class="acc-btn acc-btn-primary acc-btn-sm" type="button" :disabled="busy" @click="act(() => api.friendRequest(profile!.id))">Добавить в друзья</button>
            <template v-else-if="profile.relation === 'incoming'">
              <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" :disabled="busy" @click="act(() => api.friendRespond(profile!.id, true))">Принять заявку</button>
              <button class="acc-btn acc-btn-sm" type="button" :disabled="busy" @click="act(() => api.friendRespond(profile!.id, false))">Отклонить</button>
            </template>
            <button v-else-if="profile.relation === 'outgoing'" class="acc-btn acc-btn-sm" type="button" :disabled="busy" @click="act(() => api.friendCancel(profile!.id))">Отменить заявку</button>
            <button v-else-if="profile.relation === 'friend'" class="acc-btn acc-btn-sm" type="button" :disabled="busy" @click="unfriend">Удалить из друзей</button>
          </div>
        </div>
      </div>

      <section v-if="profile.now_playing" class="settings-section" aria-labelledby="u-now" data-testid="now-playing">
        <h2 id="u-now">Сейчас слушает</h2>
        <TrackList :track-ids="[profile.now_playing.track_id]" :numbered="false" label="Сейчас слушает" @play="playOne(profile.now_playing.track_id)" />
      </section>

      <section class="settings-section" aria-labelledby="u-pl">
        <h2 id="u-pl">Плейлисты</h2>
        <p v-if="playlists === null" class="acc-hint">Загрузка…</p>
        <p v-else-if="!playlists.length" class="acc-hint">{{ canSee ? 'Плейлистов пока нет.' : 'Публичных плейлистов нет.' }}</p>
        <PlaylistGrid v-else :playlists="playlists" />
      </section>

      <template v-if="canSee">
        <section class="settings-section" aria-labelledby="u-fav">
          <h2 id="u-fav">Избранное</h2>
          <p v-if="favoriteIds === null" class="acc-hint">Загрузка…</p>
          <p v-else-if="!favoriteIds.length" class="acc-hint">Пока пусто.</p>
          <template v-else>
            <div class="social-actions">
              <button class="acc-btn acc-btn-sm" type="button" @click="playList(favSource, favoriteIds, 0)">Слушать</button>
              <button class="acc-btn acc-btn-sm" type="button" @click="startFavoritesFlow(profile.id, favoriteIds)">Поток по избранному</button>
            </div>
            <TrackList :track-ids="favoriteIds" :source="favSource" label="Избранное" @play="(i) => playList(favSource, favoriteIds!, i)" />
          </template>
        </section>

        <section class="settings-section" aria-labelledby="u-top">
          <h2 id="u-top">{{ profile.relation === 'self' ? 'Мой топ' : 'Топ' }}</h2>
          <div class="social-tabs" role="tablist" aria-label="Период">
            <button v-for="p in TOP_PERIODS" :key="String(p.days)" role="tab" type="button" class="social-tab" :aria-selected="topDays === p.days ? 'true' : 'false'" @click="topDays = p.days">{{ p.label }}</button>
          </div>
          <p v-if="top === null" class="acc-hint">Загрузка…</p>
          <p v-else-if="!top.length" class="acc-alert acc-alert-info" data-testid="top-empty">
            {{ topDays ? `За ${topDays} дней прослушиваний нет.` : 'Пока мало данных.' }} Топ считается по прослушиваниям: трек засчитывается после 10 секунд.
          </p>
          <TrackList v-else :track-ids="top.map((t) => t.trackId)" :extras="top.map((t) => `${t.plays} ${plural(t.plays, 'прослушивание', 'прослушивания', 'прослушиваний')}`)" label="Топ" @play="(i) => playOne(top![i].trackId)" />
        </section>
      </template>
      <p v-else class="acc-alert acc-alert-info">Избранное, топ и что сейчас слушает {{ profile.nick }} видят только друзья.</p>
    </template>
  </div>
</template>

<script setup lang="ts">
// Страница пользователя по нику (#/u/<ник>; старые ссылки #/u/<id>
// переводятся на ник). Всем вошедшим — ник, аватар, «о себе», дата,
// число друзей, публичные плейлисты; себе и друзьям — избранное, все
// плейлисты, топ, «сейчас слушает».
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { releases } from '@/config'
import { supabase } from '@/supabaseClient'
import UserAvatar from '@/site/components/UserAvatar.vue'
import { api, errorText, type PlaylistSummary, type UserPage } from '../social/api'
import { refreshFriendRequests } from '../social/friends'
import { showNotice } from '../social/notice'
import { formatDate, plural } from '../social/format'
import { TOP_PERIODS, buildTop, type TopItem, type TopPeriod } from '../social/top'
import { trackInfo } from '../social/tracks'
import { playList, playTrackByRef, startFavoritesFlow } from '../player/engine'
import type { QueueSource } from '../player/queue'
import TrackList from '../components/TrackList.vue'
import PlaylistGrid from '../components/PlaylistGrid.vue'

const route = useRoute()
const router = useRouter()
const profile = ref<UserPage | null>(null)
const state = ref<'loading' | 'ok' | 'missing'>('loading')
const busy = ref(false)
const playlists = ref<PlaylistSummary[] | null>(null)
const favoriteIds = ref<string[] | null>(null)
const top = ref<TopItem[] | null>(null)
const topDays = ref<TopPeriod>(30)
const coverOf = (id: string) => releases[id]?.cover ?? null

const canSee = computed(() => profile.value?.relation === 'self' || profile.value?.relation === 'friend')
const favSource = computed<QueueSource>(() => ({ kind: 'favorites', ownerId: profile.value?.id ?? '' }))
let seq = 0

async function load(nick: string) {
  const my = ++seq
  const p = await api.profileByNick(nick).catch(() => null)
  if (my !== seq) return
  profile.value = p
  state.value = p ? 'ok' : 'missing'
  playlists.value = favoriteIds.value = top.value = null
  if (!p) return
  // Ник в адресе — как его записал владелец (регистр, ё).
  if (p.nick !== nick) void router.replace({ name: 'user', params: { nick: p.nick } })
  void api.userPlaylists(p.id).then((rows) => { if (my === seq) playlists.value = rows ?? [] }).catch(() => { if (my === seq) playlists.value = [] })
  if (p.relation === 'self' || p.relation === 'friend') {
    void api.userFavorites(p.id).then((rows) => { if (my === seq) favoriteIds.value = (rows ?? []).map((r) => r.track_id) }).catch(() => { if (my === seq) favoriteIds.value = [] })
    void loadTop()
  }
}

async function loadTop() {
  const p = profile.value
  if (!p || !canSee.value) return
  const my = seq
  const days = topDays.value
  top.value = null
  try {
    const rows = await api.userTop(p.id, days)
    if (my === seq && days === topDays.value) top.value = buildTop(rows ?? [], releases)
  } catch {
    if (my === seq) top.value = []
  }
}
watch(topDays, () => void loadTop())

watch(
  () => String(route.params.nick ?? ''),
  async (raw) => {
    // Только поправили написание ника в адресе — уже загружено.
    if (profile.value && profile.value.nick === raw) return
    state.value = 'loading'
    profile.value = null
    // Старая ссылка по id → ник.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
      const { data } = await supabase.from('profiles').select('nick').eq('id', raw).maybeSingle()
      const nick = (data as { nick: string } | null)?.nick
      if (nick) void router.replace({ name: 'user', params: { nick } })
      else state.value = 'missing'
      return
    }
    if (!raw) {
      state.value = 'missing'
      return
    }
    await load(raw)
  },
  { immediate: true }
)

function playOne(trackId: string) {
  const info = trackInfo(trackId)
  if (info.releaseId) playTrackByRef(info.releaseId, info.trackIndex, 'fade')
}

async function act(fn: () => Promise<unknown>) {
  const p = profile.value
  if (!p) return
  busy.value = true
  try {
    await fn()
    await load(p.nick)
    void refreshFriendRequests()
  } catch (e) {
    showNotice(errorText(e), true)
  } finally {
    busy.value = false
  }
}

function unfriend() {
  const p = profile.value
  if (p && window.confirm(`Удалить ${p.nick} из друзей?`)) void act(() => api.friendRemove(p.id))
}
</script>
