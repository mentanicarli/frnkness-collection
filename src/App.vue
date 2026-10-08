<template>
  <div v-if="!session.ready" class="acc-shell" aria-busy="true"><span class="acc-spinner" aria-label="Загрузка"></span></div>
  <template v-else>
    <AppHeader v-if="!bare" />
    <main class="min-h-screen relative z-10">
      <RouterView />
    </main>
    <!-- Плеер монтируется один раз после первого входа (attachAudio — раз за
         жизнь страницы) и прячется на экранах входа. -->
    <div v-if="playerMounted" v-show="!bare">
      <FullscreenPlayer />
      <MiniPlayer />
    </div>
    <template v-if="session.user">
      <AddToPlaylistDialog />
      <TrackMenuSheet />
      <CreateRoomDialog />
      <FeedbackDialog />
      <LogoutDialog />
      <NoticeToast />
      <RecapBanner />
    </template>
  </template>
</template>

<script setup lang="ts">
// Корень сайта: шапка, открытая страница (по адресу #/…) и плеер.
// Без входа — только заставка и экраны входа (стена — в router.ts).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { session } from '@/site/session'
import { welcomeLocation } from '@/site/auth/redirect'
import { closeMiniPlayer } from '@/site/player/engine'
import { goAfterLogin } from '@/site/router'
import AppHeader from '@/site/components/AppHeader.vue'
import FullscreenPlayer from '@/site/components/FullscreenPlayer.vue'
import MiniPlayer from '@/site/components/MiniPlayer.vue'
import AddToPlaylistDialog from '@/site/components/AddToPlaylistDialog.vue'
import TrackMenuSheet from '@/site/components/TrackMenuSheet.vue'
import CreateRoomDialog from '@/site/components/CreateRoomDialog.vue'
import FeedbackDialog from '@/site/components/FeedbackDialog.vue'
import LogoutDialog from '@/site/components/LogoutDialog.vue'
import NoticeToast from '@/site/components/NoticeToast.vue'
import RecapBanner from '@/site/recap/RecapBanner.vue'
import { bindRoomsToSession } from '@/site/rooms'
import { bindSocialToSession } from '@/site/social/session'
import { resetPageAccent } from '@/site/services/colors'
import { runSearch, search, setSearchOpen } from '@/site/stores/search'
import { view } from '@/site/stores/view'
import { karaoke } from '@/site/player/state'
import { closeFsPlayer } from '@/site/player/karaoke'
import { togglePlay } from '@/site/player/engine'

const route = useRoute()
const router = useRouter()

const bare = computed(() => !session.user || Boolean(route.meta.bare))
const playerMounted = ref(false)

// Избранное, плейлисты, индикатор заявок, «сейчас слушает» — по входу.
bindSocialToSession()
// Комната: вошли — вернуться в свою, вышли — забыть; переходы по сайту её не рвут.
bindRoomsToSession()

// Вошли — плеер; вышли (сами, истекла сессия, удалили или забанили) — музыка
// останавливается, с закрытого экрана уводим на заставку.
watch(
  () => session.user?.id ?? null,
  (id, prev) => {
    if (id) {
      playerMounted.value = true
      return
    }
    if (prev === undefined) return
    if (karaoke.fsOpen) closeFsPlayer()
    closeMiniPlayer(true)
    if (!route.meta.public) void router.replace(welcomeLocation(route.fullPath))
  },
  { immediate: true }
)

// Вошли в другой вкладке, пока здесь открыт экран входа: уходим с него, как только
// профиль загружен (флаги «сменить пароль» и «код восстановления» уже точные).
// Сам вход/регистрация в этой вкладке уходят с экрана сами (LoginPage, RegisterPage).
watch(
  () => (session.user && session.accountLoaded ? session.user.id : null),
  (id) => {
    if (id && route.meta.guestOnly) goAfterLogin(route.query.next)
  },
  { immediate: true }
)

// Смена экрана (не повтор того же адреса): наверх страницы, поиск
// закрывается (на главной — перечитывается), цвет страницы на главной —
// по умолчанию. Релиз и трек выставляют открытый релиз сами.
watch(
  () => (route.name ? `${String(route.name)}|${JSON.stringify(route.params)}` : null),
  (key) => {
    if (!key) return
    const name = route.name
    const isReleasePage = name === 'release' || name === 'track'
    document.body.classList.toggle('release-page', isReleasePage)
    if (!isReleasePage) view.viewedReleaseId = null
    window.scrollTo(0, 0)
    if (name === 'home') {
      resetPageAccent()
      runSearch(search.input)
    } else {
      setSearchOpen(false)
    }
  },
  { immediate: true }
)

// Горячие клавиши: Escape закрывает полноэкранный плеер или поиск,
// пробел (не в поле ввода и не на кнопке) — пауза/продолжить.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (karaoke.fsOpen) closeFsPlayer()
    else if (search.open) setSearchOpen(false)
  }
  const activeTag = document.activeElement ? document.activeElement.tagName : ''
  if (e.key === ' ' && !['BUTTON', 'INPUT', 'TEXTAREA'].includes(activeTag)) {
    e.preventDefault()
    togglePlay()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  // Обложки не «прогреваем» заранее: раньше здесь грузились 5 оригиналов (до 0,5 МБ каждый),
  // в том числе гостю на заставке, и занимали канал, пока рисуется первый экран.
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>
