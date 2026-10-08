<template>
  <div class="shell shell-narrow social-page">
    <h1 class="social-h1">Друзья</h1>
    <div class="social-actions" style="margin-top: 0.75rem;">
      <RouterLink v-if="room.roomId && room.isOwner" class="acc-btn acc-btn-sm" :to="{ name: 'room', params: { id: room.roomId } }" data-testid="my-room-link">Моя комната</RouterLink>
      <button v-else class="acc-btn acc-btn-sm" type="button" data-testid="friends-create-room" @click="openCreateRoom">Создать комнату</button>
    </div>

    <section class="settings-section" aria-labelledby="fr-search" style="border-top: 0; padding-top: 0.5rem;">
      <h2 id="fr-search">Найти по нику</h2>
      <input v-model="query" class="acc-input" type="search" maxlength="20" placeholder="Ник" aria-label="Поиск по нику" autocomplete="off" data-testid="friend-search">
      <ul v-if="results.length" class="user-list">
        <UserRow v-for="u in results" :key="u.id" :user="u" :sub="RELATION_TEXT[u.relation]">
          <button v-if="u.relation === 'none'" class="acc-btn acc-btn-sm" type="button" :disabled="busy" @click="request(u.id)">Добавить в друзья</button>
          <button v-else-if="u.relation === 'incoming'" class="acc-btn acc-btn-primary acc-btn-sm" type="button" :disabled="busy" @click="respond(u.id, true)">Принять заявку</button>
        </UserRow>
      </ul>
      <p v-else-if="query.trim() && searched" class="acc-hint" style="margin-top: 0.75rem;">Никого не нашли.</p>
    </section>

    <p v-if="!list" class="acc-hint">Загрузка…</p>
    <template v-else>
      <section v-if="invites.length" class="settings-section" aria-labelledby="fr-rooms">
        <h2 id="fr-rooms">Приглашения в комнаты <span class="badge" data-testid="invites-count">{{ invites.length }}</span></h2>
        <ul class="user-list">
          <UserRow v-for="inv in invites" :key="inv.room_id" :user="inv.from" :sub="`зовёт в «${inv.title}»`">
            <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" :disabled="busy" data-testid="invite-enter" @click="enter(inv)">Войти</button>
            <button class="acc-btn acc-btn-sm" type="button" :disabled="busy" @click="dismiss(inv)">Отклонить</button>
          </UserRow>
        </ul>
      </section>

      <section v-if="list.incoming.length" class="settings-section" aria-labelledby="fr-in">
        <h2 id="fr-in">Заявки в друзья <span class="badge" data-testid="incoming-count">{{ list.incoming.length }}</span></h2>
        <ul class="user-list">
          <UserRow v-for="u in list.incoming" :key="u.id" :user="u" :sub="`заявка от ${formatDate(u.created_at)}`">
            <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" :disabled="busy" @click="respond(u.id, true)">Принять</button>
            <button class="acc-btn acc-btn-sm" type="button" :disabled="busy" @click="respond(u.id, false)">Отклонить</button>
          </UserRow>
        </ul>
      </section>

      <section class="settings-section" aria-labelledby="fr-list">
        <h2 id="fr-list">Мои друзья · {{ list.friends.length }}</h2>
        <p v-if="!list.friends.length" class="acc-hint">Пока никого. Найди друзей по нику выше.</p>
        <ul v-else class="user-list">
          <UserRow v-for="u in list.friends" :key="u.id" :user="u" :sub="u.now_playing ? `слушает: ${nowPlayingTitle(u.now_playing.track_id)}` : ''">
            <button class="acc-btn acc-btn-sm" type="button" :disabled="busy" @click="unfriend(u)">Удалить</button>
          </UserRow>
        </ul>
      </section>

      <section v-if="list.outgoing.length" class="settings-section" aria-labelledby="fr-out">
        <h2 id="fr-out">Отправленные заявки</h2>
        <ul class="user-list">
          <UserRow v-for="u in list.outgoing" :key="u.id" :user="u" sub="ждёт ответа">
            <button class="acc-btn acc-btn-sm" type="button" :disabled="busy" @click="cancel(u.id)">Отменить</button>
          </UserRow>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
// Друзья: поиск по нику, заявки (принять / отклонить / отменить),
// список друзей с «сейчас слушает», удаление из друзей.
import { onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { api, errorText, type FriendsList, type Profile, type Relation } from '../social/api'
import { roomApi, type RoomInvite } from '../rooms/api'
import { openCreateRoom, room, rooms } from '../rooms'
import { refreshFriendRequests } from '../social/friends'
import { showNotice } from '../social/notice'
import { formatDate } from '../social/format'
import { trackInfo } from '../social/tracks'
import { debounce } from '@/utils/helpers'
import UserRow from '../components/UserRow.vue'

const RELATION_TEXT: Record<Relation, string> = { self: '', friend: 'в друзьях', incoming: 'прислал(а) заявку', outgoing: 'заявка отправлена', none: '' }

const router = useRouter()
const list = ref<FriendsList | null>(null)
const invites = ref<RoomInvite[]>([])
const busy = ref(false)
const query = ref('')
const results = ref<(Profile & { relation: Relation })[]>([])
const searched = ref(false)
let searchSeq = 0

const nowPlayingTitle = (id: string) => trackInfo(id).title

async function reload() {
  try {
    ;[list.value, invites.value] = await Promise.all([api.friendsList(), roomApi.invitesList().catch(() => [])])
  } catch (e) {
    showNotice(errorText(e), true)
  }
  void refreshFriendRequests()
}

// «Войти»: нажатие и есть разрешение на звук, поэтому входим сразу.
async function enter(inv: RoomInvite) {
  busy.value = true
  try {
    await rooms.join(inv.room_id)
    void refreshFriendRequests()
    void router.push({ name: 'room', params: { id: inv.room_id } })
  } catch (e) {
    showNotice(errorText(e), true)
    await dismiss(inv)
  } finally {
    busy.value = false
  }
}

async function dismiss(inv: RoomInvite) {
  try {
    await roomApi.inviteDismiss(inv.room_id)
    invites.value = invites.value.filter((i) => i.room_id !== inv.room_id)
    void refreshFriendRequests()
  } catch (e) {
    showNotice(errorText(e), true)
  }
}
onMounted(reload)

const runSearch = debounce(async () => {
  const q = query.value.trim()
  const seq = ++searchSeq
  if (!q) {
    results.value = []
    searched.value = false
    return
  }
  try {
    const rows = await api.userSearch(q)
    if (seq !== searchSeq) return
    results.value = rows ?? []
    searched.value = true
  } catch (e) {
    if (seq === searchSeq) showNotice(errorText(e), true)
  }
}, 250)
watch(query, () => runSearch())

/** fn возвращает текст «готово». */
async function act(fn: () => Promise<string>) {
  busy.value = true
  try {
    showNotice(await fn())
    await reload()
    if (query.value.trim()) runSearch()
  } catch (e) {
    showNotice(errorText(e), true)
  } finally {
    busy.value = false
  }
}

const request = (id: string) => act(async () => ((await api.friendRequest(id)).status === 'accepted' ? 'Теперь вы друзья' : 'Заявка отправлена'))
const respond = (id: string, accept: boolean) => act(async () => {
  await api.friendRespond(id, accept)
  return accept ? 'Теперь вы друзья' : 'Заявка отклонена'
})
const cancel = (id: string) => act(async () => {
  await api.friendCancel(id)
  return 'Заявка отменена'
})
function unfriend(u: Profile) {
  if (!window.confirm(`Удалить ${u.nick} из друзей?`)) return
  void act(async () => {
    await api.friendRemove(u.id)
    return 'Удалён(а) из друзей'
  })
}
</script>
