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
                        <textarea v-model="text" class="adm-textarea adm-mono adm-lyrics-input" spellcheck="false" rows="22" aria-label="Текст песни"></textarea>
                    </label>
                    <details class="adm-hint adm-format-hint">
                        <summary>Как оформлять текст</summary>
                        <ul>
                            <li>Метки секций — отдельной строкой в квадратных скобках: <span class="adm-mono">[Припев]</span>, <span class="adm-mono">[Куплет 1]</span>, <span class="adm-mono">[Бридж]</span>. Они не подсвечиваются и не принимают разборы.</li>
                            <li>Между блоками — одна пустая строка.</li>
                            <li>Пустой файл — на сайте будет «Текст будет позже...».</li>
                            <li>Если строку разбора изменить, разбор «повиснет» — он появится в предупреждении справа.</li>
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
                            <ul>
                                <li v-for="a in dangling" :key="a.line">
                                    «{{ a.line }}»
                                    <button class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click="dropAnnotation(a.line)">Удалить разбор</button>
                                </li>
                            </ul>
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
                                        :class="{ 'has-note': row.note, 'is-repeat': row.repeat, active: editing === i, 'is-playing': row.lineNo === playingLine }"
                                        @click="openEditor(i, row.text)"
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

                    <div v-else ref="previewBox" class="adm-preview" data-testid="preview" @click="onPreviewClick" @keydown="previewKey">
                        <div class="track-page-inner" v-html="previewHtml"></div>
                    </div>
                </section>
            </div>

            <div class="adm-savebar">
                <span v-if="validation.length" class="adm-small" style="color: #ffc4be">{{ validation.join('; ') }}</span>
                <span v-else-if="dirty" class="adm-small adm-muted">Есть несохранённые изменения</span>
                <span v-else class="adm-small adm-faint">Изменений нет</span>
                <span class="adm-spacer"></span>
                <button class="adm-btn adm-btn-ghost" type="button" :disabled="!dirty" @click="reset">Отменить изменения</button>
                <button class="adm-btn adm-btn-primary" type="button" :disabled="!dirty || validation.length > 0" @click="save">Сохранить…</button>
            </div>
        </template>
    </template>

    <CommitDialog :flow="flow" />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Release } from '@/types'
import TrackPicker from '../components/TrackPicker.vue'
import CommitDialog from '../components/CommitDialog.vue'
import { useRepo } from '../composables/useRepo'
import { useRoute, navigate } from '../composables/useRoute'
import { useCommitFlow } from '../composables/useCommitFlow'
import { useUnsaved } from '../composables/useUnsaved'
import { AdminApiError, readFiles } from '../api/content'
import { buildNoteMap, findDanglingAnnotations, layoutLyrics, renderAboutHtml, renderLyricsHtml, validateTrackNotes, type TrackAnnotation } from '@/utils/trackNotes'
import { getTrackSlug } from '@/utils/slug'
import { isNotesEmpty, noteFor, normalizeNewlines, parseNotes, removeNote, serializeNotes, setNote } from '../lib/notesEdit'
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
    }
})

const validation = computed(() => {
    let parsed: unknown
    try {
        parsed = JSON.parse(notesSerialized.value)
    } catch {
        return ['разборы не сериализуются в JSON']
    }
    const errors = validateTrackNotes(parsed)
    // Висящий разбор не пропустит проверка контента при деплое
    // (npm run check:content), поэтому сохранить с ним нельзя.
    if (dangling.value.length) errors.push('сначала удали или перенеси разборы, которые не находят свою строку')
    return errors
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

const previewHtml = computed(() => {
    const t = normalizeNewlines(text.value)
    const lyrics = renderLyricsHtml(t.trim() ? t : '', buildNoteMap({ annotations: annotations.value }))
    return `${renderAboutHtml({ about: about.value })}
        <section class="track-section">
            <h2 class="track-section-title">Текст</h2>
            <div class="track-lyrics-body">${lyrics.html}</div>
        </section>`
})

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

// Предпросмотр — разметка сайта (v-html), поэтому подсветку и номера строк
// ставим на готовые элементы после каждой перерисовки.
function markPreview() {
    const lines = previewBox.value?.querySelectorAll<HTMLElement>('.lyric-line:not(.is-blank)') ?? []
    lines.forEach((el, n) => {
        el.dataset.line = String(n)
        el.classList.toggle('is-playing', n === playingLine.value)
        el.classList.toggle('is-seekable', lineTime(points.value, n) !== null)
    })
}
watch([previewHtml, playingLine, points, rightTab, loaded], markPreview, { flush: 'post' })

watch(
    playingLine,
    (n) => {
        if (n < 0 || !follow.value) return
        scrollWithin(linesBox.value, linesBox.value?.querySelector(`[data-line="${n}"]`))
        scrollWithin(previewBox.value, previewBox.value?.querySelector(`.lyric-line[data-line="${n}"]`))
    },
    { flush: 'post' }
)

function onPreviewClick(e: Event) {
    togglePreviewNote(e)
    // Клик по строке — перемотка к её времени из .lrc.
    const line = (e.target as HTMLElement).closest<HTMLElement>('.lyric-line[data-line]')
    const t = line ? lineTime(points.value, Number(line.dataset.line)) : null
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
    editing.value = -1
}

function dropAnnotation(line: string) {
    annotations.value = removeNote(annotations.value, line)
    editing.value = -1
}

// Раскрытие разборов в предпросмотре — как на сайте.
function togglePreviewNote(e: Event) {
    const line = (e.target as HTMLElement).closest<HTMLElement>('.lyric-line.has-note')
    if (!line) return
    const target = line.parentElement?.querySelector<HTMLElement>(`#${line.dataset.noteTarget}`)
    if (!target) return
    const open = target.hasAttribute('hidden')
    target.toggleAttribute('hidden', !open)
    line.classList.toggle('open', open)
    line.setAttribute('aria-expanded', String(open))
}
function previewKey(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if (!(e.target as HTMLElement).closest('.lyric-line.has-note')) return
    e.preventDefault()
    togglePreviewNote(e)
}

// ── Сохранение ───────────────────────────────────────────────────────
async function save() {
    if (!release.value || !track.value || !dirty.value || validation.value.length) return
    const files: { path: string; content: string; kind: 'new' | 'changed' }[] = []
    const fileExists = (p: string) => repo.state.files.some((f) => f.path === p)
    if (textChanged.value) {
        files.push({ path: paths.value.txt, content: normalizeNewlines(text.value), kind: fileExists(paths.value.txt) ? 'changed' : 'new' })
    }
    if (notesChanged.value) {
        files.push({ path: paths.value.notes, content: notesSerialized.value, kind: original.value.notesRaw === null ? 'new' : 'changed' })
    }
    const parts = [textChanged.value && 'текст', notesChanged.value && 'описание и разборы'].filter(Boolean)
    const result = await flow.request({
        title: 'Сохранить текст',
        message: `${parts.join(', ')} «${track.value.title}» (${release.value.title})`,
        files: files.map(({ path, kind }) => ({ path, kind })),
        notes: [],
        prepare: async () => files.map(({ path, content }) => ({ path, content })),
        baseSha: loadedSha.value,
        draft: true
    })
    if (!result) return
    loadedSha.value = result.sha
    draft.clear()
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
