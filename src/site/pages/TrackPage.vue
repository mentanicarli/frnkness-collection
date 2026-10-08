<template>
  <!-- Страница трека: обложка, метаданные, описание, текст с разборами, соседние треки. -->
  <div id="page-track" ref="pageEl" class="page active">
    <div v-if="view" class="shell shell-narrow px-6 track-page-inner">
      <RouterLink class="track-back" :to="releaseRoute(view.releaseId)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        <span>{{ view.release.title }}</span>
      </RouterLink>

      <div class="track-hero">
        <div class="track-hero-cover">
          <img :key="view.release.cover" loading="eager" decoding="async" fetchpriority="high" :src="view.release.cover" :srcset="coverSrcset(view.release.cover)" sizes="(max-width: 640px) 60vw, 320px" :alt="view.release.title" @error="hideBrokenImage">
        </div>
        <div class="track-hero-main">
          <p class="track-hero-kind">{{ view.release.type === 'album' ? 'Альбом' : 'Сингл' }} • {{ view.release.releaseDate || view.release.year }}</p>
          <h1 class="track-hero-title">{{ view.track.title }}</h1>
          <p class="track-hero-artist">frnk ness</p>
          <p id="track-hero-meta" class="track-hero-meta">{{ heroMeta }}</p>
          <div class="track-hero-actions">
            <button class="track-play-btn" @click="playTrackByRef(view.releaseId, view.trackIndex, 'fade')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              <span>Слушать</span>
            </button>
            <button v-if="canShare" class="track-share-btn" data-testid="track-share" @click="shareTrack">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>
              <span>Поделиться</span>
            </button>
            <button class="track-share-btn" data-testid="track-copy-link" @click="copyLink">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              <span>{{ copied ? 'Ссылка скопирована' : 'Скопировать ссылку' }}</span>
            </button>
            <FavoriteButton class="track-hero-icon" :track-id="view.track.id" :size="18" />
            <AddToPlaylistButton class="track-hero-icon" :track-id="view.track.id" :size="18" />
          </div>
        </div>
      </div>

      <div id="track-dynamic">
        <template v-if="content">
          <TrackAbout :about="content.about" />
          <section class="track-section">
            <h2 class="track-section-title">Текст</h2>
            <div class="track-lyrics-body"><TrackLyrics :text="content.text" :note-map="content.noteMap" /></div>
          </section>
        </template>
        <section v-else class="track-section">
          <h2 class="track-section-title">Текст</h2>
          <div class="track-lyrics-body"><p class="track-lyrics-empty">Загружаем текст...</p></div>
        </section>
      </div>

      <section v-if="view.release.tracks.length >= 2" class="track-section">
        <h2 class="track-section-title">Другие треки релиза</h2>
        <div class="track-siblings">
          <template v-for="(t, i) in view.release.tracks" :key="t.id">
            <RouterLink v-if="i !== view.trackIndex" class="track-sibling" :to="trackRoute(view.releaseId, i)!">
              <span class="track-sibling-num">{{ String(t.num).padStart(2, '0') }}</span>
              <span class="track-sibling-title">{{ t.title }}</span>
            </RouterLink>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { coverSrcset } from '@/utils/cover'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { releases } from '@/config'
import type { Release, Track } from '@/types'
import { view as screen } from '../stores/view'
import { playTrackByRef } from '../player/engine'
import { findTrackRefBySlug } from '@/utils/slug'
import { trackShareUrl } from '@/utils/share'
import { canNativeShare, copyToClipboard, nativeShare } from '../share'
import { normalizeForSearch } from '@/utils/search'
import { buildNoteMap, type TrackNotes } from '@/utils/trackNotes'
import { updatePageAccent } from '../services/colors'
import { fetchTrackTxt, loadTrackNotes, notesKey } from '../services/lyricsFiles'
import { getTrackPlayCount } from '../services/stats'
import { pendingLineFocus } from '../services/lyricFocus'
import { releaseRoute, trackRoute } from '../router'
import { hideBrokenImage } from '../composables/useCardHover'
import TrackAbout from '../components/TrackAbout.vue'
import TrackLyrics from '../components/TrackLyrics.vue'
import FavoriteButton from '../components/FavoriteButton.vue'
import AddToPlaylistButton from '../components/AddToPlaylistButton.vue'

const route = useRoute()
const pageEl = ref<HTMLElement | null>(null)

interface View {
  releaseId: string
  trackIndex: number
  release: Release
  track: Track
}

// При переходе с трека на трек компонент тот же — содержимое меняет show().
const view = shallowRef<View | null>(null)
const content = shallowRef<{ about: string | null; text: string; noteMap: Map<string, string> } | null>(null)
const plays = ref(0)
const copied = ref(false)

const heroMeta = computed(() => {
  const v = view.value
  if (!v) return ''
  const base = `Трек ${v.track.num} из ${v.release.tracks.length}`
  return plays.value > 0 ? `${base} • ${plays.value} ${pluralPlays(plays.value)}` : base
})

function pluralPlays(count: number) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'прослушивание'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'прослушивания'
  return 'прослушиваний'
}

// Токен последней отрисовки: асинхронные куски (текст, разборы, счётчик)
// применяются только если пользователь ещё не ушёл на другой трек.
let renderToken = 0

async function show(releaseId: string, trackIndex: number) {
  const release = releases[releaseId]
  const track = release?.tracks[trackIndex]
  if (!release || !track) return

  const token = ++renderToken
  view.value = { releaseId, trackIndex, release, track }
  content.value = null
  plays.value = 0
  copied.value = false
  // Открытый на экране релиз; плеер (player.currentRelease*) не трогаем.
  screen.viewedReleaseId = releaseId
  void updatePageAccent(release.cover)
  window.scrollTo(0, 0)

  // Тот же файл, что грузит плеер: если трек играет, второго запроса не будет.
  const [notes, txt] = await Promise.all([loadTrackNotes(), fetchTrackTxt(release, track)])
  if (token !== renderToken) return
  const entry = (notes[notesKey(release, track)] ?? null) as TrackNotes | null
  content.value = { about: entry?.about ?? null, text: txt.trim() ? txt : '', noteMap: buildNoteMap(entry) }
  void applyPendingLineFocus()

  // Счётчик прослушиваний приходит позже и не блокирует отрисовку.
  void getTrackPlayCount(releaseId, trackIndex).then((n) => {
    if (token === renderToken) plays.value = n
  })
}

watch(
  () => (route.name === 'track' ? `${String(route.params.releaseId)}/${String(route.params.slug)}` : null),
  (key) => {
    if (!key) return
    const ref = findTrackRefBySlug(releases, String(route.params.releaseId), String(route.params.slug))
    if (ref) void show(ref.releaseId, ref.trackIndex)
  },
  { immediate: true }
)

// Переход из поиска к строке: ждём, пока на экране будет текст этого трека.
async function applyPendingLineFocus() {
  const request = pendingLineFocus.value
  const v = view.value
  if (!request || !v || !content.value || route.name !== 'track') return
  if (request.releaseId !== v.releaseId || request.trackIndex !== v.trackIndex) return
  pendingLineFocus.value = null
  await nextTick()
  const target = normalizeForSearch(request.line)
  const lines = pageEl.value?.querySelectorAll<HTMLElement>('.track-lyrics-body .lyric-line:not(.is-blank)') ?? []
  const found = Array.from(lines).find((el) => normalizeForSearch(el.textContent || '') === target)
  if (!found) return
  found.scrollIntoView({ block: 'center' })
  // Перезапуск анимации, если строку уже подсвечивали.
  found.classList.remove('lyric-line-found')
  void found.offsetWidth
  found.classList.add('lyric-line-found')
  setTimeout(() => found.classList.remove('lyric-line-found'), 2600)
}
watch(pendingLineFocus, () => void applyPendingLineFocus())

/** Ссылка для мессенджеров: страница с превью, а не «#/…» (его они не читают). */
function shareUrl(): string {
  const v = view.value
  return v ? trackShareUrl(v.releaseId, v.track) : window.location.href
}

const canShare = canNativeShare()
const shareTrack = () => nativeShare(`${view.value?.track.title ?? 'frnk ness'} — frnk ness`, shareUrl())

async function copyLink() {
  if (!(await copyToClipboard(shareUrl()))) return
  copied.value = true
  setTimeout(() => { copied.value = false }, 1600)
}
</script>
