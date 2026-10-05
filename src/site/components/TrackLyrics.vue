<template>
  <!--
    Текст песни с разборами: строка с разбором раскрывает его по клику или
    Enter/пробелу. Тот же компонент — в предпросмотре админки: там
    lineClass подсвечивает звучащую строку, а line-click перематывает к ней.
  -->
  <p v-if="!text" class="track-lyrics-empty">Текст будет позже...</p>
  <template v-for="row in rows" v-else :key="row.key">
    <p v-if="row.kind === 'blank'" class="lyric-line is-blank">&nbsp;</p>
    <p v-else-if="row.kind === 'section'" class="lyric-section">{{ row.text }}</p>
    <p
      v-else-if="!row.noteId"
      class="lyric-line"
      :class="lineClass?.(row.lineNo)"
      :data-line="lineClass ? row.lineNo : undefined"
      @click="emit('line-click', row.lineNo)"
    >{{ row.text }}</p>
    <template v-else>
      <p
        class="lyric-line has-note"
        :class="[{ open: openNotes.has(row.noteId) }, lineClass?.(row.lineNo)]"
        role="button"
        tabindex="0"
        :aria-expanded="openNotes.has(row.noteId) ? 'true' : 'false'"
        :aria-controls="row.noteId"
        :data-note-target="row.noteId"
        :data-line="lineClass ? row.lineNo : undefined"
        @click="toggle(row.noteId); emit('line-click', row.lineNo)"
        @keydown.enter.prevent="toggle(row.noteId)"
        @keydown.space.prevent="toggle(row.noteId)"
      >{{ row.text }}</p>
      <div :id="row.noteId" class="lyric-note" :hidden="!openNotes.has(row.noteId)">{{ row.note }}</div>
    </template>
  </template>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { layoutLyrics } from '@/utils/trackNotes'

const props = defineProps<{
  /** Текст песни; пустой — «Текст будет позже...». */
  text: string
  /** Разборы: нормализованная строка → текст разбора (buildNoteMap). */
  noteMap: Map<string, string>
  /** Дополнительные классы строки песни по её номеру (только строки, без пустых и меток). */
  lineClass?: (lineNo: number) => Record<string, boolean>
}>()
const emit = defineEmits<{ 'line-click': [lineNo: number] }>()

type Row =
  | { kind: 'blank'; key: string }
  | { kind: 'section'; key: string; text: string }
  | { kind: 'line'; key: string; text: string; lineNo: number; noteId: string | null; note: string | null }

// Разбор достаётся только первому вхождению строки (см. layoutLyrics).
const rows = computed<Row[]>(() => {
  let lineNo = 0
  let noteIndex = 0
  return layoutLyrics(props.text, props.noteMap).map((row, i): Row => {
    if (row.kind === 'blank') return { kind: 'blank', key: `b${i}` }
    if (row.kind === 'section') return { kind: 'section', key: `s${i}`, text: row.text }
    const noteId = row.note ? `lyric-note-${noteIndex++}` : null
    return { kind: 'line', key: `l${i}`, text: row.text, lineNo: lineNo++, noteId, note: row.note }
  })
})

// Раскрытые разборы; новый текст — всё свёрнуто.
const openNotes = ref(new Set<string>())
watch(() => [props.text, props.noteMap], () => { openNotes.value = new Set() })

function toggle(id: string) {
  const next = new Set(openNotes.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openNotes.value = next
}
</script>
