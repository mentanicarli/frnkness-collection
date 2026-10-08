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
    <Transition name="menu-pop">
      <div v-if="open" class="user-menu-list" role="menu" data-testid="user-menu-list" @click="open = false">
        <!-- Карточка: аватар, ник, тег; нажатие — мой профиль -->
        <RouterLink class="menu-card" role="menuitem" :to="session.user.nick ? { name: 'user', params: { nick: session.user.nick } } : { name: 'me' }" data-testid="menu-profile">
          <UserAvatar :avatar="session.user.avatar" :nick="session.user.nick" :user-id="session.user.id" :size="2.75" :cover-of="coverOf" />
          <span class="menu-card-text">
            <NickWithTag class="menu-card-nick" :user-id="session.user.id" :nick="session.user.nick || 'Профиль'" />
            <span class="menu-card-sub">Мой профиль</span>
          </span>
          <MenuIcon name="chevron" />
        </RouterLink>

        <RouterLink v-if="recapStore.state" class="menu-item menu-item-recap" role="menuitem" :to="{ name: 'recap', params: { year: recapStore.state.year } }" data-testid="menu-recap"><MenuIcon name="star" />Итоги {{ recapStore.state.year }}</RouterLink>

        <div class="menu-group" role="group">
          <RouterLink class="menu-item" role="menuitem" :to="{ name: 'favorites' }"><MenuIcon name="heart" />Избранное</RouterLink>
          <RouterLink class="menu-item" role="menuitem" :to="{ name: 'playlists' }"><MenuIcon name="playlist" />Мои плейлисты</RouterLink>
        </div>

        <div class="menu-group" role="group">
          <RouterLink class="menu-item" role="menuitem" :to="{ name: 'friends' }">
            <MenuIcon name="friends" />Друзья<span v-if="pending" class="badge menu-item-badge">{{ pending }}</span>
          </RouterLink>
          <RouterLink class="menu-item" role="menuitem" :to="{ name: 'feed' }" data-testid="menu-feed"><MenuIcon name="feed" />Лента</RouterLink>
        </div>

        <div class="menu-group" role="group">
          <RouterLink v-if="room.roomId" class="menu-cta" role="menuitem" :to="{ name: 'room', params: { id: room.roomId } }" data-testid="menu-room"><MenuIcon name="enter" />Вернуться в комнату «{{ room.title }}»</RouterLink>
          <button v-else class="menu-cta" role="menuitem" type="button" data-testid="menu-create-room" @click="openCreateRoom"><MenuIcon name="plus" />Создать комнату</button>
        </div>

        <div class="menu-group menu-group-quiet" role="group">
          <RouterLink class="menu-item" role="menuitem" :to="{ name: 'me' }"><MenuIcon name="settings" />Настройки</RouterLink>
          <button class="menu-item" role="menuitem" type="button" data-testid="menu-feedback" @click="openFeedback"><MenuIcon name="flag" />Сообщить о проблеме</button>
          <a v-if="isAdminRole(session.user.role)" class="menu-item" role="menuitem" href="./admin.html"><MenuIcon name="shield" />Админка</a>
        </div>

        <div class="menu-group" role="group">
          <button class="menu-item menu-item-danger" role="menuitem" type="button" data-testid="menu-logout" @click="askLogout"><MenuIcon name="logout" />Выйти</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { releases } from '@/config'
import { session } from '@/site/session'
import { pendingCount } from '@/site/social/friends'
import { recapStore } from '@/site/recap/store'
import { openCreateRoom, room } from '@/site/rooms'
import { openFeedback } from '@/site/feedback/store'
import UserAvatar from './UserAvatar.vue'
import NickWithTag from './NickWithTag.vue'
import MenuIcon from './MenuIcon.vue'
import { askLogout } from '../logout'
import { isAdminRole } from '../../../supabase/functions/_shared/accounts.ts'

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
</script>
