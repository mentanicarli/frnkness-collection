<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Караоке</h1>
            <p class="adm-sub">Синхронизация строк с аудио. Результат — файл .lrc рядом с текстом трека.</p>
        </div>
    </div>

    <div v-if="repo.state.error" class="adm-alert adm-alert-error" role="alert">{{ repo.state.error }}</div>
    <div v-else-if="!repo.state.releases" class="adm-empty"><span class="adm-spinner"></span></div>

    <template v-else>
        <TrackPicker :releases="repo.state.releases" :release-id="releaseId" :track-index="trackIndex" :marker="marker" @select="select" />

        <div v-if="loadError" class="adm-alert adm-alert-error" role="alert" style="margin-top: 1rem">{{ loadError }}</div>
        <div v-else-if="loading" class="adm-empty"><span class="adm-spinner"></span></div>

        <template v-else-if="loaded && release && track">
            <p class="adm-small adm-faint" style="margin: 1rem 0 0.5rem" data-testid="source-note">{{ sourceNote }}</p>
            <div v-if="mismatch" class="adm-alert adm-alert-warn" data-testid="mismatch">
                В готовом .lrc {{ mismatchCount }} строк(и) не совпадают с текстом трека — например, караоке правили отдельно.
                Ничего делать не нужно, если так и задумано.
                <button class="adm-btn adm-btn-sm" type="button" @click="takeFromText">Взять строки из текста (отметки сбросятся)</button>
            </div>

            <!-- Плеер -->
            <div class="adm-card adm-lrc-player">
                <audio
                    ref="audio"
                    :src="audioUrl"
                    preload="auto"
                    data-testid="audio"
                    @loadedmetadata="duration = audio?.duration || 0"
                    @play="playing = true; tick()"
                    @pause="playing = false"
                    @ended="playing = false"
                    @error="audioError = true"
                    @timeupdate="syncTime"
                    @seeked="syncTime"
                ></audio>
                <div v-if="audioError" class="adm-alert adm-alert-error">Не удалось загрузить аудио {{ paths.audio }}</div>
                <div class="adm-row adm-lrc-controls">
                    <button class="adm-btn adm-btn-primary" type="button" :aria-label="playing ? 'Пауза' : 'Играть'" @click="togglePlay">
                        {{ playing ? 'Пауза' : 'Играть' }}
                    </button>
                    <button class="adm-btn" type="button" aria-label="Назад 3 секунды" @click="seekBy(-3)">−3 с</button>
                    <button class="adm-btn" type="button" aria-label="Вперёд 3 секунды" @click="seekBy(3)">+3 с</button>
                    <span class="adm-mono adm-lrc-time" data-testid="time">{{ formatLrcTime(currentTime) }} / {{ formatLrcTime(duration) }}</span>
                    <span class="adm-spacer"></span>
                    <div class="adm-segmented adm-segmented-sm" role="group" aria-label="Скорость">
                        <button v-for="r in [0.75, 1]" :key="r" type="button" :class="{ active: rate === r }" :aria-pressed="rate === r" @click="setRate(r)">{{ r }}×</button>
                    </div>
                </div>
                <input
                    class="adm-lrc-seek"
                    type="range"
                    min="0"
                    :max="duration || 0"
                    step="0.01"
                    :value="currentTime"
                    aria-label="Позиция"
                    @input="seekTo(Number(($event.target as HTMLInputElement).value))"
                />
            </div>

            <div class="adm-row" style="margin: 1rem 0 0.75rem">
                <div class="adm-segmented" role="tablist" aria-label="Режим">
                    <button type="button" role="tab" :aria-selected="mode === 'sync'" :class="{ active: mode === 'sync' }" @click="mode = 'sync'">Разметка</button>
                    <button type="button" role="tab" :aria-selected="mode === 'edit'" :class="{ active: mode === 'edit' }" @click="openLineEditor">Строки</button>
                    <button type="button" role="tab" :aria-selected="mode === 'preview'" :class="{ active: mode === 'preview' }" @click="mode = 'preview'">Предпросмотр</button>
                </div>
                <span class="adm-spacer"></span>
                <span class="adm-small adm-muted" data-testid="progress">Отмечено {{ stampedCount }} из {{ lines.length }}</span>
            </div>

            <!-- Разметка -->
            <template v-if="mode === 'sync'">
                <div class="adm-row adm-lrc-actions">
                    <button class="adm-btn adm-btn-primary" type="button" :disabled="cursor >= lines.length" @click="doStamp">Отметить строку <kbd>Пробел</kbd></button>
                    <button class="adm-btn" type="button" :disabled="stampedCount === 0" @click="doUndo">Отменить <kbd>Backspace</kbd></button>
                    <button class="adm-btn adm-btn-ghost" type="button" :disabled="stampedCount === 0" @click="clearAll">Сбросить все</button>
                </div>
                <p class="adm-hint">
                    Пробел/Enter — отметить текущую строку и перейти к следующей; Backspace — отменить последнюю отметку;
                    ←/→ — перемотка на 3 с. Клик по строке — перемотка к её времени.
                </p>
                <div class="adm-row adm-lrc-shift" data-testid="lrc-shift">
                    <button
                        class="adm-btn adm-btn-sm adm-lrc-press"
                        type="button"
                        :disabled="stampedCount === 0 || atZero"
                        :title="atZero ? 'Самая ранняя строка уже на 00:00.00 — раньше некуда' : ''"
                        @click="doShiftAll(-0.1)"
                    >Все −0.1</button>
                    <button class="adm-btn adm-btn-sm adm-lrc-press" type="button" :disabled="stampedCount === 0" @click="doShiftAll(0.1)">Все +0.1</button>
                    <span class="adm-mono adm-small adm-lrc-shift-total" :class="{ 'is-zero': shiftTotalCs === 0 }" data-testid="shift-total">
                        Сдвиг: {{ formatShift(shiftTotalCs / 100) }}
                    </span>
                    <button class="adm-btn adm-btn-ghost adm-btn-sm adm-lrc-press" type="button" :disabled="shiftTotalCs === 0" @click="resetShift">Сбросить сдвиг</button>
                    <span v-if="shiftHint" class="adm-small adm-faint" role="status" data-testid="shift-hint">{{ shiftHint }}</span>
                </div>
                <ol class="adm-lrc-lines" data-testid="lrc-lines">
                    <li
                        v-for="(l, i) in lines"
                        :key="i"
                        :class="{ next: i === cursor, playing: l.time !== null && i === active, bad: badSet.has(i) }"
                    >
                        <button class="adm-lrc-line" type="button" :disabled="l.time === null" @click="l.time !== null && seekTo(l.time)">
                            <span
                                :key="flashes[i]?.n ?? 0"
                                class="adm-mono adm-lrc-stamp"
                                :class="flashes[i] ? (flashes[i].d > 0 ? 'flash-later' : 'flash-earlier') : ''"
                            >{{ l.time === null ? '—' : formatLrcTime(l.time) }}</span>
                            <span class="adm-lrc-text">{{ l.text }}</span>
                        </button>
                        <span v-if="l.time !== null" class="adm-lrc-nudge">
                            <!-- Место под «±0.1 с» занято всегда, чтобы кнопки не прыгали. -->
                            <span
                                :key="flashes[i]?.n ?? 0"
                                class="adm-mono adm-lrc-delta"
                                :class="flashes[i] ? (flashes[i].d > 0 ? 'flash-later' : 'flash-earlier') : ''"
                                aria-hidden="true"
                                data-testid="nudge-delta"
                            >{{ flashes[i] ? formatShift(flashes[i].d) : '' }}</span>
                            <button class="adm-btn adm-btn-ghost adm-btn-sm adm-lrc-press" type="button" :aria-label="`Строка ${i + 1}: раньше на 0.1 с`" :disabled="l.time <= 0" @click="doNudge(i, -0.1)">−0.1</button>
                            <button class="adm-btn adm-btn-ghost adm-btn-sm adm-lrc-press" type="button" :aria-label="`Строка ${i + 1}: позже на 0.1 с`" @click="doNudge(i, 0.1)">+0.1</button>
                        </span>
                    </li>
                </ol>
            </template>

            <!-- Правка строк -->
            <div v-else-if="mode === 'edit'" class="adm-stack">
                <p class="adm-hint">По строке на строку караоке. Отметки времени сохраняются по номеру строки.</p>
                <textarea v-model="linesDraft" class="adm-textarea adm-mono" rows="18" aria-label="Строки караоке" spellcheck="false"></textarea>
                <div class="adm-row">
                    <button class="adm-btn adm-btn-primary" type="button" @click="applyLines">Применить</button>
                    <button class="adm-btn adm-btn-ghost" type="button" @click="mode = 'sync'">Отмена</button>
                </div>
            </div>

            <!-- Предпросмотр -->
            <div v-else ref="previewBox" class="adm-karaoke fs-lyrics-body" data-testid="karaoke">
                <p
                    v-for="(l, i) in timedLines"
                    :key="i"
                    class="fs-lrc-line"
                    :class="karaokeClass(i)"
                    @click="seekTo(l.time)"
                >{{ l.text || '...' }}</p>
                <p v-if="!timedLines.length" class="adm-faint adm-small">Нет отмеченных строк.</p>
            </div>

            <div class="adm-savebar">
                <span v-if="saveBlock" class="adm-small" style="color: #ffc4be" data-testid="save-block">{{ saveBlock }}</span>
                <span v-else-if="dirty" class="adm-small adm-muted">Есть несохранённые изменения</span>
                <span v-else class="adm-small adm-faint">Изменений нет</span>
                <span class="adm-spacer"></span>
                <button class="adm-btn adm-btn-ghost" type="button" :disabled="!dirty" @click="resetAll">Отменить изменения</button>
                <button class="adm-btn adm-btn-primary" type="button" :disabled="!dirty || !!saveBlock" @click="save">Сохранить…</button>
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
import { navigate, useRoute } from '../composables/useRoute'
import { useCommitFlow } from '../composables/useCommitFlow'
import { useUnsaved } from '../composables/useUnsaved'
import { AdminApiError, readFiles } from '../api/content'
import {
    activeIndex,
    buildLrc,
    clearTimes,
    earliestTime,
    formatLrcTime,
    formatShift,
    linesFromLrc,
    linesFromTxt,
    nextUnstamped,
    nudge,
    outOfOrder,
    shiftAll,
    stamp,
    undoStamp,
    type LrcLine
} from '../lib/lrc'
import { audioPath, lrcPath, siteUrl, txtPath } from '../lib/paths'

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
        ? { txt: txtPath(release.value, track.value), lrc: lrcPath(release.value, track.value), audio: audioPath(release.value, track.value) }
        : { txt: '', lrc: '', audio: '' }
)
const audioUrl = computed(() => (paths.value.audio ? siteUrl(paths.value.audio) : ''))

// ── Состояние ────────────────────────────────────────────────────────
const loading = ref(false)
const loaded = ref(false)
const loadError = ref('')
const lines = ref<LrcLine[]>([])
const original = ref({ lrc: null as string | null, lines: [] as LrcLine[], textLines: [] as string[] })
const mode = ref<'sync' | 'edit' | 'preview'>('sync')
const linesDraft = ref('')

const audio = ref<HTMLAudioElement | null>(null)
const previewBox = ref<HTMLElement | null>(null)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const rate = ref(1)
const audioError = ref(false)

const cursor = computed(() => nextUnstamped(lines.value))
const stampedCount = computed(() => lines.value.filter((l) => l.time !== null).length)
const active = computed(() => activeIndex(lines.value, currentTime.value))
const badSet = computed(() => new Set(outOfOrder(lines.value)))
const timedLines = computed(() => lines.value.filter((l): l is { text: string; time: number } => l.time !== null))
const karaokeActive = computed(() => activeIndex(timedLines.value, currentTime.value))

const built = computed(() => buildLrc(lines.value))
const originalBuilt = computed(() => (original.value.lrc === null ? '' : buildLrc(original.value.lines)))
const dirty = computed(() => {
    if (!loaded.value) return false
    if (built.value !== originalBuilt.value) return true
    return lines.value.map((l) => l.text).join('\n') !== original.value.lines.map((l) => l.text).join('\n')
})
const confirmLeave = useUnsaved(dirty)

const mismatch = computed(
    () =>
        original.value.lrc !== null &&
        original.value.textLines.length > 0 &&
        original.value.textLines.join('\n') !== lines.value.map((l) => l.text).join('\n')
)

const mismatchCount = computed(() => {
    const a = original.value.textLines
    const b = lines.value.map((l) => l.text)
    let n = Math.abs(a.length - b.length)
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++
    return n
})

const sourceNote = computed(() => {
    if (original.value.lrc !== null) return `Готовый ${paths.value.lrc} загружен для правки.`
    if (!lines.value.length) return 'В тексте трека нет строк — сначала добавь текст в разделе «Тексты».'
    return `Строки взяты из ${paths.value.txt}: без пустых строк, меток секций и знаков препинания в конце.`
})

const saveBlock = computed(() => {
    if (!lines.value.length) return 'Нет строк для караоке'
    if (stampedCount.value < lines.value.length) return `Отмечено ${stampedCount.value} из ${lines.value.length} строк — отметь все`
    if (badSet.value.size) return `Строка ${[...badSet.value][0] + 1} раньше предыдущей — поправь время`
    if (lines.value.some((l) => !l.text.trim())) return 'Есть пустая строка'
    return ''
})

function marker(r: Release, i: number) {
    const t = r.tracks[i]
    const has = (p: string) => repo.state.files.some((f) => f.path === p)
    if (has(lrcPath(r, t))) return ''
    const size = repo.state.files.find((f) => f.path === txtPath(r, t))?.size
    return size ? ' — нет караоке' : ' — нет текста'
}

// ── Загрузка ─────────────────────────────────────────────────────────
let token = 0
async function loadTrack() {
    loaded.value = false
    loadError.value = ''
    audioError.value = false
    if (!release.value || !track.value || !repo.state.sha) return
    const my = ++token
    loading.value = true
    try {
        const files = await readFiles(repo.state.sha, [paths.value.txt, paths.value.lrc])
        if (my !== token) return
        const textLines = linesFromTxt(files[paths.value.txt] ?? '')
        const lrc = files[paths.value.lrc]
        const fromLrc = lrc !== null ? linesFromLrc(lrc) : null
        const initial = fromLrc ?? textLines.map((text) => ({ text, time: null }))
        original.value = { lrc, lines: initial.map((l) => ({ ...l })), textLines }
        lines.value = initial.map((l) => ({ ...l }))
        resetShiftState()
        mode.value = 'sync'
        loaded.value = true
    } catch (e) {
        if (my === token) loadError.value = e instanceof AdminApiError ? e.message : `Не удалось загрузить: ${(e as Error).message}`
    } finally {
        if (my === token) loading.value = false
    }
}

function select(id: string, index: number) {
    if (id === releaseId.value && index === trackIndex.value) return
    if (!confirmLeave()) return
    audio.value?.pause()
    loaded.value = false
    if (index >= 0) navigate('lrc', id, index)
    else navigate('lrc', id)
}

function resetAll() {
    lines.value = original.value.lines.map((l) => ({ ...l }))
    resetShiftState()
}

function takeFromText() {
    lines.value = original.value.textLines.map((text) => ({ text, time: null }))
    resetShiftState()
}

function resetShiftState() {
    shiftTotalCs.value = 0
    shiftNote.value = ''
    flashes.value = {}
}

// ── Аудио ────────────────────────────────────────────────────────────
function syncTime() {
    currentTime.value = audio.value?.currentTime ?? 0
}

function tick() {
    const el = audio.value
    if (!el) return
    currentTime.value = el.currentTime
    if (!el.paused) requestAnimationFrame(tick)
}

function togglePlay() {
    const el = audio.value
    if (!el) return
    if (el.paused) el.play().catch(() => (audioError.value = true))
    else el.pause()
}

function seekTo(t: number) {
    const el = audio.value
    if (!el) return
    el.currentTime = Math.max(0, Math.min(t, el.duration || t))
    currentTime.value = el.currentTime
}

const seekBy = (d: number) => seekTo((audio.value?.currentTime ?? 0) + d)

function setRate(r: number) {
    rate.value = r
    if (audio.value) audio.value.playbackRate = r
}

// ── Разметка ─────────────────────────────────────────────────────────
function doStamp() {
    lines.value = stamp(lines.value, audio.value?.currentTime ?? currentTime.value)
}
function doUndo() {
    lines.value = undoStamp(lines.value)
}
function doNudge(i: number, d: number) {
    const before = lines.value[i]?.time ?? null
    lines.value = nudge(lines.value, i, d)
    const after = lines.value[i]?.time ?? null
    shiftNote.value = ''
    if (before !== null && after !== null && after !== before) flash([i], after - before)
}
function clearAll() {
    if (!window.confirm('Сбросить все отметки времени?')) return
    lines.value = clearTimes(lines.value)
    shiftTotalCs.value = 0
    shiftNote.value = ''
}

// ── Сдвиг всех строк ─────────────────────────────────────────────────
// Накопленный сдвиг — в сотых долях целым числом, чтобы подпись не
// показывала 0.30000000000000004.
const shiftTotalCs = ref(0)
const shiftNote = ref('')
const atZero = computed(() => earliestTime(lines.value) === 0)
const shiftHint = computed(() => shiftNote.value || (atZero.value ? 'Самая ранняя строка на 00:00.00 — раньше сдвинуть нельзя' : ''))

function applyShift(delta: number) {
    const r = shiftAll(lines.value, delta)
    if (r.applied === 0) return 0
    lines.value = r.lines
    shiftTotalCs.value += Math.round(r.applied * 100)
    flash(
        lines.value.flatMap((l, i) => (l.time === null ? [] : [i])),
        r.applied
    )
    return r.applied
}

function doShiftAll(delta: number) {
    const applied = applyShift(delta)
    shiftNote.value =
        applied !== 0 && Math.round(applied * 100) !== Math.round(delta * 100)
            ? `Сдвинуто на ${formatShift(applied)}: самая ранняя строка упёрлась в 00:00.00`
            : ''
}

function resetShift() {
    const want = -shiftTotalCs.value / 100
    const applied = applyShift(want)
    // Если строку после сдвига вручную увели к нулю, вернуть всё целиком нельзя.
    shiftNote.value = Math.round(applied * 100) !== Math.round(want * 100) ? 'Сдвиг сброшен не полностью: самая ранняя строка упёрлась в 00:00.00' : ''
    shiftTotalCs.value = 0
}

// ── Отклик на нажатие: вспышка таймкода и «±0.1» у строки ────────────
const flashes = ref<Record<number, { d: number; n: number }>>({})
let flashN = 0
let flashTimer: ReturnType<typeof setTimeout> | undefined
function flash(indices: number[], d: number) {
    const n = ++flashN
    const next = { ...flashes.value }
    for (const i of indices) next[i] = { d, n }
    flashes.value = next
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => (flashes.value = {}), 1200)
}

function openLineEditor() {
    linesDraft.value = lines.value.map((l) => l.text).join('\n')
    mode.value = 'edit'
}

function applyLines() {
    const texts = linesDraft.value.replace(/\r\n?/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean)
    lines.value = texts.map((text, i) => ({ text, time: lines.value[i]?.time ?? null }))
    mode.value = 'sync'
}

function onKey(e: KeyboardEvent) {
    if (!loaded.value || flow.state.open || mode.value === 'edit') return
    const el = e.target as HTMLElement
    if (el.closest('input, textarea, select, [contenteditable]')) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // Фокус на кнопке сдвига: Пробел/Enter нажимают её, а не отмечают строку.
    if ((e.key === ' ' || e.key === 'Enter') && el.closest('.adm-lrc-nudge, .adm-lrc-shift')) return
    if (mode.value === 'sync' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        doStamp()
    } else if (mode.value === 'sync' && e.key === 'Backspace') {
        e.preventDefault()
        doUndo()
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekBy(-3)
    } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekBy(3)
    } else if (mode.value === 'preview' && e.key === ' ') {
        e.preventDefault()
        togglePlay()
    }
}

// ── Предпросмотр: подсветка и прокрутка как на сайте ─────────────────
function karaokeClass(i: number) {
    const d = Math.abs(i - karaokeActive.value)
    return { active: d === 0, d1: d === 1, d2: d === 2, d3: d === 3 }
}
watch(karaokeActive, async (i) => {
    if (mode.value !== 'preview') return
    await nextTick()
    const box = previewBox.value
    const el = box?.children[i] as HTMLElement | undefined
    if (!box || !el) return
    box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' })
})

// ── Сохранение ───────────────────────────────────────────────────────
async function save() {
    if (!release.value || !track.value || saveBlock.value || !dirty.value) return
    const content = built.value
    const result = await flow.request({
        title: 'Сохранить караоке',
        message: `караоке «${track.value.title}» (${release.value.title})`,
        files: [{ path: paths.value.lrc, kind: original.value.lrc === null ? 'new' : 'changed' }],
        notes: [`${lines.value.length} строк, последняя — ${formatLrcTime(lines.value[lines.value.length - 1].time ?? 0)}.`],
        prepare: async () => [{ path: paths.value.lrc, content }]
    })
    if (result) original.value = { ...original.value, lrc: content, lines: lines.value.map((l) => ({ ...l })) }
}

watch([() => repo.state.releases !== null, releaseId, trackIndex], () => {
    if (!dirty.value) loadTrack()
})

onMounted(async () => {
    window.addEventListener('keydown', onKey)
    await repo.load()
    loadTrack()
})
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey)
    clearTimeout(flashTimer)
    audio.value?.pause()
})
</script>
