<template>
  <AppHeader />
  <main class="min-h-screen relative z-10">
    <RouterView />
  </main>
  <FullscreenPlayer />
  <MiniPlayer />
</template>

<script setup lang="ts">
// Корень сайта: шапка, открытая страница (по адресу #/…) и плеер.
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { releases } from '@/config'
import AppHeader from '@/site/components/AppHeader.vue'
import FullscreenPlayer from '@/site/components/FullscreenPlayer.vue'
import MiniPlayer from '@/site/components/MiniPlayer.vue'
import { resetPageAccent } from '@/site/services/colors'
import { runSearch, search, setSearchOpen } from '@/site/stores/search'
import { view } from '@/site/stores/view'
import { karaoke } from '@/site/player/state'
import { closeFsPlayer } from '@/site/player/karaoke'
import { runWhenIdle, togglePlay } from '@/site/player/engine'

const route = useRoute()

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
  // Прогрев первых обложек, когда браузер свободен.
  runWhenIdle(() => {
    Object.values(releases).slice(0, 5).forEach((release) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = release.cover
    })
  })
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>
