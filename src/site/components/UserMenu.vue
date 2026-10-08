<template>
  <div v-if="session.user" ref="root" class="user-menu">
    <button
      class="user-menu-btn"
      type="button"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="menu"
      :aria-label="pending ? `Меню профиля, ждут ответа: ${pending}` : 'Меню профиля'"
      data-testid="user-menu"
      @click.stop="open = !open"
    >
      <UserAvatar :avatar="session.user.avatar" :nick="session.user.nick" :user-id="session.user.id" :size="2.25" :cover-of="coverOf" />
      <span v-if="pending" class="user-menu-badge" data-testid="friend-requests-badge">{{ pending > 9 ? '9+' : pending }}</span>
    </button>
    <div v-if="open" class="user-menu-list" role="menu" @click="open = false">
      <p class="nick">{{ session.user.nick || 'Профиль' }}</p>
      <RouterLink v-if="session.user.nick" role="menuitem" :to="{ name: 'user', params: { nick: session.user.nick } }">Мой профиль</RouterLink>
      <RouterLink v-if="recapStore.state" role="menuitem" :to="{ name: 'recap', params: { year: recapStore.state.year } }" data-testid="menu-recap">Итоги {{ recapStore.state.year }}</RouterLink>
      <RouterLink role="menuitem" :to="{ name: 'favorites' }">Избранное</RouterLink>
      <RouterLink role="menuitem" :to="{ name: 'playlists' }">Мои плейлисты</RouterLink>
      <RouterLink role="menuitem" :to="{ name: 'friends' }">
        Друзья<span v-if="pending" class="badge" style="margin-left: 0.5rem;">{{ pending }}</span>
      </RouterLink>
      <RouterLink role="menuitem" :to="{ name: 'feed' }" data-testid="menu-feed">Лента</RouterLink>
      <RouterLink v-if="room.roomId" role="menuitem" :to="{ name: 'room', params: { id: room.roomId } }" data-testid="menu-room">{{ room.isOwner ? 'Вернуться в комнату' : 'Комната' }} «{{ room.title }}»</RouterLink>
      <button v-if="!room.isOwner" role="menuitem" type="button" data-testid="menu-create-room" @click="openCreateRoom">Создать комнату</button>
      <RouterLink role="menuitem" :to="{ name: 'me' }">Настройки</RouterLink>
      <button role="menuitem" type="button" data-testid="menu-feedback" @click="openFeedback">Сообщить о проблеме</button>
      <a v-if="isAdminRole(session.user.role)" role="menuitem" href="./admin.html">Админка</a>
      <button role="menuitem" type="button" @click="logout">Выйти</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { releases } from '@/config'
import { session, signOut } from '@/site/session'
import { pendingCount } from '@/site/social/friends'
import { recapStore } from '@/site/recap/store'
import { openCreateRoom, room } from '@/site/rooms'
import { openFeedback } from '@/site/feedback/store'
import UserAvatar from './UserAvatar.vue'
import { isAdminRole } from '../../../supabase/functions/_shared/accounts.ts'

const router = useRouter()
const pending = computed(() => pendingCount())
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const coverOf = (id: string) => releases[id]?.cover ?? null

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

async function logout() {
  await signOut()
  void router.replace({ name: 'welcome' })
}
</script>
