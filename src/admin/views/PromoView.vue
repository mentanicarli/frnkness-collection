<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Промо на главной</h1>
            <p class="adm-sub">Карточка «последний релиз» над списком альбомов. Настройка хранится в src/content/site.json.</p>
        </div>
    </div>

    <div v-if="repo.state.error" class="adm-alert adm-alert-error" role="alert">{{ repo.state.error }}</div>
    <div v-else-if="!repo.state.releases" class="adm-empty"><span class="adm-spinner"></span></div>

    <template v-else>
        <section class="adm-card adm-stack">
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

        <section class="adm-card">
            <h2 class="adm-h2">Превью</h2>
            <div v-if="enabled && releases[releaseId]" class="adm-promo-preview" data-testid="promo-preview" role="img" :aria-label="`Промо-карточка: ${releases[releaseId].title}`" v-html="previewHtml"></div>
            <p v-else class="adm-faint adm-small" data-testid="promo-hidden">Промо-блок скрыт — на главной сразу идёт список альбомов.</p>
        </section>

        <div class="adm-savebar">
            <span v-if="dirty" class="adm-small adm-muted">Есть несохранённые изменения</span>
            <span v-else class="adm-small adm-faint">Изменений нет</span>
            <span class="adm-spacer"></span>
            <button class="adm-btn adm-btn-ghost" type="button" :disabled="!dirty" @click="reset">Отменить изменения</button>
            <button class="adm-btn adm-btn-primary" type="button" :disabled="!dirty" @click="save">Сохранить…</button>
        </div>
    </template>

    <CommitDialog :flow="flow" />
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Releases } from '@/types'
import CommitDialog from '../components/CommitDialog.vue'
import { SITE_PATH, useRepo } from '../composables/useRepo'
import { useCommitFlow } from '../composables/useCommitFlow'
import { useUnsaved } from '../composables/useUnsaved'
import { renderPromoCardHtml } from '@/utils/promoCard'
import { serializeSite } from '../lib/content'

const repo = useRepo()
const flow = useCommitFlow()

const releases = computed<Releases>(() => repo.state.releases || {})
// Свежие релизы — сверху списка.
const releaseIds = computed(() => Object.keys(releases.value).reverse())
const savedEnabled = computed(() => repo.state.site?.promo.enabled ?? false)
const savedReleaseId = computed(() => repo.state.site?.promo.releaseId ?? '')

const enabled = ref(false)
const releaseId = ref('')

function reset() {
    enabled.value = savedEnabled.value
    releaseId.value = releases.value[savedReleaseId.value] ? savedReleaseId.value : releaseIds.value[0] || ''
}

const dirty = computed(() => Boolean(repo.state.site) && (enabled.value !== savedEnabled.value || releaseId.value !== savedReleaseId.value))
useUnsaved(dirty)

const previewHtml = computed(() => renderPromoCardHtml(releaseId.value, releases.value[releaseId.value]))

async function save() {
    if (!dirty.value) return
    const release = releases.value[releaseId.value]
    const content = serializeSite({ promo: { enabled: enabled.value, releaseId: releaseId.value } })
    const message = !enabled.value
        ? 'промо на главной выключено'
        : `промо на главной: «${release.title}»`
    const result = await flow.request({
        title: 'Сохранить промо',
        message,
        files: [{ path: SITE_PATH, kind: repo.state.site ? 'changed' : 'new' }],
        prepare: async () => [{ path: SITE_PATH, content }]
    })
    if (result) repo.state.site = { promo: { enabled: enabled.value, releaseId: releaseId.value } }
}

watch(() => repo.state.site, (site, prev) => {
    if (site && !prev) reset()
})

onMounted(async () => {
    await repo.load()
    reset()
})
</script>
