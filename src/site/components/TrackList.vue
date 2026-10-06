<template>
  <ol class="tl" :aria-label="label">
    <li
      v-for="(item, i) in rows"
      :key="item.key"
      class="tl-row"
      :class="{ playing: isPlaying(item.trackId), unavailable: !item.info.available, 'drag-over': dragOver === i }"
      :draggable="editable && !busy ? 'true' : 'false'"
      data-testid="track-row"
      @dragstart="onDragStart($event, i)"
      @dragover.prevent="dragOver = i"
      @dragleave="dragOver === i && (dragOver = null)"
      @drop.prevent="onDrop(i)"
      @dragend="dragFrom = dragOver = null"
    >
      <span v-if="editable" class="tl-handle" aria-hidden="true" title="Перетащи, чтобы переставить">⋮⋮</span>
      <span v-else class="tl-num">{{ numbered ? i + 1 : '' }}</span>
      <button class="tl-main" type="button" :disabled="!item.info.available" @click="emit('play', i)">
        <span class="tl-cover"><img v-if="item.info.cover" :src="item.info.cover" alt="" loading="lazy" decoding="async"></span>
        <span class="tl-text">
          <span class="tl-title">{{ item.info.title }}</span>
          <span class="tl-sub">{{ item.info.available ? item.info.releaseTitle : 'Его больше нет в каталоге' }}<template v-if="item.extra"> · {{ item.extra }}</template></span>
        </span>
      </button>
      <span class="tl-actions">
        <template v-if="item.info.available">
          <FavoriteButton :track-id="item.trackId" />
          <AddToPlaylistButton :track-id="item.trackId" />
        </template>
        <template v-if="editable">
          <button class="fav-btn" type="button" :disabled="busy || i === 0" aria-label="Выше" title="Выше" @click="emit('move', i, i - 1)">↑</button>
          <button class="fav-btn" type="button" :disabled="busy || i === rows.length - 1" aria-label="Ниже" title="Ниже" @click="emit('move', i, i + 1)">↓</button>
          <button class="fav-btn" type="button" :disabled="busy" aria-label="Убрать из плейлиста" title="Убрать из плейлиста" @click="emit('remove', i)">✕</button>
        </template>
      </span>
    </li>
  </ol>
</template>

<script setup lang="ts">
// Список треков по id: избранное, плейлист, топ. Недоступные треки (их
// нет в каталоге) видны серыми и не запускаются. В режиме правки —
// перетаскивание и кнопки ↑/↓ (на телефоне перетаскивания нет).
import { computed, ref } from 'vue'
import { player } from '../player/state'
import { type QueueSource, sameSource } from '../player/queue'
import { trackInfo } from '../social/tracks'
import FavoriteButton from './FavoriteButton.vue'
import AddToPlaylistButton from './AddToPlaylistButton.vue'

const props = withDefaults(
  defineProps<{
    trackIds: readonly string[]
    /** Подпись к строке (например, «12 прослушиваний»), по индексу. */
    extras?: readonly string[]
    /** Источник очереди этого списка — для подсветки играющего трека. */
    source?: QueueSource | null
    editable?: boolean
    busy?: boolean
    numbered?: boolean
    label?: string
  }>(),
  { extras: () => [], source: null, editable: false, busy: false, numbered: true, label: 'Треки' }
)
const emit = defineEmits<{ play: [index: number]; remove: [index: number]; move: [from: number, to: number] }>()

const rows = computed(() => props.trackIds.map((trackId, i) => ({ key: `${trackId}#${i}`, trackId, info: trackInfo(trackId), extra: props.extras[i] ?? '' })))

const isPlaying = (trackId: string) =>
  player.visible && player.currentTrackId === trackId && (!props.source || sameSource(player.queue?.source, props.source))

const dragFrom = ref<number | null>(null)
const dragOver = ref<number | null>(null)

function onDragStart(e: DragEvent, i: number) {
  if (!props.editable) return
  dragFrom.value = i
  e.dataTransfer?.setData('text/plain', String(i))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDrop(to: number) {
  const from = dragFrom.value
  dragFrom.value = dragOver.value = null
  if (from !== null && from !== to) emit('move', from, to)
}
</script>
