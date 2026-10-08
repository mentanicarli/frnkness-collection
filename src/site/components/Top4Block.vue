<template>
  <section class="settings-section top4" aria-labelledby="u-top4" data-testid="top4">
    <div class="top4-head">
      <h2 id="u-top4">{{ own ? 'Мой топ-4' : 'Топ-4' }}</h2>
      <button v-if="own && rows !== null" class="acc-btn acc-btn-sm" type="button" data-testid="top4-edit" @click="emit('edit')">Изменить топ-4</button>
    </div>
    <p v-if="rows === null" class="acc-hint">Загрузка…</p>
    <template v-else>
      <ol class="top4-row" aria-label="Топ-4">
        <li v-for="(trackId, i) in slots" :key="i" class="top4-slot" data-testid="top4-slot" :data-empty="trackId ? 'false' : 'true'">
          <button v-if="trackId" class="top4-card" type="button" :class="{ playing: isPlaying(trackId) }" :aria-label="`Играть: ${info(trackId).title}`" @click="play(trackId)">
            <span class="top4-cover">
              <img v-if="info(trackId).cover" :src="info(trackId).cover!" alt="" loading="lazy" decoding="async">
              <span class="top4-n" aria-hidden="true">{{ i + 1 }}</span>
            </span>
            <span class="top4-title" data-testid="top4-title">{{ info(trackId).title }}</span>
          </button>
          <div v-else class="top4-card top4-empty" aria-label="Место свободно">
            <span class="top4-cover"><span class="top4-n" aria-hidden="true">{{ i + 1 }}</span></span>
            <span class="top4-title">—</span>
          </div>
        </li>
      </ol>
      <div v-if="!hasAny && own" data-testid="top4-empty">
        <EmptyHint title="Твой топ-4 пока пуст" text="Выбери до четырёх самых важных для тебя треков — не по прослушиваниям, а по сердцу. Их увидят все, кто зайдёт в твой профиль, и друзья узнают об этом в ленте.">
          <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" data-testid="hint-top4-pick" @click="emit('edit')">Выбрать треки</button>
        </EmptyHint>
      </div>
      <p v-else-if="!hasAny" class="acc-hint" data-testid="top4-empty">Топ-4 пока не заполнен.</p>
    </template>
  </section>
</template>

<script setup lang="ts">
// «Мой топ-4» на странице профиля: четыре обложки крупно в ряд, под ними
// название; по нажатию трек играет. Трек, пропавший из каталога, — пустое
// место, без ошибки. Названия выводятся интерполяцией (с экранированием).
import { computed } from 'vue'
import { releases } from '@/config'
import { player } from '../player/state'
import { playTrackByRef } from '../player/engine'
import type { Top4Row } from '../social/api'
import { top4Slots } from '../social/top4'
import EmptyHint from './EmptyHint.vue'
import { trackInfo } from '../social/tracks'

const props = defineProps<{
  /** null — ещё грузится. */
  rows: readonly Top4Row[] | null
  /** Это мой топ: можно изменить. */
  own: boolean
}>()
const emit = defineEmits<{ edit: [] }>()

const slots = computed(() => top4Slots(props.rows, releases))
const hasAny = computed(() => slots.value.some(Boolean))
const info = (trackId: string) => trackInfo(trackId)
const isPlaying = (trackId: string) => player.visible && player.currentTrackId === trackId

function play(trackId: string) {
  const t = trackInfo(trackId)
  if (t.releaseId) playTrackByRef(t.releaseId, t.trackIndex, 'fade')
}
</script>
