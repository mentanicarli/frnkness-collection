<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Тексты и разборы</h1>
            <p class="adm-sub">Текст песни, блок «О треке» и разборы строк. Предпросмотр рендерится тем же кодом, что страница трека на сайте.</p>
        </div>
    </div>

    <div v-if="repo.state.error" class="adm-alert adm-alert-error" role="alert">{{ repo.state.error }}</div>
    <div v-else-if="!repo.state.releases" class="adm-empty"><span class="adm-spinner"></span></div>

    <template v-else>
        <TrackPicker :releases="repo.state.releases" :release-id="releaseId" :track-index="trackIndex" :marker="marker" @select="select" />

        <div v-if="loadError" class="adm-alert adm-alert-error" role="alert" style="margin-top: 1rem">{{ loadError }}</div>
        <div v-else-if="loading" class="adm-empty"><span class="adm-spinner"></span></div>

        <template v-else-if="track && release && loaded">
            <div class="adm-row adm-track-meta">
                <span class="adm-small adm-faint adm-mono">{{ paths.txt }}</span>
                <span class="adm-spacer"></span>
                <a class="adm-link adm-small" :href="siteTrackUrl" target="_blank" rel="noopener">Открыть на сайте</a>
            </div>
            <DraftBanner :draft="draft.offer.value" :stale="draft.offerStale.value" @restore="draft.restore" @discard="draft.discard" />

            <AudioPlayer :player="player" :src="audioUrl" :path="paths.audio" sticky>
                <div class="adm-row adm-player-extra">
                    <span v-if="points.length" class="adm-player-now" data-testid="now-line" :title="nowText">
                        <span class="adm-faint">Сейчас:</span> {{ nowText }}
                    </span>
                    <span v-else class="adm-small adm-faint" data-testid="no-lrc">Караоке (.lrc) нет — без подсветки строк</span>
                    <span class="adm-spacer"></span>
                    <label class="adm-check adm-check-sm">
                        <input v-model="rewindOnResume" type="checkbox" />
                        Откат на {{ REWIND_SEC }} с после паузы
                    </label>
                    <label v-if="points.length" class="adm-check adm-check-sm">
                        <input v-model="follow" type="checkbox" />
                        Следить за строкой
                    </label>
                </div>
                <p class="adm-hint adm-player-keys" data-testid="player-keys">
                    <template v-for="(k, i) in PLAYER_KEYS" :key="k.code"><span v-if="i"> · </span><kbd>{{ k.label }}</kbd> {{ k.hint }}</template>
                    — работают и во время набора текста
                </p>
            </AudioPlayer>

            <div class="adm-segmented adm-editor-tabs" role="tablist" aria-label="Режим">
                <button v-if="!wide" type="button" role="tab" :aria-selected="tab === 'text'" :class="{ active: tab === 'text' }" @click="tab = 'text'">Текст</button>
                <button type="button" role="tab" :aria-selected="notesTabActive" :class="{ active: notesTabActive }" @click="tab = 'notes'">
                    Разборы<span v-if="annotationCount"> · {{ annotationCount }}</span>
                </button>
                <button type="button" role="tab" :aria-selected="rightTab === 'preview'" :class="{ active: rightTab === 'preview' }" @click="tab = 'preview'">Предпросмотр</button>
            </div>

            <div class="adm-editor" :class="{ wide }">
                <!-- Текст и описание -->
                <section v-show="wide || tab === 'text'" class="adm-editor-col">
                    <label class="adm-field">
                        <span class="adm-label">Текст песни</span>
                        <textarea
                            ref="textInput"
                            v-model="text"
                            class="adm-textarea adm-mono adm-lyrics-input"
                            :class="{ 'is-binding': bindingFor !== null }"
                            spellcheck="false"
                            rows="22"
                            aria-label="Текст песни"
                            @click="onTextClick"
                        ></textarea>
                    </label>
                    <details class="adm-hint adm-format-hint">
                        <summary>Как оформлять текст</summary>
                        <ul>
                            <li>Метки секций — отдельной строкой в квадратных скобках: <span class="adm-mono">[Припев]</span>, <span class="adm-mono">[Куплет 1]</span>, <span class="adm-mono">[Бридж]</span>. Они не подсвечиваются и не принимают разборы.</li>
                            <li>Между блоками — одна пустая строка.</li>
                            <li>Пустой файл — на сайте будет «Текст будет позже...».</li>
                            <li>Небольшая правка строки с разбором (опечатка, знак, слово) — разбор переезжает сам. Если строку удалить или переписать целиком, разбор «повиснет»: привяжи его к другой строке или удали.</li>
                        </ul>
                    </details>
                    <label class="adm-field" style="margin-top: 1rem">
                        <span class="adm-label">О треке</span>
                        <textarea v-model="about" class="adm-textarea" rows="6" aria-label="О треке" placeholder="Необязательно. Абзацы — через пустую строку."></textarea>
                        <span class="adm-hint">Абзацы разделяются пустой строкой.</span>
                    </label>
                </section>

                <!-- Разборы / предпросмотр -->
                <section v-show="wide || tab !== 'text'" class="adm-editor-col">
                    <template v-if="rightTab === 'notes'">
                        <div v-if="dangling.length" class="adm-alert adm-alert-warn" data-testid="dangling">
                            {{ dangling.length === 1 ? 'Разбор не найдёт свою строку' : `${dangling.length} разбора(ов) не найдут свои строки` }}
                            в тексте и не покажется на сайте:
                            <ul class="adm-dangling">
                                <li v-for="a in dangling" :key="a.line" :class="{ 'is-binding': bindingFor === a.line }">
                                    <div>«{{ a.line }}»</div>
                                    <div class="adm-small adm-faint adm-dangling-note">{{ a.note }}</div>
                                    <div class="adm-row" style="gap: 0.375rem; margin-top: 0.25rem">
                                        <button
                                            class="adm-btn adm-btn-sm"
                                            type="button"
                                            :aria-pressed="bindingFor === a.line"
                                            @click="bindingFor = bindingFor === a.line ? null : a.line"
                                        >{{ bindingFor === a.line ? 'Отменить привязку' : 'Привязать к строке' }}</button>
                                        <button class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click="dropAnnotation(a.line)">Удалить разбор</button>
                                    </div>
                                </li>
                            </ul>
                        </div>
                        <div v-if="bindingFor !== null" class="adm-alert adm-alert-ok adm-binding" role="status" data-testid="binding">
                            Кликни строку — в тексте слева или в списке ниже, — к которой привязать разбор «{{ bindingFor }}».
                            <span v-if="bindError" style="display: block; color: #ffc4be">{{ bindError }}</span>
                        </div>
                        <p class="adm-hint" style="margin: 0 0 0.5rem">Нажми на строку, чтобы добавить или изменить разбор.</p>
                        <div ref="linesBox" class="adm-lines" data-testid="lines">
                            <template v-for="(row, i) in rows" :key="i">
                                <div v-if="row.kind === 'blank'" class="adm-line-blank"></div>
                                <div v-else-if="row.kind === 'section'" class="adm-line-section">{{ row.text }}</div>
                                <div v-else class="adm-line-wrap" :data-line="row.lineNo">
                                    <button
                                        type="button"
                                        class="adm-line"
                                        :class="{ 'has-note': row.note, 'is-repeat': row.repeat, active: editing === i, 'is-playing': row.lineNo === playingLine, 'is-bind-target': bindingFor !== null }"
                                        @click="bindingFor !== null ? bindTo(row.text) : openEditor(i, row.text)"
                                    >
                                        <span>{{ row.text }}</span>
                                        <span v-if="row.note" class="adm-line-note">{{ row.note }}</span>
                                        <span v-else-if="row.repeat" class="adm-line-note adm-faint">повтор — разбор у первого вхождения</span>
                                    </button>
                                    <div v-if="editing === i" class="adm-note-editor">
                                        <textarea
                                            ref="noteInput"
                                            v-model="draftNote"
                                            class="adm-textarea"
                                            rows="4"
                                            aria-label="Разбор строки"
                                            placeholder="Что означает эта строка"
                                            @keydown.ctrl.enter="saveNote(row.text)"
                                            @keydown.meta.enter="saveNote(row.text)"
                                            @keydown.esc="editing = -1"
                                        ></textarea>
                                        <div class="adm-row" style="gap: 0.5rem">
                                            <button class="adm-btn adm-btn-primary adm-btn-sm" type="button" :disabled="!draftNote.trim()" @click="saveNote(row.text)">Готово</button>
                                            <button v-if="row.note" class="adm-btn adm-btn-danger adm-btn-sm" type="button" @click="dropAnnotation(row.text)">Удалить разбор</button>
                                            <button class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click="editing = -1">Отмена</button>
                                        </div>
                                    </div>
                                </div>
                            </template>
                            <p v-if="!rows.some((r) => r.kind === 'line')" class="adm-faint adm-small">В тексте пока нет строк.</p>
                        </div>
                    </template>

                    <!-- Предпросмотр — те же компоненты, что на странице трека сайта. -->
                    <div v-else ref="previewBox" class="adm-preview" data-testid="preview">
                        <div class="track-page-inner">
                            <TrackAbout :about="about" />
                            <section class="track-section">
                                <h2 class="track-section-title">Текст</h2>
                                <div class="track-lyrics-body">
                                    <TrackLyrics :text="previewText" :note-map="previewNoteMap" :line-class="previewLineClass" @line-click="seekToLine" />
                                </div>
                            </section>
                        </div>
                    </div>
                </section>
            </div>

            <!-- Караоке вслед за текстом: .lrc совпадает с .txt построчно. -->
            <div v-if="lrcFollow.kind === 'update'" class="adm-alert adm-alert-ok adm-lrc-follow" data-testid="lrc-follow">
                <label class="adm-check">
                    <input v-model="updateLrc" type="checkbox" />
                    Обновить {{ lrcFollow.changes.length === 1 ? 'эту строку' : `эти строки (${lrcFollow.changes.length})` }} и в караоке — таймкоды сохранятся
                </label>
                <ul class="adm-small">
                    <li v-for="c in lrcFollow.changes" :key="c.index"><s>{{ c.from }}</s> → {{ c.to }}</li>
                </ul>
                <span class="adm-small adm-faint">{{ paths.lrc }} сохранится тем же коммитом.</span>
            </div>
            <div v-else-if="lrcFollow.kind === 'structure'" class="adm-alert adm-alert-warn" data-testid="lrc-follow">
                В тексте теперь {{ lrcFollow.after }} строк(и) вместо {{ lrcFollow.before }} — караоке ({{ paths.lrc }}) автоматически не обновляется.
                После сохранения поправь разметку в синхронизаторе:
                <a :href="`#/lrc/${encodeURIComponent(releaseId)}/${trackIndex}`">открыть «Караоке» для этого трека</a>.
            </div>
            <div v-else-if="lrcFollow.kind === 'mismatch'" class="adm-alert adm-alert-warn" data-testid="lrc-follow">
                Караоке ({{ paths.lrc }}) и раньше не совпадало с текстом построчно — обновить его автоматически нельзя.
                <a :href="`#/lrc/${encodeURIComponent(releaseId)}/${trackIndex}`">Открыть «Караоке»</a>.
            </div>

            <div class="adm-savebar">
                <span v-if="relinkNotice" class="adm-small adm-relink-notice" role="status" data-testid="relink-notice">{{ relinkNotice }}</span>
                <span v-else-if="validation.length" class="adm-small" style="color: #ffc4be">{{ validation.join('; ') }}</span>
                <span v-else-if="dangling.length" class="adm-small" style="color: #ffe2a8">
                    {{ dangling.length === 1 ? 'Есть висящий разбор' : `Висящих разборов: ${dangling.length}` }} — при сохранении спросим, что с ними делать
                </span>
                <span v-else-if="dirty" class="adm-small adm-muted">Есть несохранённые изменения</span>
                <span v-else class="adm-small adm-faint">Изменений нет</span>
                <span class="adm-spacer"></span>
                <button class="adm-btn adm-btn-ghost" type="button" :disabled="!dirty" @click="reset">Отменить изменения</button>
                <button class="adm-btn adm-btn-primary" type="button" :disabled="!dirty || validation.length > 0" @click="save">Сохранить…</button>
            </div>
        </template>
    </template>

    <!-- Сохранение с висящими разборами — только явно. -->
    <div v-if="danglingConfirm" class="adm-modal-backdrop" @click.self="danglingConfirm = false">
        <div class="adm-modal" role="dialog" aria-modal="true" aria-labelledby="adm-dangling-title" data-testid="dangling-confirm" @keydown.esc="danglingConfirm = false">
            <h2 id="adm-dangling-title">Разборы без строки</h2>
            <p class="adm-small adm-muted">
                {{ dangling.length === 1 ? 'Этот разбор не находит' : 'Эти разборы не находят' }} свою строку в тексте. На сайте такие разборы не
                показываются, а проверка при публикации не пропустит их, поэтому при сохранении они будут удалены:
            </p>
            <ul class="adm-small adm-dangling-list">
                <li v-for="a in dangling" :key="a.line"><b>«{{ a.line }}»</b> — {{ a.note }}</li>
            </ul>
            <div class="adm-row" style="margin-top: 1.25rem; justify-content: flex-end">
                <button class="adm-btn adm-btn-ghost" type="button" @click="danglingConfirm = false">Вернуться и привязать</button>
                <button class="adm-btn adm-btn-danger" type="button" @click="saveWithoutDangling">Удалить {{ dangling.length === 1 ? 'его' : 'их' }} и сохранить</button>
            </div>
        </div>
    </div>

    <CommitDialog :flow="flow" />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Release } from '@/types'
import TrackPicker from '../components/TrackPicker.vue'
import CommitDialog from '../components/CommitDialog.vue'
import TrackAbout from '@/site/components/TrackAbout.vue'
import TrackLyrics from '@/site/components/TrackLyrics.vue'
import { useRepo } from '../composables/useRepo'
import { useRoute, navigate } from '../composables/useRoute'
import { useCommitFlow } from '../composables/useCommitFlow'
import { useUnsaved } from '../composables/useUnsaved'
import { AdminApiError, readFiles } from '../api/content'
import {
    buildNoteMap,
    findDanglingAnnotations,
    isSectionLabel,
    layoutLyrics,
    normalizeLine,
    validateTrackNotes,
    type TrackAnnotation
} from '@/utils/trackNotes'
import { relinkAnnotations } from '../lib/lineMatch'
import { followLrc } from '../lib/lrcFollow'
import { getTrackSlug } from '@/utils/slug'
import { isNotesEmpty, moveNote, noteFor, normalizeNewlines, parseNotes, removeNote, serializeNotes, setNote } from '../lib/notesEdit'
import { audioPath, lrcPath, notesPath, siteUrl, txtPath } from '../lib/paths'
import AudioPlayer from '../components/AudioPlayer.vue'
import DraftBanner from '../components/DraftBanner.vue'
import { useDraft } from '../composables/useDraft'
import { draftKey } from '../lib/drafts'
import { REWIND_SEC, useAudioPlayer } from '../composables/useAudioPlayer'
import { linesFromLrc } from '../lib/lrc'
import { activeLine, lineTime, songLines, syncPoints } from '../lib/lyricsSync'
import { PLAYER_KEYS, playerKeyAction } from '../lib/playerKeys'

const repo = useRepo()
const route = useRoute()
const flow = useCommitFlow()

const releaseId = computed(() => route.segments.value[1] || '')
const trackIndex = computed(() => {
    const n = Number(route.segments.value[2])
    return Number.isInteger(n) && n >= 0 ? n : -1
})
const release = computed<Release | null>(() => repo.state.releases?.[releaseId.value] ?? null)
const track = computed(() => release.value?.tracks[trackIndex.value] ?? null)
const paths = computed(() =>
    release.value && track.value
        ? {
              txt: txtPath(release.value, track.value),
              notes: notesPath(release.value, track.value),
              lrc: lrcPath(release.value, track.value),
              audio: audioPath(release.value, track.value)
          }
        : { txt: '', notes: '', lrc: '', audio: '' }
)
const audioUrl = computed(() => (paths.value.audio ? siteUrl(paths.value.audio) : ''))

// ── Состояние редактора ──────────────────────────────────────────────
const loading = ref(false)
const loadError = ref('')
const loaded = ref(false)
const original = ref({ text: '', notesRaw: null as string | null, notesSerialized: '' })
const text = ref('')
const about = ref('')
const annotations = ref<TrackAnnotation[]>([])
const editing = ref(-1)
const draftNote = ref('')
const noteInput = ref<HTMLTextAreaElement[] | null>(null)
const tab = ref<'text' | 'notes' | 'preview'>('text')

const wide = ref(false)
let mql: MediaQueryList | null = null
const onMql = () => (wide.value = Boolean(mql?.matches))
onMounted(() => {
    mql = window.matchMedia('(min-width: 1000px)')
    onMql()
    mql.addEventListener('change', onMql)
})
onBeforeUnmount(() => mql?.removeEventListener('change', onMql))
const rightTab = computed(() => (tab.value === 'preview' ? 'preview' : 'notes'))
// На телефоне вкладка «Текст» отдельная; на широком экране текст виден всегда.
const notesTabActive = computed(() => tab.value === 'notes' || (wide.value && tab.value === 'text'))

const currentNotes = computed(() => ({ about: about.value, annotations: annotations.value }))
const notesSerialized = computed(() => serializeNotes(currentNotes.value))
const textChanged = computed(() => normalizeNewlines(text.value) !== original.value.text)
const notesChanged = computed(() => {
    // Нет файла и нечего сохранять — не создаём пустой .notes.json.
    if (original.value.notesRaw === null && isNotesEmpty(currentNotes.value)) return false
    return notesSerialized.value !== original.value.notesSerialized
})
const dirty = computed(() => loaded.value && (textChanged.value || notesChanged.value))
const confirmLeave = useUnsaved(dirty)

// Версия main, на которой загружены текст и разборы: при сохранении
// конфликт — только если эти файлы с тех пор изменили.
const loadedSha = ref('')

// Черновик в браузере: текст, «О треке» и разборы.
const draft = useDraft<{ text: string; about: string; annotations: TrackAnnotation[] }>({
    key: computed(() => (loaded.value && paths.value.txt ? draftKey('lyrics', paths.value.txt) : '')),
    ready: loaded,
    dirty,
    snapshot: () => ({ text: text.value, about: about.value, annotations: annotations.value }),
    original: () => original.value.text + '\n--\n' + (original.value.notesRaw ?? ''),
    baseSha: () => loadedSha.value,
    apply: (d) => {
        text.value = String(d.text ?? '')
        about.value = String(d.about ?? '')
        annotations.value = Array.isArray(d.annotations) ? d.annotations : []
        editing.value = -1
        settle()
    }
})

// ── Разборы вслед за правкой строк ───────────────────────────────────
// Текст «устоявшийся» — после паузы в наборе. Сравнение идёт с ним, а не
// на каждое нажатие клавиши: так «та же строка» узнаётся по целой правке.
let settledText = ''
let relinkTimer: ReturnType<typeof setTimeout> | undefined
/** Исходный текст строки разбора (до переносов) — по нормализованной строке. */
const origins = new Map<string, string>()
const originOf = (line: string) => origins.get(normalizeLine(line)) ?? line
const relinkNotice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | undefined

function notify(message: string) {
    relinkNotice.value = message
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => (relinkNotice.value = ''), 5000)
}

/** Сбросить точку сравнения (загрузка, отмена, черновик, сохранение). */
function settle() {
    clearTimeout(relinkTimer)
    settledText = normalizeNewlines(text.value)
}

function relinkNow() {
    clearTimeout(relinkTimer)
    const next = normalizeNewlines(text.value)
    if (next === settledText) return
    const r = relinkAnnotations(songLines(settledText), songLines(next), annotations.value, originOf)
    settledText = next
    if (!r.moved.length) return
    for (const m of r.moved) {
        origins.set(normalizeLine(m.to), originOf(m.from))
        origins.delete(normalizeLine(m.from))
    }
    annotations.value = r.annotations
    notify(r.moved.length === 1 ? `Разбор перенесён на изменённую строку «${r.moved[0].to}»` : `Разборы перенесены на изменённые строки: ${r.moved.length}`)
}

watch(text, () => {
    if (!loaded.value) return
    clearTimeout(relinkTimer)
    relinkTimer = setTimeout(relinkNow, 700)
})
onBeforeUnmount(() => {
    clearTimeout(relinkTimer)
    clearTimeout(noticeTimer)
})

// ── Ручная привязка висящего разбора ─────────────────────────────────
const bindingFor = ref<string | null>(null)
const bindError = ref('')
const textInput = ref<HTMLTextAreaElement | null>(null)
watch(bindingFor, () => (bindError.value = ''))

function bindTo(target: string) {
    const from = bindingFor.value
    if (from === null) return
    const ann = annotations.value.find((a) => a.line === from)
    if (!ann) {
        bindingFor.value = null
        return
    }
    const existing = noteFor(annotations.value, target)
    if (existing && normalizeLine(target) !== normalizeLine(from) && !window.confirm(`У строки «${target}» уже есть разбор. Заменить его?`)) return
    annotations.value = moveNote(annotations.value, from, target)
    origins.delete(normalizeLine(from))
    origins.delete(normalizeLine(target))
    bindingFor.value = null
    editing.value = -1
    notify(`Разбор привязан к строке «${target}»`)
}

// Клик в поле текста в режиме привязки — строка под курсором.
function onTextClick() {
    if (bindingFor.value === null) return
    const el = textInput.value
    if (!el) return
    const raw = el.value.slice(0, el.selectionStart).split('\n').length - 1
    const line = (el.value.split('\n')[raw] ?? '').trim()
    if (!line || isSectionLabel(line)) {
        bindError.value = 'Это не строка песни — кликни по строке с текстом'
        return
    }
    bindTo(line)
}

// ── Караоке вслед за текстом ─────────────────────────────────────────
const lrcFollow = computed(() => (loaded.value ? followLrc(original.value.text, normalizeNewlines(text.value), lrcRaw.value) : ({ kind: 'none' } as const)))
const updateLrc = ref(true)

// ── Сохранение с висящими разборами ──────────────────────────────────
const danglingConfirm = ref(false)

function saveWithoutDangling() {
    const drop = new Set(dangling.value.map((a) => a.line))
    annotations.value = annotations.value.filter((a) => !drop.has(a.line))
    danglingConfirm.value = false
    bindingFor.value = null
    save()
}

const validation = computed(() => {
    let parsed: unknown
    try {
        parsed = JSON.parse(notesSerialized.value)
    } catch {
        return ['разборы не сериализуются в JSON']
    }
    // Висящие разборы не блокируют кнопку: при сохранении их список
    // показывается отдельно и они удаляются только после подтверждения.
    return validateTrackNotes(parsed)
})

// Строки текста с разборами — как их увидит сайт.
const rows = computed(() => {
    const noteMap = buildNoteMap({ annotations: annotations.value })
    const seen = new Set<string>()
    let lineNo = 0
    return layoutLyrics(normalizeNewlines(text.value), noteMap).map((row) => {
        if (row.kind !== 'line') return { ...row, repeat: false, lineNo: -1 }
        const repeat = seen.has(row.key)
        seen.add(row.key)
        // lineNo — номер строки песни (songLines), по нему подсвечивается звучащая строка.
        return { ...row, repeat: repeat && noteMap.has(row.key), lineNo: lineNo++ }
    })
})
const dangling = computed(() => findDanglingAnnotations(normalizeNewlines(text.value), { annotations: annotations.value }))
const annotationCount = computed(() => annotations.value.filter((a) => a.note.trim()).length)

const previewText = computed(() => {
    const t = normalizeNewlines(text.value)
    return t.trim() ? t : ''
})
const previewNoteMap = computed(() => buildNoteMap({ annotations: annotations.value }))

const siteTrackUrl = computed(() =>
    track.value ? `./#/track/${encodeURIComponent(releaseId.value)}/${encodeURIComponent(getTrackSlug(track.value))}` : './'
)

// ── Плеер и звучащая строка ──────────────────────────────────────────
// Переключатели запоминаются в браузере; хранилище может быть недоступно.
function stored(key: string, fallback: boolean) {
    try {
        const v = localStorage.getItem(key)
        return v === null ? fallback : v === '1'
    } catch {
        return fallback
    }
}
function store(key: string, value: boolean) {
    try {
        localStorage.setItem(key, value ? '1' : '0')
    } catch {
        // не страшно — просто не запомнится
    }
}

const player = useAudioPlayer({ rewindOnResume: stored('adm-player-rewind', true) })
const { rewindOnResume, currentTime } = player
const follow = ref(stored('adm-lyrics-follow', true))
watch(rewindOnResume, (v) => store('adm-player-rewind', v))
watch(follow, (v) => store('adm-lyrics-follow', v))

const lrcRaw = ref<string | null>(null)
const lrcLines = computed(() => (lrcRaw.value ? linesFromLrc(lrcRaw.value) : []))
const lyricLines = computed(() => songLines(normalizeNewlines(text.value)))
const points = computed(() => syncPoints(lyricLines.value, lrcLines.value))
const playingLine = computed(() => activeLine(points.value, currentTime.value))
const nowText = computed(() => (playingLine.value >= 0 ? lyricLines.value[playingLine.value] : '—'))

const linesBox = ref<HTMLElement | null>(null)
const previewBox = ref<HTMLElement | null>(null)

function scrollWithin(box: HTMLElement | null, el: Element | null | undefined) {
    if (!box || !(el instanceof HTMLElement)) return
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    box.scrollTo({ top: box.scrollTop + (r.top - b.top) - box.clientHeight / 2 + r.height / 2, behavior: 'smooth' })
}

// Подсветка звучащей строки и строк, к которым можно перемотать, в предпросмотре.
function previewLineClass(n: number) {
    return { 'is-playing': n === playingLine.value, 'is-seekable': lineTime(points.value, n) !== null }
}

watch(
    playingLine,
    (n) => {
        if (n < 0 || !follow.value) return
        scrollWithin(linesBox.value, linesBox.value?.querySelector(`[data-line="${n}"]`))
        scrollWithin(previewBox.value, previewBox.value?.querySelector(`.lyric-line[data-line="${n}"]`))
    },
    { flush: 'post' }
)

// Клик по строке предпросмотра — перемотка к её времени из .lrc.
function seekToLine(n: number) {
    const t = lineTime(points.value, n)
    if (t !== null) player.seekTo(t)
}

function onKey(e: KeyboardEvent) {
    if (!loaded.value || flow.state.open) return
    const action = playerKeyAction(e)
    if (!action) return
    e.preventDefault()
    if (action === 'toggle') player.togglePlay()
    else player.seekBy(action === 'back' ? -3 : 3)
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function marker(r: Release, i: number) {
    const t = r.tracks[i]
    const has = (p: string) => repo.state.files.some((f) => f.path === p)
    const size = repo.state.files.find((f) => f.path === txtPath(r, t))?.size
    if (!has(txtPath(r, t))) return ' — нет файла текста'
    if (!size) return ' — текст пустой'
    return has(notesPath(r, t)) ? '' : ' — без разборов'
}

// ── Загрузка ─────────────────────────────────────────────────────────
let loadToken = 0
async function loadTrack() {
    loaded.value = false
    loadError.value = ''
    editing.value = -1
    if (!release.value || !track.value || !repo.state.sha) return
    const token = ++loadToken
    loading.value = true
    try {
        const base = repo.state.sha
        const files = await readFiles(base, [paths.value.txt, paths.value.notes, paths.value.lrc])
        if (token !== loadToken) return
        loadedSha.value = base
        lrcRaw.value = files[paths.value.lrc] ?? null
        const parsed = parseNotes(files[paths.value.notes])
        if (parsed.error) throw new AdminApiError('notes', 0, parsed.error)
        const t = normalizeNewlines(files[paths.value.txt] ?? '')
        original.value = {
            text: t,
            notesRaw: files[paths.value.notes],
            notesSerialized: files[paths.value.notes] === null ? '' : serializeNotes(parsed.notes)
        }
        text.value = t
        about.value = parsed.notes.about ?? ''
        annotations.value = [...(parsed.notes.annotations ?? [])]
        origins.clear()
        bindingFor.value = null
        updateLrc.value = true
        settle()
        loaded.value = true
    } catch (e) {
        if (token === loadToken) loadError.value = e instanceof AdminApiError ? e.message : `Не удалось загрузить: ${(e as Error).message}`
    } finally {
        if (token === loadToken) loading.value = false
    }
}

function reset() {
    text.value = original.value.text
    const parsed = parseNotes(original.value.notesRaw)
    about.value = parsed.notes.about ?? ''
    annotations.value = [...(parsed.notes.annotations ?? [])]
    editing.value = -1
    origins.clear()
    bindingFor.value = null
    settle()
}

function select(id: string, index: number) {
    if (id === releaseId.value && index === trackIndex.value) return
    if (!confirmLeave()) return
    draft.flush()
    player.pause()
    loaded.value = false
    if (index >= 0) navigate('lyrics', id, index)
    else navigate('lyrics', id)
}

// ── Разборы ──────────────────────────────────────────────────────────
async function openEditor(i: number, line: string) {
    editing.value = i
    draftNote.value = noteFor(annotations.value, line) ?? ''
    await nextTick()
    noteInput.value?.[0]?.focus()
}

function saveNote(line: string) {
    annotations.value = setNote(annotations.value, line, draftNote.value)
    // Разбор написан для строки в её нынешнем виде — она и есть исходная.
    origins.delete(normalizeLine(line))
    editing.value = -1
}

function dropAnnotation(line: string) {
    annotations.value = removeNote(annotations.value, line)
    editing.value = -1
}

// ── Сохранение ───────────────────────────────────────────────────────
async function save() {
    // Правка, набранная перед самым нажатием, — сначала перенести разборы.
    relinkNow()
    if (!release.value || !track.value || !dirty.value || validation.value.length) return
    if (dangling.value.length) {
        danglingConfirm.value = true
        return
    }
    const files: { path: string; content: string; kind: 'new' | 'changed' }[] = []
    const fileExists = (p: string) => repo.state.files.some((f) => f.path === p)
    if (textChanged.value) {
        files.push({ path: paths.value.txt, content: normalizeNewlines(text.value), kind: fileExists(paths.value.txt) ? 'changed' : 'new' })
    }
    if (notesChanged.value) {
        files.push({ path: paths.value.notes, content: notesSerialized.value, kind: original.value.notesRaw === null ? 'new' : 'changed' })
    }
    // Те же строки в караоке — с прежними таймкодами, тем же коммитом.
    const follow = lrcFollow.value
    const lrcContent = follow.kind === 'update' && updateLrc.value ? follow.content : null
    if (lrcContent !== null) files.push({ path: paths.value.lrc, content: lrcContent, kind: 'changed' })
    const parts = [textChanged.value && 'текст', notesChanged.value && 'описание и разборы', lrcContent !== null && 'караоке'].filter(Boolean)
    const notes: string[] = []
    if (follow.kind === 'update' && lrcContent !== null) notes.push(`В караоке обновятся строки: ${follow.changes.length}, таймкоды не меняются.`)
    if (follow.kind === 'update' && lrcContent === null) notes.push('Караоке не обновляется — его строки разойдутся с текстом.')
    if (follow.kind === 'structure') notes.push('Число строк изменилось — караоке нужно поправить в синхронизаторе.')
    const result = await flow.request({
        title: 'Сохранить текст',
        message: `${parts.join(', ')} «${track.value.title}» (${release.value.title})`,
        files: files.map(({ path, kind }) => ({ path, kind })),
        notes,
        prepare: async () => files.map(({ path, content }) => ({ path, content })),
        baseSha: loadedSha.value,
        draft: true
    })
    if (!result) return
    loadedSha.value = result.sha
    draft.clear()
    if (lrcContent !== null) lrcRaw.value = lrcContent
    origins.clear()
    settle()
    original.value = {
        text: normalizeNewlines(text.value),
        notesRaw: notesChanged.value || original.value.notesRaw !== null ? notesSerialized.value : null,
        notesSerialized: notesChanged.value || original.value.notesRaw !== null ? notesSerialized.value : ''
    }
}

watch([() => repo.state.releases !== null, releaseId, trackIndex], () => {
    if (!dirty.value) loadTrack()
})

onMounted(async () => {
    await repo.load()
    loadTrack()
})
</script>
