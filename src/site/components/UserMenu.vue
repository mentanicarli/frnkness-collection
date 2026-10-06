<template>
  <div v-if="session.user" ref="root" class="user-menu">
    <button
      class="user-menu-btn"
      type="button"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="menu"
      :aria-label="friendRequests.incoming ? `Меню профиля, новых заявок в друзья: ${friendRequests.incoming}` : 'Меню профиля'"
      data-testid="user-menu"
      @click.stop="open = !open"
    >
      <UserAvatar :avatar="session.user.avatar" :nick="session.user.nick" :user-id="session.user.id" :size="2.25" :cover-of="coverOf" />
      <span v-if="friendRequests.incoming" class="user-menu-badge" data-testid="friend-requests-badge">{{ friendRequests.incoming > 9 ? '9+' : friendRequests.incoming }}</span>
    </button>
    <div v-if="open" class="user-menu-list" role="menu" @click="open = false">
      <p class="nick">{{ session.user.nick || 'Профиль' }}</p>
      <RouterLink v-if="session.user.nick" role="menuitem" :to="{ name: 'user', params: { nick: session.user.nick } }">Мой профиль</RouterLink>
      <RouterLink role="menuitem" :to="{ name: 'favorites' }">Избранное</RouterLink>
      <RouterLink role="menuitem" :to="{ name: 'playlists' }">Мои плейлисты</RouterLink>
      <RouterLink role="menuitem" :to="{ name: 'friends' }">
        Друзья<span v-if="friendRequests.incoming" class="badge" style="margin-left: 0.5rem;">{{ friendRequests.incoming }}</span>
      </RouterLink>
      <RouterLink role="menuitem" :to="{ name: 'me' }">Настройки</RouterLink>
      <a v-if="isAdminRole(session.user.role)" role="menuitem" href="./admin.html">Админка</a>
      <button role="menuitem" type="button" @click="logout">Выйти</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { releases } from '@/config'
import { session, signOut } from '@/site/session'
import { friendRequests } from '@/site/social/friends'
import UserAvatar from './UserAvatar.vue'
import { isAdminRole } from '../../../supabase/functions/_shared/accounts.ts'

const router = useRouter()
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
