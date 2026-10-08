<template>
  <!-- Полноэкранный плеер: по умолчанию обложка, караоке по кнопке -->
  <div
    id="fullscreen-player"
    class="fullscreen-player"
    :class="{ open: karaoke.fsOpen, 'lyrics-open': karaoke.fsLyricsOpen, 'karaoke-open': karaokeOpen, 'no-karaoke-transition': noKaraokeTransition, 'room-guest': player.roomRole === 'guest' }"
  >
    <div id="fs-bg" class="fullscreen-bg"></div>
    <div class="fs-track-info">
      <h2 id="fs-track-title" class="fs-track-title">{{ currentTrack?.title ?? 'Название трека' }}</h2>
      <p class="fs-track-artist">frnk ness</p>
    </div>
    <div class="fs-header-buttons">
      <button
        id="fs-lyrics-toggle"
        ref="lyricsToggle"
        @click="onToggleLyrics"
        class="fs-header-btn"
        :class="{ active: lyricsVisible }"
        :aria-pressed="lyricsVisible ? 'true' : 'false'"
        aria-label="Текст песни"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      </button>
      <button @click="onClose" class="fs-header-btn" aria-label="Свернуть">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>
    <div class="fs-main-area">
      <div class="fs-cover-container">
        <div id="fs-cover" class="fs-cover">
          <img id="fs-cover-a" ref="coverA" class="fs-cover-img" src="" alt="Обложка" crossorigin="anonymous" loading="lazy">
          <img id="fs-cover-b" ref="coverB" class="fs-cover-img" src="" alt="Обложка" crossorigin="anonymous" loading="lazy">
        </div>
        <div class="fs-cover-meta">
          <h2 id="fs-cover-title">{{ currentTrack?.title ?? '—' }}</h2>
          <button v-if="player.playback === 'tap'" type="button" class="tap-to-play" data-testid="tap-to-play" @click="togglePlay">Нажми, чтобы играть</button>
          <p v-else-if="player.playback === 'retrying'" class="fs-cover-artist" data-testid="playback-retrying">Связь пропала, пробуем снова…</p>
          <p v-else class="fs-cover-artist">frnk ness</p>
          <div class="fs-cover-progress" @click="seekByClick">
            <div id="fs-progress-bar" :style="{ width: `${player.progress}%` }"></div>
          </div>
          <div class="fs-cover-times">
            <span id="fs-time-current">{{ formatTime(player.currentSecond) }}</span>
            <span id="fs-time-total">{{ formatTime(player.duration) }}</span>
          </div>
          <div class="fs-controls-inner">
            <button @click="prevTrack" class="fs-btn" aria-label="Предыдущий трек">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
            </button>
            <button id="fs-play-btn" @click="togglePlay" class="fs-btn fs-play-btn" :class="{ playing: player.isPlaying }" aria-label="Воспроизвести">
              <svg id="fs-icon-play" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" :style="{ display: player.isPlaying ? 'none' : 'block' }"><path d="M8 5v14l11-7z" /></svg>
              <svg id="fs-icon-pause" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" :style="{ display: player.isPlaying ? 'block' : 'none' }"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
            </button>
            <button @click="nextTrack" class="fs-btn" aria-label="Следующий трек">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
            </button>
          </div>
          <div class="fs-extra">
            <FavoriteButton :track-id="player.currentTrackId" :size="20" />
            <button
              class="fav-btn"
              :class="{ on: shuffleOn }"
              type="button"
              :disabled="Boolean(player.queue?.endless)"
              :aria-pressed="shuffleOn ? 'true' : 'false'"
              :aria-label="player.queue?.endless ? 'Поток — и так в случайном порядке' : 'Перемешать'"
              :title="player.queue?.endless ? 'Поток — и так в случайном порядке' : 'Перемешать'"
              data-testid="shuffle-btn"
              @click="toggleShuffle"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
            </button>
            <AddToPlaylistButton :track-id="player.currentTrackId" :size="20" />
          </div>
          <p v-if="queueLabel" class="fs-queue-label">{{ queueLabel }}</p>
        </div>
      </div>
      <div ref="lyricsPanel" class="fs-lyrics-panel">
        <div class="fs-lyrics-header">
          <h4 id="fs-lyrics-title" class="font-semibold text-sm">{{ currentTrack?.title ?? 'Текст песни' }}</h4>
          <div id="fs-lyrics-mode-switch" :class="karaoke.lines.length ? 'flex' : 'hidden'">
            <button @click="setLyricsMode('text')" id="fs-lyrics-mode-text" :class="modeButtonClass('text')">Текст</button>
            <button @click="setLyricsMode('karaoke')" id="fs-lyrics-mode-karaoke" :class="modeButtonClass('karaoke')">Караоке</button>
          </div>
        </div>
        <div id="fs-lyrics-body" ref="lyricsBody" class="fs-lyrics-body">
          <p v-if="karaoke.plainText === null" class="italic">Текст загружается...</p>
          <template v-else-if="karaoke.lines.length">
            <p v-for="(line, i) in karaoke.lines" :key="i" class="fs-lrc-line" :class="lineClass(i)" @click="seekTo(line.time)">{{ line.text || '...' }}</p>
          </template>
          <template v-else>
            <template v-for="(line, i) in plainLines" :key="i">
              <p v-if="!line" class="mb-2">&nbsp;</p>
              <p v-else :class="isSectionLabel(line) ? 'mb-2 lyrics-section-label' : 'mb-2'">{{ line }}</p>
            </template>
          </template>
        </div>
      </div>
    </div>
    <!-- скрытый блок: громкость в полноэкранном режиме (синхронна с мини-плеером) -->
    <div class="fs-controls">
      <div class="fs-progress-container" @click="seekByClick"></div>
      <div class="fs-time"></div>
      <div class="fs-volume-wrap">
        <input type="range" id="fs-volume-slider" min="0" max="1" step="0.01" :value="player.sliderValue" @input="onVolumeInput">
        <svg id="fs-volume-icon" width="0" height="0">
          <path id="fs-vol-wave-1" d="" :style="{ opacity: volumeWaves.first ? '1' : '0' }" />
          <path id="fs-vol-wave-2" d="" :style="{ opacity: volumeWaves.second ? '1' : '0' }" />
        </svg>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { formatTime } from '@/utils/helpers'
import { isSectionLabel } from '@/utils/trackNotes'
import { karaoke, player } from '../player/state'
import { closeFsPlayer, setLyricsMode, toggleFsLyrics } from '../player/karaoke'
import { nextTrack, prevTrack, seekTo, seekToFraction, setVolume, togglePlay, toggleShuffle } from '../player/engine'
import { volumeWavesFor } from '../player/volume'
import FavoriteButton from './FavoriteButton.vue'
import AddToPlaylistButton from './AddToPlaylistButton.vue'

const coverA = ref<HTMLImageElement | null>(null)
const coverB = ref<HTMLImageElement | null>(null)
const lyricsPanel = ref<HTMLElement | null>(null)
const lyricsBody = ref<HTMLElement | null>(null)
const lyricsToggle = ref<HTMLButtonElement | null>(null)

const currentTrack = computed(() => player.currentRelease?.tracks[player.currentTrackIndex] ?? null)
const shuffleOn = computed(() => Boolean(player.queue?.endless || player.queue?.shuffle))
// Откуда играет: плейлист, избранное, Поток (у релиза — без подписи).
const queueLabel = computed(() => {
  const source = player.queue?.source
  switch (source?.kind) {
    case 'playlist': return `Плейлист «${source.title}»`
    case 'favorites': return 'Избранное'
    case 'flow': return 'Поток'
    case 'favorites-flow': return 'Поток по избранному'
    default: return ''
  }
})
const karaokeOpen = computed(() => karaoke.fsLyricsOpen && karaoke.mode === 'karaoke')
const lyricsVisible = computed(() => karaoke.fsOpen && karaoke.fsLyricsOpen)
const volumeWaves = computed(() => volumeWavesFor(player.sliderValue, player.muted))
const plainLines = computed(() => (karaoke.plainText || 'Текст не найден').split('\n').map((l) => l.trim()))

// Под открытым плеером страница не прокручивается.
watch(() => karaoke.fsOpen, (open) => { document.body.style.overflow = open ? 'hidden' : '' })

// Выход из караоке: position:fixed на панели текстов сбрасывается мгновенно
// (CSS не анимирует position), и на один кадр выключается анимация панели —
// иначе панель на один paint остаётся поверх экрана.
const noKaraokeTransition = ref(false)
watch(karaokeOpen, (open, wasOpen) => {
  if (open || !wasOpen) return
  const panel = lyricsPanel.value
  if (panel) {
    panel.style.position = ''
    panel.style.inset = ''
  }
  noKaraokeTransition.value = true
  requestAnimationFrame(() => { noKaraokeTransition.value = false })
})

function onToggleLyrics() {
  toggleFsLyrics()
  lyricsToggle.value?.blur()
}

function onClose() {
  closeFsPlayer()
  lyricsToggle.value?.blur()
}

function seekByClick(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  seekToFraction((e.clientX - rect.left) / rect.width)
}

function onVolumeInput(e: Event) {
  setVolume(parseFloat((e.target as HTMLInputElement).value))
}

function modeButtonClass(mode: 'text' | 'karaoke') {
  const on = karaoke.mode === mode
  return { 'bg-white/10': on, 'text-[var(--fg)]': on, 'text-[var(--fg-muted)]': !on }
}

// Подсветка строк караоке: текущая и три соседние с затуханием.
function lineClass(i: number) {
  const d = Math.abs(i - karaoke.currentIndex)
  if (karaoke.currentIndex < 0) return ''
  if (d === 0) return 'active'
  if (!karaoke.gradient) return ''
  return d === 1 ? 'd1' : d === 2 ? 'd2' : d === 3 ? 'd3' : ''
}

// ── Прокрутка текста ────────────────────────────────────────────────────

// Новый текст или режим — панель в начало.
watch(() => karaoke.renderVersion, async () => {
  await nextTick()
  if (lyricsBody.value) lyricsBody.value.scrollTop = 0
})

function scrollToLine(index: number, behavior: ScrollBehavior) {
  const container = lyricsBody.value
  const active = container?.querySelectorAll<HTMLElement>('.fs-lrc-line')[index]
  if (!container || !active || !container.clientHeight) return
  const targetTop = active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const clampedTop = Math.max(0, Math.min(targetTop, maxTop))
  if (Math.abs(container.scrollTop - clampedTop) > 8) container.scrollTo({ top: clampedTop, behavior })
}

watch(() => karaoke.scrollRequest, async (req) => {
  if (!req) return
  await nextTick()
  requestAnimationFrame(() => scrollToLine(req.index, req.behavior))
})

// ── Обложка: смена со сдвигом (next/prev) или сразу ─────────────────────

let slot: 'a' | 'b' = 'a'
let animating = false

function animateCover(src: string, dir: 'next' | 'prev' | 'fade' | null) {
  const a = coverA.value
  const b = coverB.value
  if (!a || !b) return
  const active = slot === 'a' ? a : b
  const inactive = slot === 'a' ? b : a

  if (animating) {
    active.classList.remove('enter-left', 'enter-right')
    active.classList.add('active')
    inactive.classList.remove('active', 'exit-left', 'exit-right')
  }
  animating = true

  if (!dir) {
    active.src = src
    active.classList.add('active')
    active.classList.remove('exit-left', 'exit-right', 'enter-left', 'enter-right')
    inactive.classList.remove('active', 'exit-left', 'exit-right')
    animating = false
    return
  }

  inactive.src = src
  const [exitClass, enterClass] = dir === 'next' ? ['exit-left', 'enter-right'] : ['exit-right', 'enter-left']
  active.classList.remove('playing')
  inactive.classList.remove('playing')
  active.classList.remove('exit-left', 'exit-right', 'enter-left', 'enter-right')
  inactive.classList.remove('active', 'exit-left', 'exit-right', 'enter-left', 'enter-right')
  inactive.classList.add(enterClass)

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      active.classList.remove('active')
      active.classList.add(exitClass)
      inactive.classList.remove(enterClass)
      inactive.classList.add('active')
      slot = slot === 'a' ? 'b' : 'a'
      if (player.isPlaying) inactive.classList.add('playing')
      setTimeout(() => {
        animating = false
        active.classList.remove(exitClass)
      }, 650)
    })
  })
}

watch(() => player.trackStart, (start) => {
  if (start) animateCover(start.cover, start.direction)
})

// «Дыхание» обложки во время воспроизведения — только у видимой.
watch(() => player.isPlaying, (playing) => {
  const active = slot === 'a' ? coverA.value : coverB.value
  const inactive = slot === 'a' ? coverB.value : coverA.value
  active?.classList.toggle('playing', playing)
  inactive?.classList.remove('playing')
})
</script>
