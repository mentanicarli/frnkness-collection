<template>
  <div class="shell shell-narrow social-page room-page" data-testid="room-page">
    <p v-if="loading" class="acc-hint">Загрузка…</p>

    <template v-else-if="!validId || (preview && preview.closed)">
      <h1 class="social-h1">Комнаты нет</h1>
      <p class="acc-alert acc-alert-info" style="margin-top: 1rem;" data-testid="room-missing">Комната закрыта или такой ссылки нет.</p>
      <RouterLink class="acc-btn acc-btn-sm" style="margin-top: 1rem;" :to="{ name: 'home' }">На главную</RouterLink>
    </template>

    <!-- Комната идёт: участники, что играет, управление -->
    <template v-else-if="inThisRoom && room.status === 'live'">
      <p class="social-kicker">Комната</p>
      <h1 class="social-h1" data-testid="room-title">{{ room.title }}</h1>
      <p class="social-meta" data-testid="room-meta">
        Хозяин: {{ ownerNick }} · {{ room.members.length }} из {{ ROOM_CAPACITY }}
      </p>

      <p v-if="waitingForHost" class="acc-alert acc-alert-info" role="status" data-testid="room-waiting">Ждём хозяина</p>
      <p v-else-if="room.hostState === 'grace' && !room.isOwner" class="acc-hint" data-testid="room-grace">Хозяин переподключается…</p>
      <p v-if="room.outdated" class="acc-alert acc-alert-info" role="status" data-testid="room-outdated">Обнови страницу: у хозяина трек, которого нет в твоей версии сайта.</p>
      <div v-if="room.needsGesture" class="acc-alert acc-alert-info" role="status" data-testid="room-gesture">
        Браузер не включил звук сам.
        <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" style="margin-left: 0.5rem;" data-testid="room-enable-sound" @click="rooms.enableSound()">Включить звук</button>
      </div>

      <section class="settings-section" aria-labelledby="room-now" style="border-top: 0; padding-top: 0.5rem;">
        <h2 id="room-now">Сейчас играет</h2>
        <div v-if="now" class="room-now" data-testid="room-now">
          <img v-if="now.cover" class="room-now-cover" :src="now.cover" alt="" width="64" height="64">
          <span class="min-w-0">
            <span class="room-now-title" data-testid="room-now-title">{{ now.title }}</span>
            <span v-if="now.releaseTitle" class="user-row-sub">{{ now.releaseTitle }}</span>
          </span>
          <span v-if="room.playing" class="badge" style="background: var(--fg-faint);">играет</span>
          <span v-else class="user-row-sub">пауза</span>
        </div>
        <p v-else class="acc-hint">{{ room.isOwner ? 'Включи что-нибудь в плеере — оно заиграет у всех.' : 'Хозяин пока ничего не включил.' }}</p>
        <div v-if="next.length || room.nextRandom" class="room-next" data-testid="room-next">
          <p class="social-kicker" style="margin-top: 1rem;">Дальше</p>
          <ol v-if="next.length" class="room-next-list">
            <li v-for="(t, i) in next" :key="`${t.trackId}-${i}`">{{ t.title }}</li>
          </ol>
          <p v-else class="acc-hint">Случайный трек (Поток)</p>
        </div>
      </section>

      <section class="settings-section" aria-labelledby="room-people">
        <h2 id="room-people">Участники · {{ room.members.length }}</h2>
        <ul class="user-list">
          <UserRow v-for="m in room.members" :key="m.id" :user="m" :sub="memberSub(m)">
            <button
              v-if="room.isOwner && !m.owner"
              class="acc-btn acc-btn-sm"
              type="button"
              :disabled="busy"
              data-testid="room-kick"
              @click="kick(m)"
            >Выгнать</button>
          </UserRow>
        </ul>
      </section>

      <section class="settings-section" aria-labelledby="room-actions">
        <h2 id="room-actions">{{ room.isOwner ? 'Управление' : 'Комната' }}</h2>
        <div class="social-actions">
          <button class="acc-btn acc-btn-sm" type="button" data-testid="room-copy" @click="copyLink">Скопировать ссылку</button>
          <template v-if="room.isOwner">
            <button class="acc-btn acc-btn-sm" type="button" data-testid="room-invite-toggle" :aria-expanded="inviteOpen ? 'true' : 'false'" @click="toggleInvite">Пригласить друзей</button>
            <button class="acc-btn acc-btn-danger acc-btn-sm" type="button" :disabled="busy" data-testid="room-close" @click="closeRoom">Закрыть комнату</button>
          </template>
          <button v-else class="acc-btn acc-btn-sm" type="button" :disabled="busy" data-testid="room-leave" @click="leave">Выйти</button>
        </div>
        <p v-if="!room.isOwner" class="acc-hint">Громкость твоя. Остальным управляет хозяин.</p>

        <div v-if="inviteOpen && room.isOwner" class="room-invite" data-testid="room-invite-panel">
          <p v-if="!friends" class="acc-hint">Загрузка…</p>
          <p v-else-if="!friends.length" class="acc-hint">Друзей пока нет — добавь их на странице «Друзья».</p>
          <ul v-else class="user-list">
            <UserRow v-for="f in friends" :key="f.id" :user="f" :sub="inRoom(f.id) ? 'уже в комнате' : invited.has(f.id) ? 'приглашение отправлено' : ''">
              <button
                class="acc-btn acc-btn-primary acc-btn-sm"
                type="button"
                :disabled="busy || inRoom(f.id)"
                data-testid="room-invite-friend"
                @click="invite(f)"
              >{{ invited.has(f.id) ? 'Ещё раз' : 'Пригласить' }}</button>
            </UserRow>
          </ul>
        </div>
      </section>
    </template>

    <p v-else-if="inThisRoom && room.status === 'connecting'" class="acc-hint" data-testid="room-connecting">Подключаемся…</p>

    <!-- Ссылку открыл не подключённый: показываем комнату и кнопку «Подключиться» -->
    <template v-else>
      <p class="social-kicker">Комната</p>
      <h1 class="social-h1" data-testid="room-title">{{ previewTitle }}</h1>
      <p v-if="preview && !preview.closed" class="social-meta">Хозяин: {{ preview.owner.nick }} · {{ preview.members }} из {{ preview.capacity }}</p>

      <p v-if="preview && !preview.closed && preview.kicked" class="acc-alert acc-alert-error" data-testid="room-kicked">Тебя выгнали из этой комнаты.</p>
      <p v-else-if="preview && !preview.closed && preview.full && !preview.is_member" class="acc-alert acc-alert-info" data-testid="room-full">В комнате уже {{ preview.capacity }} человек.</p>
      <template v-else>
        <p v-if="room.roomId && room.roomId !== id && !room.needsConnect" class="acc-hint">Ты сейчас в комнате «{{ room.title }}». При входе выйдешь из неё.</p>
        <p v-if="room.isOwner && room.roomId && room.roomId !== id" class="acc-alert acc-alert-info">Сначала закрой свою комнату <RouterLink :to="{ name: 'room', params: { id: room.roomId } }">«{{ room.title }}»</RouterLink>.</p>
        <p class="acc-hint">Музыка заиграет после нажатия — так устроены браузеры.</p>
        <div class="social-actions" style="margin-top: 1rem;">
          <button class="acc-btn acc-btn-primary" type="button" :disabled="busy" data-testid="room-connect" @click="connect">Подключиться</button>
          <RouterLink class="acc-btn" :to="{ name: 'home' }">Не сейчас</RouterLink>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
// Страница комнаты #/room/<id>: название, участники, что играет и что дальше.
// У хозяина — ссылка, приглашения, «Выгнать», «Закрыть комнату». Все тексты
// (название комнаты, ники) выводятся только интерполяцией — с экранированием.
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { api, errorText, type Profile } from '../social/api'
import { showNotice } from '../social/notice'
import { trackInfo } from '../social/tracks'
import { room, rooms, roomLink } from '../rooms'
import type { RoomInfo, RoomMember } from '../rooms/api'
import { ROOM_CAPACITY, isRoomId } from '../rooms/sync'
import UserRow from '../components/UserRow.vue'

const route = useRoute()
const router = useRouter()

const id = computed(() => String(route.params.id ?? ''))
const validId = computed(() => isRoomId(id.value))
const inThisRoom = computed(() => room.roomId === id.value && !room.needsConnect)

const loading = ref(true)
const busy = ref(false)
const preview = ref<RoomInfo | null>(null)
const inviteOpen = ref(false)
const friends = ref<Profile[] | null>(null)
const invited = ref(new Set<string>())

const ownerNick = computed(() => room.members.find((m) => m.owner)?.nick ?? '')
const waitingForHost = computed(() => !room.isOwner && room.hostState === 'away')
const previewTitle = computed(() => (preview.value && !preview.value.closed ? preview.value.title : room.roomId === id.value ? room.title : 'Комната'))

const now = computed(() => (room.nowTrackId ? trackInfo(room.nowTrackId) : null))
const next = computed(() => room.nextTrackIds.map((t) => trackInfo(t)))

const inRoom = (userId: string) => room.members.some((m) => m.id === userId)
const memberSub = (m: RoomMember): string => {
  if (m.owner) return room.online.includes(m.id) ? 'хозяин' : 'хозяин · не в сети'
  return room.online.includes(m.id) ? 'в сети' : 'не в сети'
}

async function load() {
  loading.value = true
  preview.value = null
  inviteOpen.value = false
  try {
    if (!validId.value) return
    // Уже в этой комнате (или подключаемся): состояние есть, запрос не нужен.
    if (room.roomId === id.value && room.status !== 'idle' && room.status !== 'error') return
    preview.value = await rooms.info(id.value)
  } catch (e) {
    showNotice(errorText(e), true)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(id, load)
// Выгнали, комнату закрыли или вышли — показываем, что с ней сейчас.
watch(() => room.roomId, (now, before) => {
  if (!now && before === id.value) void load()
})

async function connect() {
  busy.value = true
  try {
    // Нажатие — это и есть разрешение на звук (rooms.join разблокирует его первым делом).
    if (room.roomId === id.value && room.needsConnect) await rooms.connect()
    else await rooms.join(id.value)
  } catch (e) {
    showNotice(errorText(e), true)
    void load()
  } finally {
    busy.value = false
  }
}

async function leave() {
  busy.value = true
  try {
    await rooms.leave()
    showNotice('Ты вышел из комнаты')
    void router.push({ name: 'home' })
  } catch (e) {
    showNotice(errorText(e), true)
  } finally {
    busy.value = false
  }
}

async function closeRoom() {
  if (!window.confirm('Закрыть комнату? Все участники выйдут.')) return
  busy.value = true
  try {
    await rooms.close()
    showNotice('Комната закрыта')
    void router.push({ name: 'home' })
  } catch (e) {
    showNotice(errorText(e), true)
  } finally {
    busy.value = false
  }
}

async function kick(m: RoomMember) {
  if (!window.confirm(`Выгнать ${m.nick}? Вернуться в эту комнату он не сможет.`)) return
  busy.value = true
  try {
    await rooms.kick(m.id)
    showNotice('Участник выгнан')
  } catch (e) {
    showNotice(errorText(e), true)
  } finally {
    busy.value = false
  }
}

async function toggleInvite() {
  inviteOpen.value = !inviteOpen.value
  if (!inviteOpen.value || friends.value) return
  try {
    friends.value = (await api.friendsList()).friends
  } catch (e) {
    showNotice(errorText(e), true)
    inviteOpen.value = false
  }
}

async function invite(f: Profile) {
  busy.value = true
  try {
    await rooms.invite(f.id)
    invited.value = new Set(invited.value).add(f.id)
    showNotice(`Приглашение отправлено: ${f.nick}`)
  } catch (e) {
    showNotice(errorText(e), true)
  } finally {
    busy.value = false
  }
}

async function copyLink() {
  const link = roomLink(id.value, (roomId) => router.resolve({ name: 'room', params: { id: roomId } }).href)
  try {
    await navigator.clipboard.writeText(link)
    showNotice('Ссылка скопирована')
  } catch {
    window.prompt('Скопируй ссылку на комнату:', link)
  }
}
</script>
