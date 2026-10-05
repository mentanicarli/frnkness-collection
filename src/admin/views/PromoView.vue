<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Промо на главной</h1>
            <p class="adm-sub">Два независимых блока над списком альбомов: анонс будущего релиза и последний релиз. Настройка — src/content/site.json.</p>
        </div>
    </div>

    <div v-if="repo.state.error" class="adm-alert adm-alert-error" role="alert">{{ repo.state.error }}</div>
    <div v-else-if="!repo.state.releases" class="adm-empty"><span class="adm-spinner"></span></div>

    <template v-else>
        <div v-if="savedExpired" class="adm-alert adm-alert-warn" data-testid="announce-expired" style="margin-bottom: 1rem">
            Анонс истёк — добавьте релиз и выключите анонс.
        </div>

        <!-- Анонс -->
        <section class="adm-card adm-stack" data-testid="announce-block">
            <div class="adm-row">
                <h2 class="adm-h2" style="margin: 0">Анонс «скоро выйдет»</h2>
                <span class="adm-spacer"></span>
                <button v-if="announce.exists" class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click="removeAnnounce">Удалить анонс</button>
            </div>
            <template v-if="announce.exists">
                <label class="adm-check">
                    <input v-model="announce.enabled" type="checkbox" />
                    Показывать анонс на главной
                </label>
                <div class="adm-form-grid">
                    <label class="adm-field">
                        <span class="adm-label">Название</span>
                        <input v-model="announce.title" class="adm-input" type="text" maxlength="120" aria-label="Название анонса" />
                    </label>
                    <label class="adm-field">
                        <span class="adm-label">Дата и время выхода (по Москве, необязательно)</span>
                        <span class="adm-row" style="gap: 0.5rem; flex-wrap: nowrap">
                            <input v-model="announce.localTime" class="adm-input" type="datetime-local" aria-label="Время выхода" style="color-scheme: dark" />
                            <button v-if="announce.localTime" class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click.prevent="announce.localTime = ''">Без даты</button>
                        </span>
                        <span v-if="announce.localTime" class="adm-hint">В site.json: {{ releaseAtValue }}. С таймером; после этого времени анонс исчезнет сам.</span>
                        <span v-else class="adm-hint" data-testid="announce-no-date">Без даты: на главной «Скоро» без таймера. Анонс висит, пока его не выключишь.</span>
                    </label>
                    <label class="adm-field">
                        <span class="adm-label">Текст (необязательно)</span>
                        <textarea v-model="announce.text" class="adm-textarea" rows="2" maxlength="400" aria-label="Текст анонса" style="min-height: 3.5rem"></textarea>
                    </label>
                    <label class="adm-field">
                        <span class="adm-label">Ссылка (необязательно)</span>
                        <input v-model="announce.url" class="adm-input" type="url" aria-label="Ссылка анонса" placeholder="https://… пресейв или пост" />
                    </label>
                </div>
                <div class="adm-field">
                    <span class="adm-label">Обложка (квадратная, от 600px)</span>
                    <div class="adm-row">
                        <img v-if="coverSrc" :src="coverSrc" alt="" class="adm-cover-thumb" />
                        <label class="adm-btn adm-file-btn">
                            {{ coverSrc ? 'Заменить…' : 'Выбрать файл' }}
                            <input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" aria-label="Обложка анонса" @change="onCover" />
                        </label>
                    </div>
                    <span v-for="e in coverProblems" :key="e" class="adm-hint" style="color: #ffc4be">{{ e }}</span>
                </div>
            </template>
            <div v-else>
                <p class="adm-faint adm-small" style="margin: 0 0 0.75rem">Анонса нет.</p>
                <button class="adm-btn" type="button" @click="createAnnounce">Создать анонс</button>
            </div>
        </section>

        <!-- Последний релиз -->
        <section class="adm-card adm-stack">
            <h2 class="adm-h2" style="margin: 0">Последний релиз</h2>
            <label class="adm-check">
                <input v-model="enabled" type="checkbox" />
                Показывать промо-блок на главной
            </label>
            <label class="adm-field">
                <span class="adm-label">Релиз в промо</span>
                <select v-model="releaseId" class="adm-select" aria-label="Релиз в промо">
                    <option v-for="id in releaseIds" :key="id" :value="id">{{ releases[id].title }} — {{ releases[id].type === 'album' ? 'альбом' : 'сингл' }}, {{ releases[id].releaseDate || releases[id].year }}</option>
                </select>
                <span v-if="!releases[savedReleaseId]" class="adm-hint" style="color: #ffc4be">
                    Сейчас в site.json указан несуществующий релиз «{{ savedReleaseId }}» — блок на сайте не показывается.
                </span>
            </label>
        </section>

        <!-- Превью: как на главной -->
        <section class="adm-card">
            <h2 class="adm-h2">Превью главной</h2>
            <div class="adm-promo-preview">
                <div v-if="announcePreview" ref="announceBox" data-testid="announce-preview" v-html="announceHtml"></div>
                <p v-else-if="announce.exists && announce.enabled" class="adm-faint adm-small" data-testid="announce-hidden">
                    Анонс не показывается: {{ announceHiddenReason }}
                </p>
                <div
                    v-if="enabled && releases[releaseId]"
                    :class="{ 'adm-promo-gap': announcePreview }"
                    data-testid="promo-preview"
                    role="img"
                    :aria-label="`Промо-карточка: ${releases[releaseId].title}`"
                    v-html="previewHtml"
                ></div>
                <p v-else data-testid="promo-hidden" class="adm-faint adm-small">Промо-блок скрыт — на главной сразу идёт список альбомов.</p>
            </div>
        </section>

        <div class="adm-savebar">
            <span v-if="errors.length" class="adm-small" style="color: #ffc4be" data-testid="promo-errors">{{ errors.join('; ') }}</span>
            <span v-else-if="dirty" class="adm-small adm-muted">Есть несохранённые изменения</span>
            <span v-else class="adm-small adm-faint">Изменений нет</span>
            <span class="adm-spacer"></span>
            <button class="adm-btn adm-btn-ghost" type="button" :disabled="!dirty" @click="reset">Отменить изменения</button>
            <button class="adm-btn adm-btn-primary" type="button" :disabled="!dirty || errors.length > 0" @click="save">Сохранить…</button>
        </div>
    </template>

    <CommitDialog :flow="flow" />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { Announce, Releases, SiteSettings } from '@/types'
import CommitDialog from '../components/CommitDialog.vue'
import { SITE_PATH, useRepo } from '../composables/useRepo'
import { useCommitFlow } from '../composables/useCommitFlow'
import { useUnsaved } from '../composables/useUnsaved'
import { uploadMedia, type CommitFile } from '../api/content'
import { renderPromoCardHtml } from '@/utils/promoCard'
import { isAnnounceActive, isAnnounceExpired, renderAnnounceCardHtml, startAnnounceCountdown } from '@/utils/announceCard'
import { validateSiteSettings } from '../../../supabase/functions/_shared/rules.ts'
import { serializeSite } from '../lib/content'
import { coverErrors, imageExt, readImage, type ImageInfo } from '../lib/imageFile'
import { versionedPath } from '../lib/editRelease'
import { slugify } from '../lib/newRelease'
import { moscowToday } from '../lib/dates'
import { siteUrl } from '../lib/paths'

const repo = useRepo()
const flow = useCommitFlow()

const releases = computed<Releases>(() => repo.state.releases || {})
const releaseIds = computed(() => Object.keys(releases.value).reverse())
const saved = computed<SiteSettings | null>(() => repo.state.site)
const savedEnabled = computed(() => saved.value?.promo.enabled ?? false)
const savedReleaseId = computed(() => saved.value?.promo.releaseId ?? '')

// Часы для превью и подсказки «истёк».
const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 1000)
onBeforeUnmount(() => clearInterval(clock))

const savedExpired = computed(() => isAnnounceExpired(saved.value?.announce, now.value))

// ── Последний релиз ──────────────────────────────────────────────────
const enabled = ref(false)
const releaseId = ref('')

// ── Анонс ────────────────────────────────────────────────────────────
const announce = reactive({ exists: false, enabled: true, title: '', localTime: '', text: '', url: '', cover: '' })
const coverFile = ref<File | null>(null)
const coverInfo = ref<ImageInfo | null>(null)
const coverProblems = ref<string[]>([])
const coverSrc = computed(() => coverInfo.value?.url || (announce.cover ? siteUrl(announce.cover) : ''))
const releaseAtValue = computed(() => (announce.localTime ? `${announce.localTime.slice(0, 16)}:00+03:00` : ''))

/** Путь обложки после сохранения (новая — под новым именем). */
const newCoverPath = computed(() => {
    if (!coverFile.value) return null
    const taken = new Set(repo.state.files.map((f) => f.path))
    const base = `images/announce-${slugify(announce.title) || 'cover'}.jpg`
    return versionedPath(base, imageExt(coverFile.value), moscowToday(), taken, 'announce')
})

const nextAnnounce = computed<Announce | undefined>(() =>
    announce.exists
        ? {
              enabled: announce.enabled,
              title: announce.title,
              cover: newCoverPath.value ?? announce.cover,
              ...(releaseAtValue.value ? { releaseAt: releaseAtValue.value } : {}),
              text: announce.text,
              url: announce.url
          }
        : undefined
)

const nextSite = computed<SiteSettings>(() => ({
    promo: { enabled: enabled.value, releaseId: releaseId.value },
    ...(nextAnnounce.value ? { announce: nextAnnounce.value } : {})
}))

const dirty = computed(() => Boolean(saved.value) && (coverFile.value !== null || serializeSite(nextSite.value) !== serializeSite(saved.value!)))
useUnsaved(dirty)

const errors = computed(() => {
    const list = [...coverProblems.value]
    if (announce.exists) {
        if (!announce.title.trim()) list.push('Укажи название анонса')
        if (!announce.cover && !coverFile.value) list.push('Добавь обложку анонса')
        if (announce.localTime && announce.enabled && Date.parse(releaseAtValue.value) <= now.value) list.push('Время выхода уже прошло — выключи анонс или поменяй время')
    }
    if (list.length) return list
    // Та же проверка site.json, что в функции.
    return validateSiteSettings(JSON.parse(serializeSite(nextSite.value)), releases.value)
})

// ── Превью ───────────────────────────────────────────────────────────
const previewHtml = computed(() => renderPromoCardHtml(releaseId.value, releases.value[releaseId.value]))
const announcePreview = computed<Announce | null>(() => {
    const a = nextAnnounce.value
    if (!a || !coverSrc.value || !a.title.trim()) return null
    const shown = { ...a, cover: coverSrc.value }
    return isAnnounceActive(shown, now.value) ? shown : null
})
const announceHiddenReason = computed(() => {
    if (!announce.title.trim() || !coverSrc.value) return 'заполни название и обложку'
    return 'время выхода прошло'
})
// Разметка не зависит от текущего времени — перерисовывается только при смене
// данных, а цифры отсчёта обновляет startAnnounceCountdown (у анонса без
// даты отсчёта нет).
const announceHtml = computed(() => {
    const a = announcePreview.value
    if (!a) return ''
    return a.releaseAt ? renderAnnounceCardHtml(a, Date.parse(a.releaseAt) - 1000) : renderAnnounceCardHtml(a)
})
const announceBox = ref<HTMLElement | null>(null)
let stopCountdown: (() => void) | null = null
watch(announceHtml, async () => {
    stopCountdown?.()
    stopCountdown = null
    await nextTick()
    const card = announceBox.value?.querySelector<HTMLElement>('.announce-card')
    if (card) stopCountdown = startAnnounceCountdown(card, () => card.remove())
}, { immediate: true })
onBeforeUnmount(() => stopCountdown?.())

// ── Действия ─────────────────────────────────────────────────────────
function resetCover() {
    if (coverInfo.value) URL.revokeObjectURL(coverInfo.value.url)
    coverInfo.value = null
    coverFile.value = null
    coverProblems.value = []
}

function reset() {
    resetCover()
    const s = saved.value
    enabled.value = s?.promo.enabled ?? false
    releaseId.value = s && releases.value[s.promo.releaseId] ? s.promo.releaseId : releaseIds.value[0] || ''
    const a = s?.announce
    Object.assign(announce, a
        ? { exists: true, enabled: a.enabled, title: a.title, localTime: a.releaseAt?.slice(0, 16) ?? '', text: a.text ?? '', url: a.url ?? '', cover: a.cover }
        : { exists: false, enabled: true, title: '', localTime: '', text: '', url: '', cover: '' })
}

function createAnnounce() {
    Object.assign(announce, { exists: true, enabled: true, title: '', localTime: '', text: '', url: '', cover: '' })
}

function removeAnnounce() {
    resetCover()
    Object.assign(announce, { exists: false, enabled: true, title: '', localTime: '', text: '', url: '', cover: '' })
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
    } catch (err) {
        coverProblems.value = [(err as Error).message]
    }
}

function describeChanges(): string {
    const parts: string[] = []
    const s = saved.value!
    if (enabled.value !== s.promo.enabled || releaseId.value !== s.promo.releaseId) {
        parts.push(enabled.value ? `промо на главной: «${releases.value[releaseId.value].title}»` : 'промо на главной выключено')
    }
    const before = s.announce ? serializeSite({ promo: s.promo, announce: s.announce }) : ''
    const after = nextAnnounce.value ? serializeSite({ promo: s.promo, announce: nextAnnounce.value }) : ''
    if (before !== after || coverFile.value) {
        if (!nextAnnounce.value) parts.push('анонс удалён')
        else if (!nextAnnounce.value.enabled) parts.push(`анонс «${nextAnnounce.value.title.trim()}» выключен`)
        else parts.push(`анонс «${nextAnnounce.value.title.trim()}»`)
    }
    return parts.join('; ')
}

async function save() {
    if (!dirty.value || errors.value.length) return
    const content = serializeSite(nextSite.value)
    const oldCover = saved.value?.announce?.cover
    const newCover = newCoverPath.value
    const nextCover = nextAnnounce.value?.cover
    // Старая обложка анонса больше не нужна: заменили или удалили анонс.
    const deleteOld = oldCover && oldCover !== nextCover && repo.state.files.some((f) => f.path === oldCover) ? oldCover : null
    const file = coverFile.value
    const result = await flow.request({
        title: 'Сохранить промо',
        message: describeChanges(),
        files: [
            { path: SITE_PATH, kind: saved.value ? 'changed' : 'new' },
            ...(newCover && file ? [{ path: newCover, kind: 'new' as const, size: file.size }] : []),
            ...(deleteOld ? [{ path: deleteOld, kind: 'deleted' as const }] : [])
        ],
        prepare: async (progress) => {
            const out: CommitFile[] = [{ path: SITE_PATH, content }]
            if (newCover && file) {
                progress('Загружаем обложку анонса…')
                out.push(await uploadMedia(file, newCover, imageExt(file), imageExt(file) === 'png' ? 'image/png' : 'image/jpeg'))
            }
            if (deleteOld) out.push({ path: deleteOld, delete: true })
            return out
        }
    })
    if (result) {
        repo.state.site = JSON.parse(content) as SiteSettings
        resetCover()
        reset()
    }
}

watch(() => repo.state.site, (site, prev) => {
    if (site && !prev) reset()
})

onMounted(async () => {
    await repo.load()
    reset()
})
onBeforeUnmount(resetCover)
</script>
