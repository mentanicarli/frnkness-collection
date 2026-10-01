<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Каталог</h1>
            <p class="adm-sub">Что есть и чего не хватает у треков и релизов — по текущему состоянию репозитория.</p>
        </div>
        <button class="adm-btn" type="button" :disabled="loading" @click="refresh">Обновить</button>
    </div>

    <div v-if="error" class="adm-alert adm-alert-error" role="alert">{{ error }}</div>
    <div v-else-if="!report" class="adm-empty"><span class="adm-spinner"></span></div>

    <template v-else>
        <div class="adm-row adm-catalog-summary" data-testid="summary">
            <span class="adm-row" style="gap: 0.375rem"><span class="adm-dot adm-dot-err"></span>{{ report.counts.error }} ошибок</span>
            <span class="adm-row" style="gap: 0.375rem"><span class="adm-dot adm-dot-warn"></span>{{ report.counts.warn }} предупреждений</span>
            <span class="adm-row" style="gap: 0.375rem"><span class="adm-dot"></span>{{ report.counts.info }} без разборов</span>
            <span class="adm-row" style="gap: 0.375rem"><span class="adm-dot"></span>{{ report.orphans.length }} файлов без ссылок</span>
            <span class="adm-spacer"></span>
            <div class="adm-segmented adm-segmented-sm" role="group" aria-label="Фильтр">
                <button type="button" :class="{ active: !onlyProblems }" :aria-pressed="!onlyProblems" @click="onlyProblems = false">Все</button>
                <button type="button" :class="{ active: onlyProblems }" :aria-pressed="onlyProblems" @click="onlyProblems = true">Только проблемы</button>
            </div>
        </div>
        <p class="adm-hint" style="margin: 0 0 1rem">
            mp3 и обложки загружаются вместе с новым релизом; у существующих — через git. Остальное открывается кнопками.
        </p>

        <section v-for="r in visibleReleases" :key="r.releaseId" class="adm-card adm-catalog-release" :data-testid="`release-${r.releaseId}`">
            <div class="adm-row adm-catalog-head">
                <h2 class="adm-catalog-title">{{ r.title }}</h2>
                <span class="adm-chip" :class="r.cover ? 'ok' : 'err'">обложка {{ r.cover ? 'есть' : 'нет' }}</span>
                <span v-if="r.pdf !== null" class="adm-chip" :class="r.pdf ? 'ok' : 'err'">PDF {{ r.pdf ? 'есть' : 'нет' }}</span>
                <span v-else class="adm-chip">без PDF</span>
            </div>
            <ul v-if="r.problems.length" class="adm-problems">
                <li v-for="p in r.problems" :key="p.text" :class="p.severity">{{ p.text }}</li>
            </ul>
            <div class="adm-table-scroll">
                <table class="adm-table adm-catalog-table">
                    <thead>
                        <tr>
                            <th class="num">#</th>
                            <th>Трек</th>
                            <th>mp3</th>
                            <th>Текст</th>
                            <th>LRC</th>
                            <th class="num">Разборы</th>
                            <th class="num">Висящие</th>
                            <th>Что сделать</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="t in tracksOf(r)" :key="t.trackIndex" :data-testid="`track-${r.releaseId}-${t.trackIndex}`">
                            <td class="num adm-faint">{{ t.num }}</td>
                            <td>{{ t.title }}</td>
                            <td><span class="adm-mark" :class="t.audio ? 'ok' : 'err'">{{ t.audio ? 'есть' : 'нет' }}</span></td>
                            <td><span class="adm-mark" :class="{ ok: t.txt === 'ok', warn: t.txt === 'empty', err: t.txt === 'missing' }">{{ TXT[t.txt] }}</span></td>
                            <td><span class="adm-mark" :class="t.lrc ? 'ok' : 'warn'">{{ t.lrc ? 'есть' : 'нет' }}</span></td>
                            <td class="num">
                                <span v-if="t.notes === 'broken'" class="adm-mark err">битый</span>
                                <span v-else-if="t.notes === 'missing'" class="adm-faint">—</span>
                                <template v-else>{{ t.annotations }}</template>
                            </td>
                            <td class="num"><span :class="{ 'adm-mark warn': t.dangling }">{{ t.notes === 'ok' ? t.dangling : '—' }}</span></td>
                            <td><div class="adm-catalog-actions">
                                <template v-for="p in t.problems" :key="p.text">
                                    <a v-if="p.action" class="adm-btn adm-btn-sm" :class="p.severity === 'info' ? 'adm-btn-ghost' : ''" :href="actionHref(p.action, t)" :title="p.text">
                                        {{ ACTION_LABEL[p.action] }}: {{ p.text }}
                                    </a>
                                    <span v-else class="adm-small adm-mark err">{{ p.text }}</span>
                                </template>
                                <span v-if="!t.problems.length" class="adm-faint adm-small">всё на месте</span>
                            </div></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
        <p v-if="!visibleReleases.length" class="adm-empty">Проблем не найдено.</p>

        <section class="adm-card" data-testid="orphans">
            <h2 class="adm-h2">Файлы без ссылок</h2>
            <p class="adm-hint" style="margin-top: 0">Лежат в audio/, images/ или lyrics/, но ни один релиз на них не ссылается. Удалять — через git.</p>
            <ul v-if="report.orphans.length" class="adm-file-list">
                <li v-for="o in report.orphans" :key="o.path"><b>{{ o.path }}</b> · {{ formatSize(o.size) }}</li>
            </ul>
            <p v-else class="adm-faint adm-small">Нет.</p>
        </section>
    </template>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRepo } from '../composables/useRepo'
import { AdminApiError, readFiles } from '../api/content'
import { computeCatalogReport, contentPathsNeeded, type CatalogReport, type ProblemAction, type ReleaseReport, type TrackReport } from '../lib/catalog'
import { buildHash } from '../composables/useRoute'

const repo = useRepo()
const report = ref<CatalogReport | null>(null)
const error = ref('')
const loading = ref(false)
const onlyProblems = ref(false)

const TXT = { ok: 'есть', empty: 'пустой', missing: 'нет' } as const
const ACTION_LABEL: Record<Exclude<ProblemAction, null>, string> = { lyrics: 'Тексты', lrc: 'Караоке' }

const hasProblems = (t: TrackReport) => t.problems.some((p) => p.severity !== 'info')
const tracksOf = (r: ReleaseReport) => (onlyProblems.value ? r.tracks.filter(hasProblems) : r.tracks)
const visibleReleases = computed(() =>
    (report.value?.releases ?? []).filter((r) => !onlyProblems.value || r.problems.length || r.tracks.some(hasProblems))
)

function actionHref(action: Exclude<ProblemAction, null>, t: TrackReport) {
    return buildHash(action, t.releaseId, t.trackIndex)
}

function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} Б`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

const BATCH = 60

async function build() {
    loading.value = true
    error.value = ''
    try {
        await repo.load()
        if (repo.state.error) throw new AdminApiError('repo', 0, repo.state.error)
        const releases = repo.state.releases!
        const needed = contentPathsNeeded(releases, repo.state.files)
        const batches: string[][] = []
        for (let i = 0; i < needed.length; i += BATCH) batches.push(needed.slice(i, i + BATCH))
        const parts = await Promise.all(batches.map((b) => readFiles(repo.state.sha, b)))
        report.value = computeCatalogReport(releases, repo.state.files, Object.assign({}, ...parts))
    } catch (e) {
        error.value = e instanceof AdminApiError ? e.message : `Не удалось построить отчёт: ${(e as Error).message}`
    } finally {
        loading.value = false
    }
}

async function refresh() {
    await repo.reload()
    await build()
}

onMounted(build)
</script>
