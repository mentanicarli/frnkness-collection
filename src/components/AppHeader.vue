<template>
  <header>
    <div
      style="height: 3.875rem; display: flex; align-items: center; justify-content: space-between; padding: 0 clamp(1rem, 2.4vw, 3rem); width: 100%; position: relative;"
    >
      <button @click="showHome" class="flex items-center gap-2 group" aria-label="На главную">
        <span class="text-lg text-white/95 group-hover:text-white transition-colors">frnk ness</span>
        <span class="font-mono text-[0.5625rem] tracking-[0.2em] uppercase text-[var(--fg-faint)]">collection</span>
      </button>

      <!-- inline search field (раскрывается между логотипом и кнопками) -->
      <div id="header-search-panel" class="header-search-panel" :class="{ open: search.open }" @click.stop>
        <div class="header-search-inner">
          <div class="header-search-input-wrap">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="7"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              id="global-search"
              ref="input"
              type="search"
              placeholder="Искать трек, альбом или строку из текста..."
              aria-label="Глобальный поиск"
              :value="search.input"
              @input="onInput"
            >
            <button @click="setSearchOpen(false)" class="flex items-center justify-center w-7 h-7 rounded text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors" aria-label="Закрыть поиск">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
          <!-- Пустой запрос — пустой контейнер: панель без отступов и тени (CSS по :empty). -->
          <div id="search-results" class="header-search-results"><template v-if="search.query">
            <p v-if="!search.results.length" class="text-sm text-[var(--fg-faint)] font-mono py-2">Ничего не найдено.</p>
            <template v-else>
              <p class="font-mono text-xs text-[var(--fg-faint)] mb-2">Результатов: {{ search.results.length }}</p>
              <button
                v-for="(item, index) in search.results"
                :key="`${item.type}|${item.releaseId}|${item.trackIndex}|${item.line}|${index}`"
                class="w-full text-left rounded-md hover:bg-[var(--bg-2)] transition-colors p-3 mb-0.5 flex items-center justify-between gap-4"
                @click="openResult(item)"
              >
                <div class="min-w-0">
                  <p class="text-sm font-semibold text-[var(--fg)] truncate">{{ item.title }}</p>
                  <p v-if="item.trackTitle" class="text-xs text-[var(--fg-muted)] mt-1">{{ item.trackTitle }}</p>
                  <p v-if="item.line" class="text-xs text-[var(--fg-muted)] mt-1 line-clamp-2 italic">{{ item.line }}</p>
                </div>
                <span class="font-mono text-[0.5625rem] uppercase tracking-wider text-[var(--fg-faint)] flex-shrink-0 border border-white/10 rounded px-2 py-1">{{ BADGES[item.type] }}</span>
              </button>
            </template>
          </template></div>
        </div>
      </div>

      <nav class="flex items-center gap-2">
        <button
          id="search-toggle-btn"
          class="chart-btn header-animated-btn flex items-center justify-center transition-all"
          :class="{ active: search.open }"
          :style="{ display: search.open ? 'none' : '' }"
          aria-label="Поиск"
          @click.stop="toggleSearch"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
        <button
          id="header-chart-btn"
          @click="openChartFromInteraction"
          class="chart-btn header-animated-btn flex items-center gap-2 px-5 transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
          <span>Чарт</span>
        </button>
      </nav>
    </div>

    <div id="search-backdrop" class="search-backdrop" @click="setSearchOpen(false)"></div>
  </header>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { releases } from '@/config'
import { legacyBridge } from '@/runtime/legacyBridge'
import { debounce } from '@/utils/helpers'
import { goChart, goHome, goRelease, goTrack } from '@/site/router'
import { focusLyricLine } from '@/site/services/lyricFocus'
import type { SearchHit } from '@/site/services/searchIndex'
import { runSearch, search, setSearchOpen, toggleSearch } from '@/site/stores/search'

const BADGES: Record<SearchHit['type'], string> = { release: 'Релиз', track: 'Трек', lyric: 'Строка' }

const showHome = () => goHome()
let lastChartOpenAt = 0
const openChartFromInteraction = (event: MouseEvent | PointerEvent) => {
  const now = performance.now()
  if (now - lastChartOpenAt < 250) return
  if (event.type === 'pointerdown') {
    event.preventDefault()
  }
  lastChartOpenAt = now
  goChart()
}

// ── Поиск ───────────────────────────────────────────────────────────────

const input = ref<HTMLInputElement | null>(null)
// Значение берём в момент поиска: если поиск успели закрыть, поле уже пустое.
const searchDebounced = debounce(() => runSearch(search.input), 180)

function onInput(e: Event) {
  search.input = (e.target as HTMLInputElement).value
  searchDebounced()
}

watch(() => search.open, (open) => {
  if (open) requestAnimationFrame(() => input.value?.focus())
})

// Клик мимо панели закрывает поиск; кнопка «Чарт» — нет (она сама уводит на чарт).
function onDocumentClick(e: MouseEvent) {
  if ((e.target as Element | null)?.closest?.('#header-chart-btn')) return
  setSearchOpen(false)
}
onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))

function openResult(item: SearchHit) {
  const release = releases[item.releaseId]
  if (!release) return
  setSearchOpen(false)
  const { releaseId, trackIndex, time, line } = item

  if (item.type === 'lyric' && trackIndex >= 0 && release.tracks[trackIndex]) {
    if (Number.isFinite(time) && time >= 0) {
      // Есть .lrc: трек с этой строки, полноэкранный плеер в караоке.
      goRelease(releaseId)
      legacyBridge.playLyricAt(releaseId, trackIndex, time)
    } else {
      // Нет .lrc: страница трека, прокрутка к строке, трек не запускаем.
      goTrack(releaseId, trackIndex)
      if (line) focusLyricLine(releaseId, trackIndex, line)
    }
    return
  }

  goRelease(releaseId)
  if (item.type === 'release' || trackIndex < 0) return
  // Трек запускаем явно по (релиз, индекс): страница релиза плеер не трогает.
  legacyBridge.playTrack(releaseId, trackIndex)
}
</script>
