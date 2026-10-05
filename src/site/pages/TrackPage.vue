<template>
  <!-- Страница трека: обложка, метаданные, описание, текст с разборами, соседние треки. -->
  <div id="page-track" ref="pageEl" class="page">
    <div v-if="view" class="shell shell-narrow px-6 track-page-inner">
      <RouterLink class="track-back" :to="releaseRoute(view.releaseId)">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
        <span>{{ view.release.title }}</span>
      </RouterLink>

      <div class="track-hero">
        <div class="track-hero-cover">
          <img :key="view.release.cover" loading="eager" decoding="async" fetchpriority="high" :src="view.release.cover" :alt="view.release.title" @error="hideBrokenImage">
        </div>
        <div class="track-hero-main">
          <p class="track-hero-kind">{{ view.release.type === 'album' ? 'Альбом' : 'Сингл' }} • {{ view.release.releaseDate || view.release.year }}</p>
          <h1 class="track-hero-title">{{ view.track.title }}</h1>
          <p class="track-hero-artist">frnk ness</p>
          <p id="track-hero-meta" class="track-hero-meta">{{ heroMeta }}</p>
          <div class="track-hero-actions">
            <button class="track-play-btn" @click="legacyBridge.playTrack(view.releaseId, view.trackIndex)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              <span>Слушать</span>
            </button>
            <button class="track-share-btn" @click="copyLink">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              <span>{{ copied ? 'Ссылка скопирована' : 'Скопировать ссылку' }}</span>
            </button>
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
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { releases } from '@/config'
import type { Release, Track } from '@/types'
import { runtimeState as state } from '@/runtime/sharedState'
import { legacyBridge } from '@/runtime/legacyBridge'
import { findTrackRefBySlug } from '@/utils/slug'
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

const route = useRoute()
const pageEl = ref<HTMLElement | null>(null)

interface View {
  releaseId: string
  trackIndex: number
  release: Release
  track: Track
}

// Страница остаётся смонтированной и после ухода с неё: показывает
// последний открытый трек.
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
  // Открытый на экране релиз; плеер (state.currentRelease*) не трогаем.
  state.viewedReleaseId = releaseId
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

async function copyLink() {
  const url = window.location.href
  const done = () => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  }
  try {
    await navigator.clipboard.writeText(url)
    done()
  } catch {
    // Clipboard API недоступен (http или отказ в доступе) — выделяем
    // адрес через временное поле, это работает везде.
    const input = document.createElement('input')
    input.value = url
    document.body.appendChild(input)
    input.select()
    try { document.execCommand('copy'); done() } catch { /* молча */ }
    document.body.removeChild(input)
  }
}
</script>
