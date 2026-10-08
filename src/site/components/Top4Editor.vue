<template>
  <ModalFrame open label="Изменить топ-4" testid="top4-editor" box-class="top4-editor" @close="close">
    <div>
      <p id="top4-editor-title" class="acc-title" style="font-size: 1.125rem;">Изменить топ-4</p>
      <p class="acc-sub" style="margin-bottom: 0.875rem;">До четырёх самых значимых для тебя треков. Порядок задаётся перетаскиванием или кнопками ↑ ↓.</p>

      <ol class="top4-draft" aria-label="Твой топ-4">
        <li
          v-for="(trackId, i) in draft"
          :key="trackId"
          class="top4-draft-row"
          :class="{ 'drag-over': dragOver === i, unavailable: !info(trackId).available }"
          draggable="true"
          data-testid="top4-draft-row"
          @dragstart="onDragStart($event, i)"
          @dragover.prevent="dragOver = i"
          @dragleave="dragOver === i && (dragOver = null)"
          @drop.prevent="onDrop(i)"
          @dragend="dragFrom = dragOver = null"
        >
          <span class="top4-draft-n" aria-hidden="true">{{ i + 1 }}</span>
          <span class="tl-cover"><img v-if="info(trackId).cover" :src="info(trackId).cover!" alt="" loading="lazy" decoding="async"></span>
          <span class="tl-text">
            <span class="tl-title">{{ info(trackId).title }}</span>
            <span class="tl-sub">{{ info(trackId).available ? info(trackId).releaseTitle : 'Его больше нет в каталоге' }}</span>
          </span>
          <span class="tl-actions">
            <button class="fav-btn" type="button" :disabled="busy || i === 0" aria-label="Выше" title="Выше" data-testid="top4-up" @click="move(i, i - 1)">↑</button>
            <button class="fav-btn" type="button" :disabled="busy || i === draft.length - 1" aria-label="Ниже" title="Ниже" data-testid="top4-down" @click="move(i, i + 1)">↓</button>
            <button class="fav-btn" type="button" :disabled="busy" aria-label="Убрать из топ-4" title="Убрать" data-testid="top4-remove" @click="remove(i)">✕</button>
          </span>
        </li>
      </ol>
      <p v-if="!draft.length" class="acc-hint" data-testid="top4-draft-empty">Пока пусто. Найди трек ниже.</p>
      <p v-else-if="draft.length < TOP4_SIZE" class="acc-hint">Можно добавить ещё {{ TOP4_SIZE - draft.length }}.</p>

      <label class="acc-label" for="top4-search" style="display: block; margin-top: 0.875rem;">Найти трек в каталоге</label>
      <input
        id="top4-search"
        ref="input"
        v-model="query"
        class="acc-input"
        type="search"
        autocomplete="off"
        maxlength="80"
        placeholder="Название трека или релиза"
        :disabled="draft.length >= TOP4_SIZE"
        data-testid="top4-search"
      >
      <p v-if="draft.length >= TOP4_SIZE" class="acc-hint" style="margin-top: 0.375rem;">Уже четыре — убери один, чтобы добавить другой.</p>
      <ul v-if="query.trim() && draft.length < TOP4_SIZE" class="top4-hits" data-testid="top4-hits">
        <li v-for="hit in hits" :key="hit.trackId">
          <button class="top4-hit" type="button" :disabled="draft.includes(hit.trackId) || busy" data-testid="top4-hit" @click="add(hit.trackId)">
            <span class="tl-cover"><img :src="hit.cover" alt="" loading="lazy" decoding="async"></span>
            <span class="tl-text">
              <span class="tl-title">{{ hit.title }}</span>
              <span class="tl-sub">{{ hit.releaseTitle }}</span>
            </span>
            <span class="top4-hit-add" aria-hidden="true">{{ draft.includes(hit.trackId) ? '✓' : '+' }}</span>
          </button>
        </li>
        <li v-if="!hits.length" class="acc-hint" data-testid="top4-nohits">Ничего не нашлось.</li>
      </ul>

      <p v-if="error" class="acc-alert acc-alert-error" role="alert" style="margin-top: 0.75rem;" data-testid="top4-error">{{ error }}</p>
      <div class="acc-actions" style="justify-content: flex-end; margin-top: 1rem;">
        <button class="acc-btn acc-btn-sm" type="button" :disabled="busy" @click="close">Отмена</button>
        <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" :disabled="busy || !changed" data-testid="top4-save" @click="save">Сохранить</button>
      </div>
    </div>
  </ModalFrame>
</template>

<script setup lang="ts">
// Редактор «Мой топ-4»: поиск трека по каталогу, перетаскивание, удаление.
// Сохраняет весь список одним вызовом (top4_set): порядок массива — порядок мест.
import { computed, onMounted, ref } from 'vue'
import ModalFrame from './ModalFrame.vue'
import { releases } from '@/config'
import { api, errorText, type Top4Row } from '../social/api'
import { TOP4_SIZE, addToDraft, draftFromRows, moveInDraft, removeFromDraft, sameDraft, searchTracks } from '../social/top4'
import { trackInfo } from '../social/tracks'

const props = defineProps<{ rows: readonly Top4Row[] | null }>()
const emit = defineEmits<{ close: []; saved: [rows: Top4Row[]] }>()

const initial = draftFromRows(props.rows)
const draft = ref<string[]>([...initial])
const query = ref('')
const busy = ref(false)
const error = ref('')
const input = ref<HTMLInputElement | null>(null)
const dragFrom = ref<number | null>(null)
const dragOver = ref<number | null>(null)

const changed = computed(() => !sameDraft(draft.value, initial))
const hits = computed(() => searchTracks(releases, query.value, 8))
const info = (trackId: string) => trackInfo(trackId)

onMounted(() => input.value?.focus())

function close() {
  if (!busy.value) emit('close')
}

function add(trackId: string) {
  draft.value = addToDraft(draft.value, trackId)
  query.value = ''
  error.value = ''
}

function remove(index: number) {
  draft.value = removeFromDraft(draft.value, index)
  error.value = ''
}

function move(from: number, to: number) {
  draft.value = moveInDraft(draft.value, from, to)
}

function onDragStart(e: DragEvent, i: number) {
  dragFrom.value = i
  e.dataTransfer?.setData('text/plain', String(i))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDrop(to: number) {
  const from = dragFrom.value
  dragFrom.value = dragOver.value = null
  if (from !== null && from !== to) move(from, to)
}

async function save() {
  busy.value = true
  error.value = ''
  try {
    const rows = await api.top4Set(draft.value)
    emit('saved', rows ?? [])
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
</script>
