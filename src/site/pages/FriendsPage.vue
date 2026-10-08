<template>
  <div class="shell shell-narrow social-page">
    <h1 class="social-h1">Друзья</h1>
    <div class="social-actions" style="margin-top: 0.75rem;">
      <RouterLink v-if="room.roomId && room.isOwner" class="acc-btn acc-btn-primary acc-btn-sm" :to="{ name: 'room', params: { id: room.roomId } }" data-testid="my-room-link">Вернуться в комнату</RouterLink>
      <button v-else class="acc-btn acc-btn-sm" type="button" data-testid="friends-create-room" @click="openCreateRoom">Создать комнату</button>
    </div>

    <section class="settings-section" aria-labelledby="fr-search" style="border-top: 0; padding-top: 0.5rem;">
      <h2 id="fr-search">Найти по нику</h2>
      <input v-model="query" class="acc-input" type="search" maxlength="20" placeholder="Ник" aria-label="Поиск по нику" autocomplete="off" data-testid="friend-search" ref="finderInput" @focus="openFinder" @click="openFinder">
      <template v-if="finderOpen">
        <ul v-if="discover.state.users.length" class="user-list" data-testid="discover-list">
          <UserRow v-for="u in discover.state.users" :key="u.id" :user="u" :sub="RELATION_TEXT[u.relation]">
            <button v-if="u.relation === 'none'" class="acc-btn acc-btn-sm" type="button" :disabled="busy" data-testid="discover-add" @click="request(u.id)">Добавить в друзья</button>
            <button v-else-if="u.relation === 'incoming'" class="acc-btn acc-btn-primary acc-btn-sm" type="button" :disabled="busy" @click="respond(u.id, true)">Принять заявку</button>
            <span v-else-if="u.relation === 'outgoing'" class="acc-hint" data-testid="discover-status">Заявка отправлена</span>
            <span v-else-if="u.relation === 'friend'" class="acc-hint" data-testid="discover-status">Уже друзья</span>
          </UserRow>
        </ul>
        <p v-else-if="discover.state.loaded && !discover.state.loading" class="acc-hint" style="margin-top: 0.75rem;" data-testid="discover-empty">
          {{ discover.state.query ? 'Никого не нашли.' : 'Пока здесь больше никого нет.' }}
        </p>
        <p v-if="discover.state.loading" class="acc-hint" style="margin-top: 0.75rem;">Загрузка…</p>
        <p v-if="discover.state.error" class="acc-hint" style="margin-top: 0.75rem;">
          {{ discover.state.error }}
          <button class="acc-btn acc-btn-sm" type="button" @click="discover.loadMore()">Повторить</button>
        </p>
        <div v-if="discover.state.hasMore && discover.state.users.length" ref="sentinel" class="discover-more" data-testid="discover-more">
          <button class="acc-btn acc-btn-sm" type="button" :disabled="discover.state.loading" @click="discover.loadMore()">Показать ещё</button>
        </div>
      </template>
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
        <EmptyHint v-if="!list.friends.length" title="Здесь будут твои друзья" text="Найди знакомых по нику и отправь заявку. Друзья видят, что ты слушаешь, и могут слушать вместе с тобой в комнате.">
          <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" data-testid="hint-find-friends" @click="focusFinder">Найти друзей</button>
        </EmptyHint>
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
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { api, errorText, type FriendsList, type Profile, type Relation } from '../social/api'
import { createDiscover } from '../social/discover'
import { roomApi, type RoomInvite } from '../rooms/api'
import { openCreateRoom, room, rooms } from '../rooms'
import { friendRequests, refreshFriendRequests, setFastFriendPolling } from '../social/friends'
import { showNotice } from '../social/notice'
import { formatDate } from '../social/format'
import { trackInfo } from '../social/tracks'
import { debounce } from '@/utils/helpers'
import EmptyHint from '../components/EmptyHint.vue'
import UserRow from '../components/UserRow.vue'

// Статусы «Заявка отправлена» и «Уже друзья» стоят справа от ника; под ником — только входящая заявка.
const RELATION_TEXT: Record<Relation, string> = { self: '', friend: '', incoming: 'прислал(а) заявку', outgoing: '', none: '' }

const router = useRouter()
const list = ref<FriendsList | null>(null)
const invites = ref<RoomInvite[]>([])
const busy = ref(false)
const query = ref('')
const discover = createDiscover()
const finderOpen = ref(false)
const sentinel = ref<HTMLElement | null>(null)
const finderInput = ref<HTMLInputElement | null>(null)
const focusFinder = () => {
  openFinder()
  finderInput.value?.focus()
  finderInput.value?.scrollIntoView?.({ block: 'center' })
}
let observer: IntersectionObserver | null = null

const nowPlayingTitle = (id: string) => trackInfo(id).title

/** Перечитать списки. refreshBadge=false — когда список обновляется из-за значка (чтобы не ходить по кругу). */
async function reload(refreshBadge = true) {
  try {
    ;[list.value, invites.value] = await Promise.all([api.friendsList(), roomApi.invitesList().catch(() => [])])
  } catch (e) {
    showNotice(errorText(e), true)
  }
  if (refreshBadge) void refreshFriendRequests()
}
onMounted(() => {
  void reload()
  setFastFriendPolling(true)
})
onBeforeUnmount(() => setFastFriendPolling(false))

// Значок на аватаре изменился (пришла заявка или приглашение) — список обновляется сразу следом.
watch(
  () => [friendRequests.incoming, friendRequests.invites] as const,
  () => void reload(false)
)

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

/** Нажали на «Найти по нику»: сразу показываем всех, дальше список листается и фильтруется. */
function openFinder() {
  if (finderOpen.value) return
  finderOpen.value = true
  void discover.search(query.value)
}

const runSearch = debounce(() => void discover.search(query.value), 250)
watch(query, () => {
  if (finderOpen.value) runSearch()
})

// Подгрузка при прокрутке: пока метка в конце списка видна, берём следующую часть.
function watchSentinel() {
  observer?.disconnect()
  observer = null
  if (!sentinel.value || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) void discover.loadMore()
  }, { rootMargin: '200px' })
  observer.observe(sentinel.value)
}
watch(
  () => [discover.state.users.length, discover.state.hasMore, finderOpen.value] as const,
  () => void nextTick(watchSentinel)
)
onBeforeUnmount(() => observer?.disconnect())

/** fn возвращает текст «готово». */
async function act(fn: () => Promise<string>) {
  busy.value = true
  try {
    showNotice(await fn())
    await reload()
  } catch (e) {
    showNotice(errorText(e), true)
  } finally {
    busy.value = false
  }
}

const request = (id: string) => act(async () => {
  const accepted = (await api.friendRequest(id)).status === 'accepted'
  discover.setRelation(id, accepted ? 'friend' : 'outgoing')
  return accepted ? 'Теперь вы друзья' : 'Заявка отправлена'
})
const respond = (id: string, accept: boolean) => act(async () => {
  await api.friendRespond(id, accept)
  discover.setRelation(id, accept ? 'friend' : 'none')
  return accept ? 'Теперь вы друзья' : 'Заявка отклонена'
})
const cancel = (id: string) => act(async () => {
  await api.friendCancel(id)
  discover.setRelation(id, 'none')
  return 'Заявка отменена'
})
function unfriend(u: Profile) {
  if (!window.confirm(`Удалить ${u.nick} из друзей?`)) return
  void act(async () => {
    await api.friendRemove(u.id)
    discover.setRelation(u.id, 'none')
    return 'Удалён(а) из друзей'
  })
}
</script>
