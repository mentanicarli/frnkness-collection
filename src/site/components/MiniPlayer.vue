<template>
  <!-- Мини-плеер (плавающий) -->
  <div id="player" class="player fixed bottom-0 left-0 right-0 z-30" :class="{ visible: shown, 'room-guest': player.roomRole === 'guest', 'mini-idle': !player.currentRelease }">
    <div class="progress-container" @click="seekByClick">
      <div id="progress-bar" class="progress-bar" :style="{ width: `${player.progress}%` }"></div>
    </div>
    <div style="width: 100%; padding: 0 clamp(0.75rem, 2vw, 1.25rem);">
      <div class="py-3 flex items-center justify-between w-full" style="gap: clamp(0.5rem, 1.5vw, 1rem);">
        <div class="player-main flex items-center flex-1 min-w-0" style="gap: clamp(0.75rem, 2vw, 1rem);" @click="openFsFromMiniPlayer">
          <div id="player-cover" class="w-12 h-12 bg-[var(--bg-card)] flex-shrink-0 overflow-hidden" :class="{ 'playing-glow': player.isPlaying }">
            <img
              v-if="player.currentRelease"
              :key="player.trackStart?.n"
              loading="eager"
              fetchpriority="high"
              decoding="async"
              :src="player.currentRelease.cover" :srcset="coverSrcset(player.currentRelease.cover)" sizes="48px"
              class="w-full h-full object-cover"
              @error="hideBrokenImage"
            >
            <div v-if="player.currentRelease" class="cover-overlay">
              <button @click.stop="openFsPlayer" class="fullscreen-trigger-btn" aria-label="Открыть на весь экран">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              </button>
            </div>
          </div>
          <div class="min-w-0 flex items-center" style="gap: clamp(0.5rem, 1.5vw, 0.75rem);">
            <div class="min-w-0">
              <p id="player-track" class="truncate text-sm">{{ currentTrack?.title ?? (room.roomId ? 'Ничего не играет' : '') }}</p>
              <button v-if="player.playback === 'tap'" type="button" class="tap-to-play" data-testid="tap-to-play" @click.stop="togglePlay">Нажми, чтобы играть</button>
              <p v-else-if="player.playback === 'retrying'" class="text-xs text-[var(--fg-muted)] truncate" data-testid="playback-retrying">Связь пропала, пробуем снова…</p>
              <p v-else class="text-xs text-[var(--fg-muted)] truncate">frnk ness</p>
            </div>
            <button id="lyrics-btn" @click="goCurrentTrack" class="lyrics-action-btn sm:flex" :class="{ hidden: !player.currentRelease }" aria-label="Открыть текст">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <span>Текст</span>
            </button>
            <FavoriteButton v-if="player.currentTrackId" class="mini-fav" :track-id="player.currentTrackId" :size="18" />
            <!-- Ты в комнате: по нажатию — переход в неё. -->
            <RouterLink
              v-if="room.roomId"
              class="room-chip"
              :to="{ name: 'room', params: { id: room.roomId } }"
              :title="`Комната «${room.title}»`"
              data-testid="room-chip"
              @click.stop
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              <span class="room-chip-text">{{ chipLabel }} · {{ room.title }}</span>
            </RouterLink>
            <span v-if="room.roomId && room.hostState === 'away' && !room.isOwner" class="room-chip-wait" data-testid="room-chip-wait">Ждём хозяина</span>
          </div>
        </div>
        <div class="flex items-center flex-shrink-0" style="gap: clamp(0.375rem, 1.2vw, 0.75rem);">
          <button @click="prevTrack" class="play-btn player-prev-btn p-2 transition-colors" aria-label="Предыдущий трек">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
          </button>
          <button id="play-pause-btn" @click="togglePlay" class="play-btn w-10 h-10 rounded-full flex items-center justify-center relative" :class="{ 'playing-state': player.isPlaying }" aria-label="Воспроизвести">
            <svg id="icon-play" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" :class="{ hidden: player.isPlaying }"><path d="M8 5v14l11-7z" /></svg>
            <svg id="icon-pause" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" :class="{ hidden: !player.isPlaying }"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
          </button>
          <button @click="nextTrack" class="play-btn p-2 transition-colors" aria-label="Следующий трек">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
          </button>
        </div>
        <div class="hidden sm:flex items-center flex-1 justify-end ml-auto" style="gap: clamp(0.5rem, 1.5vw, 1rem);">
          <div class="flex items-center gap-2 text-xs text-[var(--fg-muted)] font-mono">
            <span id="time-current">{{ formatTime(player.currentSecond) }}</span>
            <span>/</span>
            <span id="time-total">{{ formatTime(player.duration) }}</span>
          </div>
          <div class="flex items-center gap-2 pl-4 border-l border-white/10">
            <button @click="toggleMute" class="text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Громкость">
              <svg id="volume-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path id="vol-wave-1" d="M15.54 8.46a5 5 0 0 1 0 7.07" :style="{ opacity: volumeWaves.first ? '1' : '0' }" />
                <path id="vol-wave-2" d="M19.07 4.93a10 10 0 0 1 0 14.14" :style="{ opacity: volumeWaves.second ? '1' : '0' }" />
              </svg>
            </button>
            <input type="range" id="volume-slider" min="0" max="1" step="0.01" :value="player.sliderValue" @input="onVolumeInput">
          </div>
          <button v-if="room.roomId && !room.isOwner && room.status === 'live'" class="room-leave-btn" type="button" data-testid="room-leave-mini" @click="leaveRoom">Выйти</button>
          <button @click="closeMiniPlayer()" class="close-player-btn p-1" aria-label="Закрыть плеер">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div class="flex sm:hidden items-center">
          <button @click="closeMiniPlayer()" class="close-player-btn p-2 text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Закрыть плеер">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <audio id="audio-player" ref="audioEl" preload="metadata"></audio>
</template>

<script setup lang="ts">
import { coverSrcset } from '@/utils/cover'
import { computed, onMounted, ref, watch } from 'vue'
import { formatTime } from '@/utils/helpers'
import { goTrack } from '../router'
import { hideBrokenImage } from '../composables/useCardHover'
import { player } from '../player/state'
import { openFsPlayer } from '../player/karaoke'
import { attachAudio, closeMiniPlayer, nextTrack, prevTrack, seekToFraction, setVolume, toggleMute, togglePlay } from '../player/engine'
import { volumeWavesFor } from '../player/volume'
import { RouterLink } from 'vue-router'
import { room, rooms } from '../rooms'
import { errorText } from '../social/api'
import { showNotice } from '../social/notice'
import FavoriteButton from './FavoriteButton.vue'

const audioEl = ref<HTMLAudioElement | null>(null)
onMounted(() => {
  if (audioEl.value) attachAudio(audioEl.value)
})

const currentTrack = computed(() => player.currentRelease?.tracks[player.currentTrackIndex] ?? null)
// В комнате мини-плеер виден всегда (даже пока ничего не играет): на нём метка комнаты.
const shown = computed(() => player.visible || Boolean(room.roomId))
const chipLabel = computed(() => {
  if (room.status === 'live') return room.linkDown ? 'Переподключаемся' : 'В комнате'
  if (room.status === 'connecting') return 'Подключаемся'
  return room.isOwner ? 'Вернуться в комнату' : 'Комната'
})
const volumeWaves = computed(() => volumeWavesFor(player.sliderValue, player.muted))

// Отступ страницы под мини-плеером.
watch(shown, (visible) => document.body.classList.toggle('mini-player-visible', visible), { immediate: true })

function seekByClick(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  seekToFraction((e.clientX - rect.left) / rect.width)
}

function onVolumeInput(e: Event) {
  setVolume(parseFloat((e.target as HTMLInputElement).value))
}

// Кнопка «Текст» — страница играющего трека.
function goCurrentTrack() {
  if (player.currentReleaseId) goTrack(player.currentReleaseId, player.currentTrackIndex)
}

async function leaveRoom() {
  try {
    await rooms.leave()
    showNotice('Ты вышел из комнаты')
  } catch (e) {
    showNotice(errorText(e), true)
  }
}

// На мобиле обложка и название в мини-плеере открывают полноэкранный плеер
// (оверлей по hover на тач-экране не работает). На десктопе клик ничего не делает.
const MOBILE_QUERY = '(max-width: 640px)'
function openFsFromMiniPlayer() {
  if (player.currentRelease && window.matchMedia(MOBILE_QUERY).matches) openFsPlayer()
}
</script>
