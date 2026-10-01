<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Новый релиз</h1>
            <p class="adm-sub">Файлы, пустые тексты и запись в releases.json — одним коммитом. Существующие релизы не меняются.</p>
        </div>
    </div>

    <div v-if="repo.state.error" class="adm-alert adm-alert-error" role="alert">{{ repo.state.error }}</div>
    <div v-else-if="!repo.state.releases" class="adm-empty"><span class="adm-spinner"></span></div>

    <div v-else-if="done" class="adm-card adm-stack" data-testid="done">
        <div class="adm-alert adm-alert-ok">Релиз «{{ done.title }}» отправлен на публикацию. Он появится на сайте после сборки (1–2 минуты).</div>
        <p class="adm-small adm-muted">Тексты треков пока пустые — на сайте будет «Текст будет позже...». Дальше:</p>
        <div class="adm-row">
            <a class="adm-btn" :href="buildHash('lyrics', done.id, 0)">Добавить тексты</a>
            <a class="adm-btn" :href="buildHash('catalog')">Открыть каталог</a>
            <button class="adm-btn adm-btn-ghost" type="button" @click="startOver">Добавить ещё релиз</button>
        </div>
    </div>

    <form v-else class="adm-stack" novalidate @submit.prevent="publish">
        <!-- Основное -->
        <section class="adm-card adm-stack">
            <h2 class="adm-h2">Релиз</h2>
            <div class="adm-segmented" role="radiogroup" aria-label="Тип релиза">
                <button v-for="t in TYPES" :key="t.id" type="button" role="radio" :aria-checked="draft.type === t.id"
                        :class="{ active: draft.type === t.id }" @click="setType(t.id)">{{ t.label }}</button>
            </div>
            <div class="adm-form-grid">
                <label class="adm-field">
                    <span class="adm-label">Название</span>
                    <input v-model="draft.title" class="adm-input" type="text" aria-label="Название релиза" @input="onTitle" />
                </label>
                <label class="adm-field">
                    <span class="adm-label">ID (адрес страницы релиза)</span>
                    <input v-model="draft.id" class="adm-input adm-mono" type="text" aria-label="ID релиза" :aria-invalid="idError ? 'true' : 'false'"
                           @input="idTouched = true" />
                    <span class="adm-hint" :style="idError ? 'color: #ffc4be' : ''">{{ idError || `frnkness.ru/#/release/${draft.id || '…'}` }}</span>
                </label>
                <label class="adm-field">
                    <span class="adm-label">Дата релиза</span>
                    <input v-model="draft.date" class="adm-input" type="date" aria-label="Дата релиза" style="color-scheme: dark" />
                    <span class="adm-hint">В реестре: «{{ dateLabel }}»</span>
                </label>
                <label class="adm-field">
                    <span class="adm-label">Ссылка на YouTube (необязательно)</span>
                    <input v-model="draft.youtube" class="adm-input" type="url" aria-label="Ссылка на YouTube" placeholder="https://youtu.be/…" />
                    <span v-if="draft.youtube.trim()" class="adm-hint">{{ youtubeEmbed(draft.youtube) || 'Не похоже на ссылку на ролик YouTube' }}</span>
                </label>
            </div>

            <div class="adm-form-grid">
                <div class="adm-field">
                    <span class="adm-label">Обложка (jpg, квадратная, от {{ COVER_MIN_SIDE }}px)</span>
                    <div class="adm-row">
                        <img v-if="coverUrl" :src="coverUrl" alt="" class="adm-cover-thumb" />
                        <label class="adm-btn adm-file-btn">
                            {{ coverFile ? 'Заменить' : 'Выбрать файл' }}
                            <input type="file" accept="image/jpeg,.jpg,.jpeg" aria-label="Обложка" @change="onCover" />
                        </label>
                        <span v-if="draft.cover" class="adm-small adm-muted" data-testid="cover-info">{{ draft.cover.width }}×{{ draft.cover.height }}, {{ formatSize(draft.cover.size) }}</span>
                    </div>
                    <span v-if="coverError" class="adm-hint" style="color: #ffc4be">{{ coverError }}</span>
                </div>
                <div class="adm-field">
                    <span class="adm-label">PDF с текстами (необязательно)</span>
                    <div class="adm-row">
                        <label class="adm-btn adm-file-btn">
                            {{ pdfFile ? 'Заменить' : 'Выбрать файл' }}
                            <input type="file" accept="application/pdf,.pdf" aria-label="PDF с текстами" @change="onPdf" />
                        </label>
                        <span v-if="pdfFile" class="adm-small adm-muted">{{ pdfFile.name }}, {{ formatSize(pdfFile.size) }}</span>
                        <button v-if="pdfFile" class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click="pdfFile = null; draft.pdf = null">Убрать</button>
                    </div>
                </div>
            </div>
        </section>

        <!-- Треклист -->
        <section class="adm-card adm-stack">
            <div class="adm-row">
                <h2 class="adm-h2" style="margin: 0">Треклист</h2>
                <span class="adm-spacer"></span>
                <label v-if="draft.type === 'album'" class="adm-btn adm-btn-sm adm-file-btn">
                    Добавить mp3 файлами
                    <input type="file" accept="audio/mpeg,.mp3" multiple aria-label="Добавить mp3 файлами" @change="onManyMp3" />
                </label>
            </div>
            <p class="adm-hint" style="margin: 0">
                Slug — часть адреса страницы трека и имени файлов, латиницей. Порядок меняется перетаскиванием или стрелками.
            </p>
            <ol class="adm-tracklist" data-testid="tracklist">
                <li
                    v-for="(t, i) in draft.tracks"
                    :key="t.key"
                    :class="{ dragging: dragFrom === i, over: dragOver === i && dragFrom !== i }"
                    :draggable="draft.type === 'album'"
                    @dragstart="dragFrom = i"
                    @dragover.prevent="dragOver = i"
                    @dragleave="dragOver === i && (dragOver = -1)"
                    @drop.prevent="drop(i)"
                    @dragend="dragFrom = -1; dragOver = -1"
                >
                    <span class="adm-track-num adm-mono" :title="draft.type === 'album' ? 'Перетащи, чтобы поменять порядок' : ''">{{ String(i + 1).padStart(2, '0') }}</span>
                    <div class="adm-track-fields">
                        <input v-model="t.title" class="adm-input" type="text" :aria-label="`Название трека ${i + 1}`" placeholder="Название" @input="onTrackTitle(t)" />
                        <input v-model="t.slug" class="adm-input adm-mono" type="text" :aria-label="`Slug трека ${i + 1}`" placeholder="slug" @input="t.slugTouched = true" />
                        <div class="adm-row adm-track-file">
                            <label class="adm-btn adm-btn-sm adm-file-btn">
                                {{ t.file ? 'mp3 ✓' : 'mp3…' }}
                                <input type="file" accept="audio/mpeg,.mp3" :aria-label="`mp3 трека ${i + 1}`" @change="onMp3(t, $event)" />
                            </label>
                            <span class="adm-small adm-faint adm-mono adm-track-paths">{{ trackPaths[i] }}</span>
                        </div>
                    </div>
                    <div v-if="draft.type === 'album'" class="adm-track-tools">
                        <button class="adm-btn adm-btn-ghost adm-btn-sm" type="button" :disabled="i === 0" :aria-label="`Трек ${i + 1} выше`" @click="move(i, i - 1)">↑</button>
                        <button class="adm-btn adm-btn-ghost adm-btn-sm" type="button" :disabled="i === draft.tracks.length - 1" :aria-label="`Трек ${i + 1} ниже`" @click="move(i, i + 1)">↓</button>
                        <button class="adm-btn adm-btn-ghost adm-btn-sm" type="button" :aria-label="`Удалить трек ${i + 1}`" @click="removeTrack(i)">×</button>
                    </div>
                </li>
            </ol>
            <button v-if="draft.type === 'album'" class="adm-btn adm-btn-sm" type="button" style="width: fit-content" @click="addTrack()">+ Трек</button>
        </section>

        <!-- Публикация -->
        <section class="adm-card adm-stack">
            <label class="adm-check">
                <input v-model="makePromo" type="checkbox" />
                Сделать промо на главной
            </label>
            <div v-if="errors.length && showErrors" class="adm-alert adm-alert-error" role="alert" data-testid="errors">
                Нужно поправить:
                <ul><li v-for="e in errors" :key="e">{{ e }}</li></ul>
            </div>
            <div class="adm-row">
                <button class="adm-btn adm-btn-primary" type="submit">Проверить и опубликовать…</button>
                <span class="adm-small adm-faint">Папки: {{ plan ? `${plan.release.audioPath}, ${plan.release.lyricsPath}` : '—' }}</span>
            </div>
        </section>
    </form>

    <CommitDialog :flow="flow" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { Releases } from '@/types'
import CommitDialog from '../components/CommitDialog.vue'
import { RELEASES_PATH, SITE_PATH, useRepo } from '../composables/useRepo'
import { useCommitFlow } from '../composables/useCommitFlow'
import { useUnsaved } from '../composables/useUnsaved'
import { buildHash } from '../composables/useRoute'
import { stageBlob, uploadToStaging, type CommitFile } from '../api/content'
import { formatRuDate, isValidIsoDate, moscowToday } from '../lib/dates'
import { serializeReleases, serializeSite } from '../lib/content'
import {
    COVER_MIN_SIDE,
    appendRelease,
    planRelease,
    slugify,
    uniqueId,
    validateDraft,
    youtubeEmbed,
    type ReleaseDraft
} from '../lib/newRelease'

const TYPES = [
    { id: 'album', label: 'Альбом' },
    { id: 'single', label: 'Сингл' }
] as const

interface TrackState {
    key: number
    title: string
    slug: string
    slugTouched: boolean
    titleTouched: boolean
    file: File | null
}

const repo = useRepo()
const flow = useCommitFlow()

let keySeq = 0
const newTrack = (title = ''): TrackState => ({ key: ++keySeq, title, slug: slugify(title), slugTouched: false, titleTouched: false, file: null })

const draft = reactive({
    type: 'album' as 'album' | 'single',
    title: '',
    id: '',
    date: moscowToday(),
    youtube: '',
    cover: null as ReleaseDraft['cover'],
    pdf: null as ReleaseDraft['pdf'],
    tracks: [newTrack()] as TrackState[]
})
const idTouched = ref(false)
const coverFile = ref<File | null>(null)
const coverUrl = ref('')
const coverError = ref('')
const pdfFile = ref<File | null>(null)
const makePromo = ref(false)
const showErrors = ref(false)
const done = ref<{ id: string; title: string } | null>(null)
const dragFrom = ref(-1)
const dragOver = ref(-1)

const releases = computed<Releases>(() => repo.state.releases || {})

const dirty = computed(() => !done.value && Boolean(draft.title || coverFile.value || draft.tracks.some((t) => t.title || t.file)))
useUnsaved(dirty)

const draftForCheck = computed<ReleaseDraft>(() => ({
    type: draft.type,
    title: draft.title,
    id: draft.id,
    date: draft.date,
    cover: draft.cover,
    youtube: draft.youtube,
    pdf: draft.pdf,
    tracks: draft.tracks.map((t) => ({ title: t.title, slug: t.slug, audio: t.file ? { name: t.file.name, size: t.file.size } : null }))
}))
const errors = computed(() => validateDraft(draftForCheck.value, releases.value, repo.state.files))
const plan = computed(() => (draft.tracks.length ? planRelease(draftForCheck.value, releases.value, repo.state.files) : null))
const trackPaths = computed(() =>
    (plan.value?.paths.tracks ?? []).map((p) => `${p.audio.split('/').pop()} · ${p.txt.split('/').pop()}`)
)
const dateLabel = computed(() => (isValidIsoDate(draft.date) ? formatRuDate(draft.date) : '—'))
const idError = computed(() => {
    if (!draft.id) return ''
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.id)) return 'Только латиница, цифры и дефисы'
    if (draft.id in releases.value) return `ID «${draft.id}» уже занят`
    return ''
})

// ── Поля ─────────────────────────────────────────────────────────────
function onTitle() {
    if (!idTouched.value) draft.id = uniqueId(slugify(draft.title), new Set(Object.keys(releases.value)))
    if (draft.type === 'single') {
        const t = draft.tracks[0]
        if (t && !t.titleTouched) {
            t.title = draft.title
            if (!t.slugTouched) t.slug = slugify(draft.title)
        }
    }
}

function onTrackTitle(t: TrackState) {
    t.titleTouched = true
    if (!t.slugTouched) t.slug = slugify(t.title)
}

function setType(type: 'album' | 'single') {
    draft.type = type
    if (type === 'single' && draft.tracks.length > 1) {
        if (!window.confirm('У сингла один трек — остальные будут убраны. Продолжить?')) {
            draft.type = 'album'
            return
        }
        draft.tracks.splice(1)
    }
    if (!draft.tracks.length) draft.tracks.push(newTrack(type === 'single' ? draft.title : ''))
}

function addTrack(title = '') {
    draft.tracks.push(newTrack(title))
}

function removeTrack(i: number) {
    draft.tracks.splice(i, 1)
}

function move(from: number, to: number) {
    if (to < 0 || to >= draft.tracks.length || from === to) return
    const [t] = draft.tracks.splice(from, 1)
    draft.tracks.splice(to, 0, t)
}

function drop(i: number) {
    move(dragFrom.value, i)
    dragFrom.value = -1
    dragOver.value = -1
}

const firstFile = (e: Event) => (e.target as HTMLInputElement).files?.[0] ?? null

function onMp3(t: TrackState, e: Event) {
    t.file = firstFile(e)
    if (t.file && !t.title) {
        t.title = t.file.name.replace(/\.mp3$/i, '')
        onTrackTitle(t)
        t.titleTouched = false
    }
}

function onManyMp3(e: Event) {
    const list = Array.from((e.target as HTMLInputElement).files ?? [])
    // Пустая первая строка заполняется первым файлом.
    if (draft.tracks.length === 1 && !draft.tracks[0].title && !draft.tracks[0].file) draft.tracks.splice(0, 1)
    for (const f of list) {
        const t = newTrack(f.name.replace(/\.mp3$/i, ''))
        t.file = f
        draft.tracks.push(t)
    }
    ;(e.target as HTMLInputElement).value = ''
}

async function onCover(e: Event) {
    const file = firstFile(e)
    coverError.value = ''
    if (!file) return
    if (!/\.jpe?g$/i.test(file.name) && file.type !== 'image/jpeg') {
        coverError.value = 'Нужен jpg'
        return
    }
    const url = URL.createObjectURL(file)
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image()
            el.onload = () => resolve(el)
            el.onerror = () => reject(new Error('не открывается как изображение'))
            el.src = url
        })
        if (coverUrl.value) URL.revokeObjectURL(coverUrl.value)
        coverUrl.value = url
        coverFile.value = file
        draft.cover = { name: file.name, size: file.size, width: img.naturalWidth, height: img.naturalHeight }
    } catch (err) {
        URL.revokeObjectURL(url)
        coverError.value = `Файл ${(err as Error).message}`
    }
}

function onPdf(e: Event) {
    const file = firstFile(e)
    pdfFile.value = file
    draft.pdf = file ? { name: file.name, size: file.size } : null
}

function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

// ── Публикация ───────────────────────────────────────────────────────
async function publish() {
    showErrors.value = true
    if (errors.value.length || !plan.value || !coverFile.value) return
    const p = plan.value
    const id = p.id
    const base = releases.value
    const nextRegistry = appendRelease(base, p)

    const media: { file: File; path: string; ext: string; type: string }[] = [
        { file: coverFile.value, path: p.paths.cover, ext: 'jpg', type: 'image/jpeg' },
        ...(pdfFile.value && p.paths.pdf ? [{ file: pdfFile.value, path: p.paths.pdf, ext: 'pdf', type: 'application/pdf' }] : []),
        ...draft.tracks.map((t, i) => ({ file: t.file!, path: p.paths.tracks[i].audio, ext: 'mp3', type: 'audio/mpeg' }))
    ]
    const texts: CommitFile[] = [
        { path: RELEASES_PATH, content: serializeReleases(nextRegistry) },
        ...p.paths.tracks.map((t) => ({ path: t.txt, content: '' })),
        ...(makePromo.value ? [{ path: SITE_PATH, content: serializeSite({ promo: { enabled: true, releaseId: id } }) }] : [])
    ]

    const result = await flow.request({
        title: `Опубликовать ${draft.type === 'album' ? 'альбом' : 'сингл'}`,
        message: `новый ${draft.type === 'album' ? 'альбом' : 'сингл'} «${p.release.title}»`,
        files: [
            { path: RELEASES_PATH, kind: 'changed' },
            ...(makePromo.value ? [{ path: SITE_PATH, kind: 'changed' as const }] : []),
            ...media.map((m) => ({ path: m.path, kind: 'new' as const, size: m.file.size })),
            ...p.paths.tracks.map((t) => ({ path: t.txt, kind: 'new' as const }))
        ],
        notes: [
            `В releases.json добавится запись «${id}» в конец; существующие ${Object.keys(base).length} релизов не меняются.`,
            'Тексты треков создаются пустыми — на сайте будет «Текст будет позже...».',
            `Медиафайлы (${formatSize(media.reduce((s, m) => s + m.file.size, 0))}) загружаются по одному после нажатия «Опубликовать».`
        ],
        prepare: async (progress) => {
            const out: CommitFile[] = []
            for (const [i, m] of media.entries()) {
                progress(`Загружаем ${i + 1} из ${media.length}: ${m.path.split('/').pop()}`)
                const staging = await uploadToStaging(m.file, m.ext, m.type)
                const blob = await stageBlob(staging, m.path)
                out.push({ path: m.path, blob: { sha: blob.sha, size: blob.size, token: blob.token } })
            }
            return [...texts, ...out]
        }
    })
    if (result) done.value = { id, title: p.release.title }
}

function startOver() {
    Object.assign(draft, { type: 'album', title: '', id: '', date: moscowToday(), youtube: '', cover: null, pdf: null, tracks: [newTrack()] })
    idTouched.value = false
    coverFile.value = null
    if (coverUrl.value) URL.revokeObjectURL(coverUrl.value)
    coverUrl.value = ''
    pdfFile.value = null
    makePromo.value = false
    showErrors.value = false
    done.value = null
}

watch(() => draft.type, (type) => {
    if (type === 'single' && draft.tracks[0] && !draft.tracks[0].titleTouched && draft.title) {
        draft.tracks[0].title = draft.title
        if (!draft.tracks[0].slugTouched) draft.tracks[0].slug = slugify(draft.title)
    }
})

onMounted(() => repo.load())
onBeforeUnmount(() => {
    if (coverUrl.value) URL.revokeObjectURL(coverUrl.value)
})
</script>
