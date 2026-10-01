<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Релизы</h1>
            <p class="adm-sub">Название, дата, обложка, видео и PDF существующих релизов. id, тип, папки и треки не меняются — от них зависит статистика.</p>
        </div>
    </div>

    <div v-if="repo.state.error" class="adm-alert adm-alert-error" role="alert">{{ repo.state.error }}</div>
    <div v-else-if="!repo.state.releases" class="adm-empty"><span class="adm-spinner"></span></div>

    <template v-else>
        <label class="adm-field" style="max-width: 32rem">
            <span class="adm-label">Релиз</span>
            <select class="adm-select" :value="releaseId" aria-label="Релиз" @change="select(($event.target as HTMLSelectElement).value)">
                <option value="" disabled>Выбери релиз</option>
                <option v-for="id in releaseIds" :key="id" :value="id">{{ repo.state.releases[id].title }}</option>
            </select>
        </label>

        <template v-if="release">
            <!-- Только чтение -->
            <section class="adm-card adm-stack" style="margin-top: 1rem" data-testid="readonly">
                <h2 class="adm-h2">Не меняется <span class="adm-faint" style="text-transform: none; letter-spacing: 0">— ключи статистики</span></h2>
                <dl class="adm-dl">
                    <dt>ID</dt><dd class="adm-mono">{{ releaseId }}</dd>
                    <dt>Тип</dt><dd>{{ release.type === 'album' ? 'Альбом' : 'Сингл' }}</dd>
                    <dt>Папки</dt><dd class="adm-mono">{{ release.audioPath }}, {{ release.lyricsPath }}</dd>
                    <dt>Треки</dt>
                    <dd>
                        <ol class="adm-ro-tracks">
                            <li v-for="t in release.tracks" :key="t.num">{{ t.title }} <span class="adm-faint adm-mono">{{ t.file }}</span></li>
                        </ol>
                    </dd>
                </dl>
            </section>

            <!-- Правка -->
            <section class="adm-card adm-stack">
                <h2 class="adm-h2">Можно менять</h2>
                <div class="adm-form-grid">
                    <label class="adm-field">
                        <span class="adm-label">Название</span>
                        <input v-model="form.title" class="adm-input" type="text" aria-label="Название" />
                    </label>
                    <label class="adm-field">
                        <span class="adm-label">Дата релиза</span>
                        <input v-model="form.date" class="adm-input" type="date" aria-label="Дата релиза" style="color-scheme: dark" />
                        <span class="adm-hint">В реестре: «{{ plan.release.releaseDate }}», год {{ plan.release.year }}</span>
                    </label>
                    <label class="adm-field">
                        <span class="adm-label">Ссылка на YouTube (пусто — без видео)</span>
                        <input v-model="form.youtube" class="adm-input" type="url" aria-label="Ссылка на YouTube" placeholder="https://youtu.be/…" />
                    </label>
                </div>

                <div class="adm-form-grid">
                    <div class="adm-field">
                        <span class="adm-label">Обложка</span>
                        <div class="adm-row">
                            <img :src="coverPreview || siteUrl(release.cover)" alt="" class="adm-cover-thumb" data-testid="cover-preview" />
                            <label class="adm-btn adm-file-btn">
                                Заменить…
                                <input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" aria-label="Новая обложка" @change="onCover" />
                            </label>
                            <button v-if="coverFile" class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click="resetCover">Оставить прежнюю</button>
                        </div>
                        <span class="adm-hint">{{ coverFile ? `Новая: ${coverInfo?.width}×${coverInfo?.height}` : release.cover }}</span>
                        <span v-for="e in coverProblems" :key="e" class="adm-hint" style="color: #ffc4be">{{ e }}</span>
                    </div>
                    <div class="adm-field">
                        <span class="adm-label">PDF с текстами</span>
                        <div class="adm-segmented adm-segmented-sm" role="radiogroup" aria-label="PDF">
                            <button type="button" role="radio" :aria-checked="form.pdf === 'keep'" :class="{ active: form.pdf === 'keep' }" @click="setPdf('keep')">
                                {{ release.lyricsBookPath ? 'Оставить' : 'Без PDF' }}
                            </button>
                            <button type="button" role="radio" :aria-checked="form.pdf === 'replace'" :class="{ active: form.pdf === 'replace' }" @click="setPdf('replace')">
                                {{ release.lyricsBookPath ? 'Заменить' : 'Добавить' }}
                            </button>
                            <button v-if="release.lyricsBookPath" type="button" role="radio" :aria-checked="form.pdf === 'remove'" :class="{ active: form.pdf === 'remove' }" @click="setPdf('remove')">Убрать</button>
                        </div>
                        <label v-if="form.pdf === 'replace'" class="adm-btn adm-btn-sm adm-file-btn" style="width: fit-content">
                            {{ pdfFile ? pdfFile.name : 'Выбрать PDF…' }}
                            <input type="file" accept="application/pdf,.pdf" aria-label="Файл PDF" @change="onPdf" />
                        </label>
                        <span class="adm-hint">{{ release.lyricsBookPath || 'У релиза нет PDF' }}</span>
                    </div>
                </div>
            </section>

            <div class="adm-savebar">
                <span v-if="allErrors.length" class="adm-small" style="color: #ffc4be" data-testid="edit-errors">{{ allErrors.join('; ') }}</span>
                <span v-else-if="plan.changes.length" class="adm-small adm-muted">Изменения: {{ plan.changes.join(', ') }}</span>
                <span v-else class="adm-small adm-faint">Изменений нет</span>
                <span class="adm-spacer"></span>
                <button class="adm-btn adm-btn-ghost" type="button" :disabled="!plan.changes.length" @click="reset">Отменить изменения</button>
                <button class="adm-btn adm-btn-primary" type="button" :disabled="!plan.changes.length || allErrors.length > 0" @click="save">Сохранить…</button>
            </div>
        </template>
    </template>

    <CommitDialog :flow="flow" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { Release } from '@/types'
import CommitDialog from '../components/CommitDialog.vue'
import { RELEASES_PATH, useRepo } from '../composables/useRepo'
import { navigate, useRoute } from '../composables/useRoute'
import { useCommitFlow } from '../composables/useCommitFlow'
import { useUnsaved } from '../composables/useUnsaved'
import { uploadMedia, type CommitFile } from '../api/content'
import { formFromRelease, planEdit, type EditForm } from '../lib/editRelease'
import { serializeReleases } from '../lib/content'
import { coverErrors, imageExt, readImage, type ImageInfo } from '../lib/imageFile'
import { moscowToday } from '../lib/dates'
import { siteUrl } from '../lib/paths'

const repo = useRepo()
const route = useRoute()
const flow = useCommitFlow()

const releaseId = computed(() => route.segments.value[1] || '')
const release = computed<Release | null>(() => repo.state.releases?.[releaseId.value] ?? null)
// Свежие сверху.
const releaseIds = computed(() => Object.keys(repo.state.releases || {}).reverse())

const form = reactive<EditForm>({ title: '', date: '', youtube: '', newCover: null, pdf: 'keep' })
const coverFile = ref<File | null>(null)
const coverInfo = ref<ImageInfo | null>(null)
const coverProblems = ref<string[]>([])
const pdfFile = ref<File | null>(null)
const coverPreview = computed(() => coverInfo.value?.url ?? '')

const plan = computed(() =>
    release.value
        ? planEdit(repo.state.releases!, releaseId.value, form, repo.state.files, moscowToday())
        : { next: {}, release: {} as Release, uploads: [], deletes: [], changes: [], errors: [] }
)
const allErrors = computed(() => [
    ...coverProblems.value,
    ...(form.pdf === 'replace' && !pdfFile.value ? ['Выбери PDF'] : []),
    ...plan.value.errors
])
const dirty = computed(() => plan.value.changes.length > 0)
const confirmLeave = useUnsaved(dirty)

function resetCover() {
    if (coverInfo.value) URL.revokeObjectURL(coverInfo.value.url)
    coverInfo.value = null
    coverFile.value = null
    coverProblems.value = []
    form.newCover = null
}

function reset() {
    resetCover()
    pdfFile.value = null
    if (release.value) Object.assign(form, formFromRelease(release.value))
}

function select(id: string) {
    if (id === releaseId.value || !confirmLeave()) return
    navigate('releases', id)
}

async function onCover(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    resetCover()
    try {
        const info = await readImage(file)
        coverInfo.value = info
        coverFile.value = file
        coverProblems.value = coverErrors(file, info, true)
        form.newCover = { ext: imageExt(file) }
    } catch (err) {
        coverProblems.value = [(err as Error).message]
    }
}

function setPdf(mode: EditForm['pdf']) {
    form.pdf = mode
    if (mode !== 'replace') pdfFile.value = null
}

function onPdf(e: Event) {
    pdfFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

async function save() {
    const p = plan.value
    if (!release.value || !p.changes.length || allErrors.value.length) return
    const id = releaseId.value
    const media = p.uploads.map((u) =>
        u.kind === 'cover'
            ? { path: u.path, file: coverFile.value!, ext: imageExt(coverFile.value!), type: imageExt(coverFile.value!) === 'png' ? 'image/png' : 'image/jpeg' }
            : { path: u.path, file: pdfFile.value!, ext: 'pdf', type: 'application/pdf' }
    )
    const result = await flow.request({
        title: `Сохранить «${p.release.title}»`,
        message: `релиз «${p.release.title}»: ${p.changes.join(', ')}`,
        files: [
            { path: RELEASES_PATH, kind: 'changed' },
            ...media.map((m) => ({ path: m.path, kind: 'new' as const, size: m.file.size })),
            ...p.deletes.map((path) => ({ path, kind: 'deleted' as const }))
        ],
        notes: [
            'Меняется только запись этого релиза в releases.json; id, тип, папки и треки остаются прежними.',
            ...(p.deletes.length ? ['Новые файлы — под новыми именами (так браузеры не покажут старую версию из кэша), старые удаляются.'] : [])
        ],
        prepare: async (progress) => {
            const out: CommitFile[] = [{ path: RELEASES_PATH, content: serializeReleases(p.next) }]
            for (const [i, m] of media.entries()) {
                progress(`Загружаем ${i + 1} из ${media.length}: ${m.path.split('/').pop()}`)
                out.push(await uploadMedia(m.file, m.path, m.ext, m.type))
            }
            out.push(...p.deletes.map((path) => ({ path, delete: true as const })))
            return out
        }
    })
    if (result) {
        // Форма возьмёт значения из обновлённого реестра после перезагрузки.
        resetCover()
        pdfFile.value = null
        form.pdf = 'keep'
        Object.assign(form, formFromRelease(p.next[id]))
    }
}

watch([releaseId, () => repo.state.releases], () => {
    if (!dirty.value) reset()
})

onMounted(async () => {
    await repo.load()
    reset()
})
onBeforeUnmount(resetCover)
</script>
