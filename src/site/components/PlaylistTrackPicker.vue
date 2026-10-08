<template>
  <section class="pick-panel" aria-label="Добавить треки" data-testid="playlist-picker">
    <label class="sr-only" for="pl-pick-search">Поиск по каталогу</label>
    <input id="pl-pick-search" ref="input" v-model="query" class="acc-input" type="search" placeholder="Найти трек или релиз" autocomplete="off" data-testid="playlist-picker-search">
    <p v-if="full" class="acc-hint" data-testid="playlist-picker-full">В плейлисте уже {{ max }} треков — это предел.</p>
    <p v-else-if="!hits.length" class="acc-hint" data-testid="playlist-picker-empty">Ничего не найдено.</p>
    <ul v-if="hits.length" class="pick-list">
      <li v-for="t in hits" :key="t.trackId">
        <button
          class="pick-row"
          :class="{ added: has(t.trackId) }"
          type="button"
          :disabled="busy || has(t.trackId) || full"
          :aria-label="has(t.trackId) ? `${t.title} — уже в плейлисте` : `Добавить ${t.title}`"
          data-testid="playlist-picker-row"
          :data-added="has(t.trackId) ? 'true' : 'false'"
          @click="emit('add', t.trackId)"
        >
          <img v-if="t.cover" class="pick-cover" :src="t.cover" alt="" loading="lazy" decoding="async" width="40" height="40">
          <span class="pick-text">
            <span class="pick-title">{{ t.title }}</span>
            <span class="pick-sub">{{ t.releaseTitle }}</span>
          </span>
          <span class="pick-mark" aria-hidden="true">{{ has(t.trackId) ? '✓ в плейлисте' : '+ добавить' }}</span>
        </button>
      </li>
    </ul>
    <p v-if="more" class="acc-hint">Показаны первые {{ LIMIT }} — уточни запрос.</p>
  </section>
</template>

<script setup lang="ts">
// Добавление треков на странице плейлиста: поиск по каталогу, нажатие добавляет
// трек в конец, уже добавленные отмечены. Лимит и повторы проверяет и сервер.
import { computed, onMounted, ref } from 'vue'
import { searchTracks } from '../social/trackSearch'

const props = defineProps<{ existing: readonly string[]; busy: boolean; max: number }>()
const emit = defineEmits<{ add: [trackId: string] }>()

const LIMIT = 60
const query = ref('')
const input = ref<HTMLInputElement | null>(null)
onMounted(() => input.value?.focus())

const have = computed(() => new Set(props.existing))
const has = (id: string) => have.value.has(id)
const full = computed(() => props.existing.length >= props.max)
const all = computed(() => searchTracks(query.value).filter((t) => t.available))
const hits = computed(() => all.value.slice(0, LIMIT))
const more = computed(() => all.value.length > LIMIT)
</script>
