<template>
  <div id="page-release" class="page">
    <div class="shell px-6" style="padding-top: 1.5rem; padding-bottom: 0.5rem;">
      <BackButton />
      <div class="flex flex-col lg:flex-row gap-8 lg:gap-16" style="padding-bottom: 8.125rem;">
        <div class="lg:w-80 flex-shrink-0">
          <div id="release-cover" class="aspect-square overflow-hidden bg-[var(--bg-card)] mb-6">
            <template v-if="release">
              <div v-if="coverBroken" class="w-full h-full bg-[var(--bg-card)] flex items-center justify-center"><span class="text-[var(--fg-muted)]">Нет обложки</span></div>
              <img
                v-else
                :key="release.cover"
                loading="eager"
                fetchpriority="high"
                decoding="async"
                :src="release.cover"
                :alt="release.title"
                class="w-full h-full object-cover"
                @error="coverBroken = true"
              >
            </template>
          </div>
          <h1 id="release-title" class="text-3xl mb-3 leading-tight">{{ release?.title }}</h1>
          <p class="text-[var(--page-accent)] text-sm mb-3 tracking-wide lowercase">frnk ness</p>
          <p id="release-meta" class="text-sm text-[var(--fg-muted)] font-mono">{{ meta }}</p>
          <p id="release-plays" class="text-sm text-[var(--fg-muted)] font-mono mt-1.5" :class="{ hidden: !release || release.upcoming }">{{ playsText }}</p>
          <div id="download-container" class="mt-6" :class="{ hidden: !lyricsBook }">
            <a
              id="download-lyrics-btn"
              :href="lyricsBook?.href ?? '#'"
              :download="lyricsBook?.filename ?? ''"
              class="inline-flex items-center gap-2 text-xs px-5 py-2.5 transition-all group"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="group-hover:translate-y-0.5 transition-transform">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Lyrics Book</span>
            </a>
          </div>
        </div>
        <div class="flex-1 max-w-none xl:max-w-4xl">
          <div id="video-container" class="mb-10" :class="{ hidden: !release?.videoUrl }">
            <div class="flex items-center gap-4 mb-4">
              <h3 class="text-xs tracking-[0.2em] uppercase text-[var(--fg-muted)]">Видео</h3>
              <div class="flex-1 h-px bg-[var(--line)]"></div>
            </div>
            <div class="aspect-video overflow-hidden bg-[var(--bg-card)] border border-white/5">
              <iframe
                id="video-iframe"
                class="w-full h-full"
                :src="videoSrc"
                referrerpolicy="strict-origin-when-cross-origin"
                title="YouTube video player"
                frameborder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowfullscreen
              ></iframe>
            </div>
          </div>
          <div class="flex items-center gap-4 mb-5">
            <h3 class="text-xs tracking-[0.2em] uppercase text-[var(--fg-muted)]">Треклист</h3>
            <div class="flex-1 h-px bg-[var(--line)]"></div>
          </div>
          <!--
            Касание строки на телефоне запускает трек сразу по pointerdown
            (обработчик на #tracklist в legacy-слое), клик мышью — по click.
          -->
          <div id="tracklist">
            <template v-if="release">
              <div
                v-for="(t, i) in release.tracks"
                :key="t.id"
                class="track-row cursor-pointer group"
                :class="rowClass(i)"
                :data-track-index="i"
                @click="legacyBridge.handleTrackClick(i)"
              >
                <span class="track-num">
                  <span class="track-num-digit group-hover:hidden">{{ String(t.num).padStart(2, '0') }}</span>
                  <svg class="track-num-play hidden group-hover:block" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                </span>
                <div class="flex-1 min-w-0"><p class="track-title font-medium truncate">{{ t.title }}</p></div>
                <button @click.stop="goTrack(releaseId!, i)" class="lyrics-action-btn track-page-btn opacity-0 group-hover:opacity-100" aria-label="Страница трека">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  <span>Текст</span>
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { releases } from '@/config'
import { runtimeState as state } from '@/runtime/sharedState'
import { legacyBridge } from '@/runtime/legacyBridge'
import { lyricsBookFilename } from '@/utils/lyricsBook'
import { updatePageAccent } from '../services/colors'
import { getReleasePlayCount, lastChangedReleaseId, statsVersion } from '../services/stats'
import { goTrack } from '../router'
import BackButton from '../components/BackButton.vue'

const route = useRoute()

// Страница остаётся смонтированной и после ухода с неё: показывает
// последний открытый релиз.
const releaseId = ref<string | null>(null)
const release = computed(() => (releaseId.value ? releases[releaseId.value] ?? null : null))
const coverBroken = ref(false)
const playsText = ref('')
const videoSrc = ref('')
let videoTimer: ReturnType<typeof setTimeout> | null = null

const meta = computed(() => {
  const r = release.value
  if (!r) return ''
  if (r.upcoming) return 'Альбом • скоро...'
  return `${r.type === 'album' ? 'Альбом' : 'Сингл'} • ${r.releaseDate || r.year}`
})

const lyricsBook = computed(() => {
  const r = release.value
  return r && !r.upcoming && r.lyricsBookPath ? { href: r.lyricsBookPath, filename: lyricsBookFilename(r.title) } : null
})

// Подсветка строк — только если на экране открыт именно играющий релиз:
// иначе индекс играющего трека к этому списку отношения не имеет.
function rowClass(index: number) {
  const current = Boolean(
    releaseId.value &&
    releaseId.value === state.currentReleaseId &&
    state.miniPlayerVisible &&
    index === state.currentTrackIndex
  )
  return { playing: current, paused: current && !state.isPlaying }
}

function loadPlays(id: string, loadingText: string) {
  const r = releases[id]
  if (!r || r.upcoming) return
  playsText.value = loadingText
  void getReleasePlayCount(id).then((total) => {
    if (releaseId.value !== id || state.viewedReleaseId !== id) return
    playsText.value = `Прослушиваний ${r.type === 'album' ? 'альбома' : 'сингла'}: ${total}`
  })
}

// Открытие релиза (в том числе повторное — после чарта или главной).
// Меняет только «открытый» релиз: играющий трек принадлежит плееру.
function show(id: string) {
  const r = releases[id]
  if (!r) return
  releaseId.value = id
  coverBroken.value = false
  state.viewedReleaseId = id
  void updatePageAccent(r.cover)
  loadPlays(id, 'Счетчик прослушиваний загружается...')

  if (videoTimer !== null) clearTimeout(videoTimer)
  videoTimer = null
  if (r.videoUrl) {
    const url = r.videoUrl
    videoTimer = setTimeout(() => { videoSrc.value = url }, 50)
  } else {
    videoSrc.value = ''
  }
}

watch(
  () => (route.name === 'release' ? String(route.params.releaseId) : null),
  (id) => { if (id) show(id) },
  { immediate: true }
)

// Засчитали прослушивание открытому релизу — счётчик обновляется.
watch(statsVersion, () => {
  const id = releaseId.value
  if (id && state.viewedReleaseId === id && lastChangedReleaseId === id) {
    loadPlays(id, 'Счетчик прослушиваний обновляется...')
  }
})
</script>
