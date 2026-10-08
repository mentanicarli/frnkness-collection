<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Статистика</h1>
            <p class="adm-sub">
                Дни считаются по Москве.
                <template v-if="trackingStart">По дням данные есть с {{ formatMediumDate(trackingStart) }} — с запуска журнала прослушиваний.</template>
            </p>
        </div>
        <button class="adm-btn" type="button" :disabled="loadingBase" @click="loadBase">Обновить</button>
    </div>

    <div v-if="error" class="adm-alert adm-alert-error" role="alert">{{ error }}</div>
    <div v-else-if="repo.state.error" class="adm-alert adm-alert-error" role="alert">{{ repo.state.error }}</div>

    <template v-if="overview">
        <!-- Сводка -->
        <section class="adm-tiles" aria-label="Сводка" data-testid="tiles">
            <div class="adm-tile">
                <div class="adm-tile-label">Всего</div>
                <div class="adm-tile-value">{{ formatNumber(overview.total) }}</div>
                <div class="adm-tile-hint">за всё время</div>
            </div>
            <div v-for="t in recentTiles" :key="t.label" class="adm-tile">
                <div class="adm-tile-label">{{ t.label }}</div>
                <div class="adm-tile-value">{{ overview.tracking_since ? formatNumber(t.value) : '—' }}</div>
                <div class="adm-tile-hint">{{ t.hint }}</div>
            </div>
        </section>

        <div v-if="!overview.tracking_since" class="adm-alert adm-alert-warn">
            Журнал прослушиваний по дням ещё не запущен — примени миграции (см. docs/operations.md). Итог за всё время уже доступен.
        </div>

        <!-- Фильтр периода: один на график и топы ниже -->
        <div class="adm-filter-row" role="group" aria-label="Период">
            <div class="adm-segmented">
                <button
                    v-for="p in PRESETS"
                    :key="p.id"
                    type="button"
                    :class="{ active: preset === p.id }"
                    :aria-pressed="preset === p.id"
                    @click="preset = p.id"
                >{{ p.label }}</button>
            </div>
            <div v-if="preset === 'custom'" class="adm-row adm-custom-range">
                <input v-model="custom.from" class="adm-input" type="date" aria-label="С" :max="today" />
                <span class="adm-faint">—</span>
                <input v-model="custom.to" class="adm-input" type="date" aria-label="По" :max="today" />
            </div>
        </div>
        <p v-if="period" class="adm-period-note adm-faint adm-small" data-testid="period-note">
            {{ periodText }}
            <template v-if="period.clippedBefore"> Раньше {{ formatMediumDate(period.from) }} журнал не вёлся — эти дни не показаны.</template>
            <template v-if="preset === 'all'"> Топы — за всё время (включая прослушивания до запуска журнала), график — с запуска журнала.</template>
        </p>
        <p v-else-if="preset === 'custom'" class="adm-period-note adm-faint adm-small">Выбери даты начала и конца периода.</p>

        <section v-if="period" class="adm-card">
            <h2 class="adm-h2">Прослушивания по дням</h2>
            <BarChart :points="dailyPoints" :busy="loadingPeriod" aria-label="Прослушивания по дням за выбранный период" />
        </section>

        <div class="adm-grid adm-grid-2">
            <section class="adm-card" data-testid="top-tracks">
                <h2 class="adm-h2">Топ треков {{ topSuffix }}</h2>
                <ol v-if="tops.tracks.length" class="adm-top-list" :class="{ 'is-busy': loadingPeriod }">
                    <li v-for="(t, i) in tops.tracks.slice(0, topLimit)" :key="t.releaseId + t.trackIndex">
                        <span class="adm-top-rank">{{ i + 1 }}</span>
                        <span class="adm-top-main">
                            <span class="adm-top-title">{{ t.title }}</span>
                            <span class="adm-top-sub">{{ t.releaseTitle }}</span>
                            <span class="adm-top-bar" :style="{ width: barWidth(t.plays, tops.tracks[0].plays) }"></span>
                        </span>
                        <span class="adm-top-value">{{ formatNumber(t.plays) }}</span>
                    </li>
                </ol>
                <p v-else class="adm-faint adm-small">Нет прослушиваний.</p>
                <button v-if="tops.tracks.length > topLimit" class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click="topLimit += 20">Показать ещё</button>
            </section>

            <section class="adm-card" data-testid="top-releases">
                <h2 class="adm-h2">Топ релизов {{ topSuffix }}</h2>
                <ol v-if="tops.releases.length" class="adm-top-list" :class="{ 'is-busy': loadingPeriod }">
                    <li v-for="(r, i) in tops.releases" :key="r.releaseId">
                        <span class="adm-top-rank">{{ i + 1 }}</span>
                        <button class="adm-top-main adm-top-link" type="button" @click="openRelease(r.releaseId)">
                            <span class="adm-top-title">{{ r.title }}</span>
                            <span class="adm-top-sub">{{ r.type === 'album' ? 'Альбом' : 'Сингл' }}</span>
                            <span class="adm-top-bar" :style="{ width: barWidth(r.plays, tops.releases[0].plays) }"></span>
                        </button>
                        <span class="adm-top-value">{{ formatNumber(r.plays) }}</span>
                    </li>
                </ol>
                <p v-else class="adm-faint adm-small">Нет прослушиваний.</p>
                <details v-if="tops.unknown.length" class="adm-small adm-faint adm-unknown">
                    <summary>{{ formatNumber(unknownTotal) }} {{ pluralPlays(unknownTotal) }} без трека в каталоге</summary>
                    <ul>
                        <li v-for="u in tops.unknown" :key="u.track_key"><span class="adm-mono">{{ u.track_key }}</span> — {{ u.plays }}</li>
                    </ul>
                </details>
            </section>
        </div>

        <!-- Дослушивают или пропускают -->
        <section class="adm-card" style="margin-top: 1rem" data-testid="listen">
            <h2 class="adm-h2">Дослушивают или пропускают</h2>
            <p class="adm-small adm-faint" style="margin-top: 0" data-testid="listen-note">{{ listenNote }}</p>
            <template v-if="listenTracks.length">
                <div class="adm-table-scroll">
                    <table class="adm-table adm-listen-table" :class="{ 'is-busy': loadingListen }">
                        <thead>
                            <tr>
                                <th>Трек</th>
                                <th class="num">Сессий</th>
                                <th class="num" title="Событие «конец трека» или прослушано ≥ 95%">Дослушали</th>
                                <th class="num">Ср. доля</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="t in listenTracks.slice(0, listenLimit)" :key="t.releaseId + t.trackIndex" class="adm-click-row" @click="openListenTrack(t.releaseId, t.trackIndex)">
                                <td>
                                    <span class="adm-top-title">{{ t.title }}</span>
                                    <span class="adm-top-sub" style="display: block">{{ t.releaseTitle }}</span>
                                </td>
                                <td class="num">{{ formatNumber(t.sessions) }}</td>
                                <td class="num">{{ percent(t.completedShare) }}</td>
                                <td class="num">{{ percent(t.avgShare) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <button v-if="listenTracks.length > listenLimit" class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click="listenLimit += 20">Показать ещё</button>
            </template>
        </section>

        <!-- Карточка релиза -->
        <section ref="releaseCard" class="adm-card adm-release-card" data-testid="release-card">
            <div class="adm-row adm-release-head">
                <h2 class="adm-h2" style="margin: 0">Релиз</h2>
                <select v-model="releaseId" class="adm-select adm-release-select" aria-label="Релиз">
                    <option v-for="(r, id) in releases" :key="id" :value="id">{{ r.title }}</option>
                </select>
            </div>

            <template v-if="release">
                <p class="adm-faint adm-small">
                    {{ release.type === 'album' ? 'Альбом' : 'Сингл' }} • {{ release.releaseDate || release.year }} •
                    всего {{ formatNumber(releaseTotal) }} {{ pluralPlays(releaseTotal) }}
                </p>

                <table class="adm-table adm-release-tracks">
                    <thead>
                        <tr>
                            <th class="num">#</th>
                            <th>Трек</th>
                            <th class="num">Всего</th>
                            <th v-if="preset !== 'all' && period" class="num">За период</th>
                            <template v-if="listenPeriod">
                                <th class="num">Сессий</th>
                                <th class="num">Дослушали</th>
                                <th class="num">Ср. доля</th>
                            </template>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="(t, i) in release.tracks"
                            :key="i"
                            :class="{ 'adm-click-row': listenPeriod, 'is-selected': listenPeriod && i === listenTrackIndex }"
                            @click="listenPeriod && (listenTrackIndex = i)"
                        >
                            <td class="num adm-faint">{{ t.num }}</td>
                            <td>{{ t.title }}</td>
                            <td class="num">{{ formatNumber(trackAllTime[i] || 0) }}</td>
                            <td v-if="preset !== 'all' && period" class="num">{{ formatNumber(trackPeriod[i] || 0) }}</td>
                            <template v-if="listenPeriod">
                                <td class="num">{{ releaseListen[i] ? formatNumber(releaseListen[i]!.sessions) : '—' }}</td>
                                <td class="num">{{ releaseListen[i] ? percent(releaseListen[i]!.completedShare) : '—' }}</td>
                                <td class="num">{{ releaseListen[i] ? percent(releaseListen[i]!.avgShare) : '—' }}</td>
                            </template>
                        </tr>
                    </tbody>
                </table>

                <template v-if="listenPeriod">
                    <div class="adm-row adm-window-head">
                        <h3 class="adm-h2" style="margin: 0">Удержание</h3>
                        <select v-model.number="listenTrackIndex" class="adm-select adm-release-select" aria-label="Трек для удержания">
                            <option v-for="(t, i) in release.tracks" :key="i" :value="i">{{ t.num }}. {{ t.title }}</option>
                        </select>
                    </div>
                    <p class="adm-small adm-faint" data-testid="retention-note">{{ retentionNote }}</p>
                    <BarChart
                        v-if="retentionPoints.length"
                        :points="retentionPoints"
                        :busy="loadingRetention"
                        column-label="Секунда трека"
                        value-label="Ещё слушают"
                        :format="(v: number) => `${v}%`"
                        empty-text="Нет данных"
                        :aria-label="`Удержание слушателей трека ${release.tracks[listenTrackIndex]?.title ?? ''}`"
                        data-testid="retention-chart"
                    />
                </template>

                <div class="adm-row adm-window-head">
                    <h3 class="adm-h2" style="margin: 0">Первые дни после релиза</h3>
                    <div class="adm-segmented adm-segmented-sm">
                        <button v-for="d in [7, 30] as const" :key="d" type="button" :class="{ active: windowDays === d }"
                                :aria-pressed="windowDays === d" @click="windowDays = d">{{ d }} дней</button>
                    </div>
                </div>
                <p class="adm-small adm-faint" data-testid="window-note">{{ windowText }}</p>
                <BarChart
                    v-if="windowPoints.length"
                    :points="windowPoints"
                    :busy="loadingWindow"
                    column-label="День после релиза"
                    empty-text="Нет прослушиваний в эти дни"
                    :aria-label="`Прослушивания релиза ${release.title} по дням после выхода`"
                />
            </template>
        </section>
    </template>
    <div v-else-if="loadingBase && !error" class="adm-empty"><span class="adm-spinner"></span></div>

    <UsersStatsCard style="margin-top: 1rem" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import type { Releases } from '@/types'
import BarChart, { type BarPoint } from '../components/BarChart.vue'
import UsersStatsCard from '../components/UsersStatsCard.vue'
import { useRepo } from '../composables/useRepo'
import { AdminApiError } from '../api/content'
import {
    fetchAllTime,
    fetchByKey,
    fetchDaily,
    fetchDailyByKey,
    fetchListenByKey,
    fetchListenMeta,
    fetchOverview,
    fetchRetention,
    type ListenKeyRow,
    type ListenMeta,
    type RetentionRow,
    type StatsOverview
} from '../api/stats'
import { addDays, diffDays, formatMediumDate, formatShortDate, isValidIsoDate, moscowDateOf } from '../lib/dates'
import {
    aggregateListen,
    aggregatePlays,
    clipToStart,
    formatSeconds,
    percent,
    retentionPercents,
    dayNumber,
    fillDays,
    releaseDailySeries,
    releaseTrackPlays,
    releaseWindow,
    resolvePeriod,
    type DayKeyPlays,
    type DayPlays,
    type KeyPlays,
    type PeriodPreset
} from '../lib/stats'
import { formatNumber, pluralPlays } from '../lib/format'

type Preset = PeriodPreset | 'all'

const PRESETS: { id: Preset; label: string }[] = [
    { id: '7d', label: '7 дней' },
    { id: '30d', label: '30 дней' },
    { id: '90d', label: '90 дней' },
    { id: 'all', label: 'Всё время' },
    { id: 'custom', label: 'Свой период' }
]

const repo = useRepo()
const overview = ref<StatsOverview | null>(null)
const allTime = ref<KeyPlays[]>([])
const daily = ref<DayPlays[]>([])
const periodKeys = ref<KeyPlays[]>([])
const windowRows = ref<DayKeyPlays[]>([])
const error = ref('')
const loadingBase = ref(false)
const loadingPeriod = ref(false)
const loadingWindow = ref(false)
const preset = ref<Preset>('30d')
const custom = reactive({ from: '', to: '' })
const topLimit = ref(10)
const releaseId = ref('')
const windowDays = ref<7 | 30>(7)
const releaseCard = ref<HTMLElement | null>(null)

const releases = computed<Releases>(() => repo.state.releases || {})
const today = computed(() => overview.value?.today_date || '')
const trackingStart = computed(() => (overview.value?.tracking_since ? moscowDateOf(overview.value.tracking_since) : ''))

const recentTiles = computed(() => {
    const o = overview.value!
    const partial = (days: number) =>
        trackingStart.value && diffDays(trackingStart.value, today.value) < days - 1 ? `с ${formatShortDate(trackingStart.value)}` : ''
    return [
        { label: 'Сегодня', value: o.today, hint: 'по Москве' },
        { label: '7 дней', value: o.last7, hint: partial(7) || 'включая сегодня' },
        { label: '30 дней', value: o.last30, hint: partial(30) || 'включая сегодня' }
    ]
})

const period = computed(() => {
    if (!overview.value) return null
    const p: PeriodPreset = preset.value === 'all' ? 'since' : preset.value
    const customOk = isValidIsoDate(custom.from) && isValidIsoDate(custom.to) && custom.from <= custom.to
    return resolvePeriod(p, today.value, overview.value.tracking_since, customOk ? { from: custom.from, to: custom.to } : undefined)
})

const periodText = computed(() => {
    const p = period.value
    if (!p) return ''
    return p.from === p.to ? `Период: ${formatMediumDate(p.from)}.` : `Период: ${formatMediumDate(p.from)} — ${formatMediumDate(p.to)}.`
})

const topSuffix = computed(() => (preset.value === 'all' ? 'за всё время' : 'за период'))

const dailyPoints = computed<BarPoint[]>(() => {
    const p = period.value
    if (!p) return []
    return fillDays(daily.value, p.from, p.to).map((d) => ({
        key: d.day,
        label: formatShortDate(d.day),
        title: formatMediumDate(d.day),
        value: d.plays
    }))
})

const tops = computed(() => aggregatePlays(preset.value === 'all' ? allTime.value : periodKeys.value, releases.value))
const unknownTotal = computed(() => tops.value.unknown.reduce((s, u) => s + u.plays, 0))

const barWidth = (value: number, max: number) => `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`

// ── Релиз ────────────────────────────────────────────────────────────
const release = computed(() => releases.value[releaseId.value] || null)
const trackAllTime = computed(() => releaseTrackPlays(allTime.value, releases.value, releaseId.value))
const trackPeriod = computed(() => releaseTrackPlays(periodKeys.value, releases.value, releaseId.value))
const releaseTotal = computed(() => trackAllTime.value.reduce((s, v) => s + v, 0))
const win = computed(() =>
    release.value && overview.value
        ? releaseWindow(release.value.releaseDate, windowDays.value, overview.value.tracking_since, today.value)
        : null
)

const windowPoints = computed<BarPoint[]>(() => {
    const w = win.value
    if (!w || !w.queryFrom || !w.queryTo || !w.releaseDate) return []
    return releaseDailySeries(windowRows.value, releaseId.value, w.queryFrom, w.queryTo).map((d) => {
        const n = dayNumber(w.releaseDate!, d.day)
        return { key: d.day, label: `д${n}`, title: `День ${n} · ${formatMediumDate(d.day)}`, value: d.plays }
    })
})

const windowText = computed(() => {
    const w = win.value
    if (!w) return ''
    const days = windowDays.value
    const start = trackingStart.value ? formatMediumDate(trackingStart.value) : ''
    switch (w.status) {
        case 'no-date':
            return 'У релиза не указана дата выхода.'
        case 'future':
            return `Релиз выйдет ${formatMediumDate(w.releaseDate!)}.`
        case 'no-tracking':
            return 'Журнал прослушиваний по дням ещё не запущен.'
        case 'before-tracking':
            return `Релиз вышел ${formatMediumDate(w.releaseDate!)}, а журнал по дням ведётся с ${start} — данных о первых ${days} днях нет.`
        case 'partial': {
            const missed = diffDays(w.from!, w.queryFrom!)
            return `Журнал запущен ${start}: первые ${missed} дн. после релиза не записаны, показаны дни ${dayNumber(w.releaseDate!, w.queryFrom!)}–${dayNumber(w.releaseDate!, w.queryTo!)}. Всего за них: ${windowTotal.value}.`
        }
        default: {
            const passed = diffDays(w.from!, w.queryTo!) + 1
            const tail = passed < days ? ` Прошло ${passed} из ${days} дней.` : ''
            return `С ${formatMediumDate(w.from!)} по ${formatMediumDate(w.to!)}: ${windowTotal.value} ${pluralPlays(windowTotal.value)}.${tail}`
        }
    }
})
const windowTotal = computed(() => windowPoints.value.reduce((s, p) => s + p.value, 0))

async function openRelease(id: string) {
    releaseId.value = id
    await nextTick()
    releaseCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ── Загрузка ─────────────────────────────────────────────────────────
const message = (e: unknown) => (e instanceof AdminApiError ? e.message : `Ошибка: ${(e as Error).message}`)

// ── Дослушивают или пропускают ───────────────────────────────────────
const listenMeta = ref<ListenMeta | null>(null)
const listenUnavailable = ref('')
const listenRows = ref<ListenKeyRow[]>([])
const retentionRows = ref<RetentionRow[]>([])
const listenTrackIndex = ref(0)
const listenLimit = ref(15)
const loadingListen = ref(false)
const loadingRetention = ref(false)

const listenStart = computed(() => (listenMeta.value?.started_at ? moscowDateOf(listenMeta.value.started_at) : ''))
// Тот же период, что у графика и топов, но не раньше начала сбора сессий.
const listenPeriod = computed(() => (period.value && listenMeta.value ? clipToStart(period.value, listenMeta.value.started_at) : null))
const listenTracks = computed(() => aggregateListen(listenRows.value, releases.value))
const releaseListen = computed(() => {
    const byIndex: (ReturnType<typeof aggregateListen>[number] | undefined)[] = []
    for (const t of listenTracks.value) if (t.releaseId === releaseId.value) byIndex[t.trackIndex] = t
    return byIndex
})

const listenNote = computed(() => {
    if (listenUnavailable.value) return listenUnavailable.value
    if (!listenMeta.value) return ''
    const since = listenStart.value ? `Данные собираются с ${formatMediumDate(listenStart.value)} — с применения миграции.` : ''
    if (!listenPeriod.value) return `${since} За выбранный период данных нет.`
    const p = listenPeriod.value
    const range = p.from === p.to ? formatMediumDate(p.from) : `${formatMediumDate(p.from)} — ${formatMediumDate(p.to)}`
    const empty = listenTracks.value.length ? '' : ' Сессий пока нет.'
    return `${since} Период: ${range}. Дослушали — конец трека или ≥ 95% прослушано; перемотка не считается.${empty}`
})

const retentionPoints = computed<BarPoint[]>(() =>
    retentionPercents(retentionRows.value).map((r) => ({
        key: String(r.second),
        label: formatSeconds(r.second),
        title: `На ${formatSeconds(r.second)}`,
        value: r.percent
    }))
)
const retentionNote = computed(() => {
    const total = retentionRows.value[0]?.sessions ?? 0
    if (!total) return 'По этому треку за период сессий нет.'
    return `Сколько слушателей ещё слушают на каждой 5-й секунде (из ${formatNumber(total)} сессий).`
})

function openListenTrack(id: string, index: number) {
    releaseId.value = id
    listenTrackIndex.value = index
    nextTick(() => releaseCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

async function loadListenMeta() {
    try {
        listenMeta.value = await fetchListenMeta()
        listenUnavailable.value = ''
    } catch (e) {
        listenMeta.value = null
        listenUnavailable.value =
            e instanceof AdminApiError && e.code === 'missing'
                ? 'Сбор ещё не запущен — примени миграцию 20261003120000_listen_sessions.sql (supabase db push).'
                : message(e)
    }
}

let listenToken = 0
async function loadListen() {
    const p = listenPeriod.value
    if (!p) {
        listenRows.value = []
        return
    }
    const token = ++listenToken
    loadingListen.value = true
    try {
        const rows = await fetchListenByKey(p.from, p.to)
        if (token === listenToken) listenRows.value = rows
    } catch (e) {
        if (token === listenToken) listenUnavailable.value = message(e)
    } finally {
        if (token === listenToken) loadingListen.value = false
    }
}

let retentionToken = 0
async function loadRetention() {
    const p = listenPeriod.value
    if (!p || !release.value) {
        retentionRows.value = []
        return
    }
    const token = ++retentionToken
    loadingRetention.value = true
    try {
        const rows = await fetchRetention(`${releaseId.value}-${listenTrackIndex.value}`, p.from, p.to)
        if (token === retentionToken) retentionRows.value = rows
    } catch {
        if (token === retentionToken) retentionRows.value = []
    } finally {
        if (token === retentionToken) loadingRetention.value = false
    }
}

watch(() => (listenPeriod.value ? `${listenPeriod.value.from}|${listenPeriod.value.to}` : ''), () => {
    loadListen()
    loadRetention()
})
watch([releaseId, listenTrackIndex], ([id], [prevId]) => {
    if (id !== prevId && listenTrackIndex.value >= (release.value?.tracks.length ?? 0)) listenTrackIndex.value = 0
    loadRetention()
})

async function loadBase() {
    loadingBase.value = true
    error.value = ''
    // Сессии грузятся отдельно: если их данных нет, остальной дашборд работает.
    loadListenMeta()
    try {
        const [o, all] = await Promise.all([fetchOverview(), fetchAllTime(), repo.load()])
        overview.value = o
        allTime.value = all
        if (!releaseId.value) {
            // По умолчанию — самый свежий релиз (последний в реестре).
            const ids = Object.keys(releases.value)
            releaseId.value = ids[ids.length - 1] || ''
        }
        await Promise.all([loadPeriod(), loadWindow()])
    } catch (e) {
        error.value = message(e)
    } finally {
        loadingBase.value = false
    }
}

let periodToken = 0
async function loadPeriod() {
    const p = period.value
    if (!p) return
    const token = ++periodToken
    loadingPeriod.value = true
    try {
        const [d, k] = await Promise.all([fetchDaily(p.from, p.to), fetchByKey(p.from, p.to)])
        if (token !== periodToken) return
        daily.value = d
        periodKeys.value = k
    } catch (e) {
        if (token === periodToken) error.value = message(e)
    } finally {
        if (token === periodToken) loadingPeriod.value = false
    }
}

let windowToken = 0
async function loadWindow() {
    const w = win.value
    if (!w || !w.queryFrom || !w.queryTo) {
        windowRows.value = []
        return
    }
    const token = ++windowToken
    loadingWindow.value = true
    try {
        const rows = await fetchDailyByKey(w.queryFrom, w.queryTo)
        if (token === windowToken) windowRows.value = rows
    } catch (e) {
        if (token === windowToken) error.value = message(e)
    } finally {
        if (token === windowToken) loadingWindow.value = false
    }
}

watch(() => (period.value ? `${period.value.from}|${period.value.to}` : ''), () => {
    if (overview.value) loadPeriod()
})
watch(() => (win.value ? `${win.value.queryFrom}|${win.value.queryTo}` : ''), () => {
    if (overview.value) loadWindow()
})
watch(preset, (p) => {
    topLimit.value = 10
    if (p === 'custom' && !custom.from && today.value) {
        custom.from = addDays(today.value, -13)
        custom.to = today.value
    }
})

onMounted(loadBase)
</script>
