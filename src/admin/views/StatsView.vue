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
            Журнал прослушиваний по дням ещё не запущен — примени миграцию этапа 2. Итог за всё время уже доступен.
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
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(t, i) in release.tracks" :key="i">
                            <td class="num adm-faint">{{ t.num }}</td>
                            <td>{{ t.title }}</td>
                            <td class="num">{{ formatNumber(trackAllTime[i] || 0) }}</td>
                            <td v-if="preset !== 'all' && period" class="num">{{ formatNumber(trackPeriod[i] || 0) }}</td>
                        </tr>
                    </tbody>
                </table>

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
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import type { Releases } from '@/types'
import BarChart, { type BarPoint } from '../components/BarChart.vue'
import { useRepo } from '../composables/useRepo'
import { AdminApiError } from '../api/content'
import { fetchAllTime, fetchByKey, fetchDaily, fetchDailyByKey, fetchOverview, type StatsOverview } from '../api/stats'
import { addDays, diffDays, formatMediumDate, formatShortDate, isValidIsoDate, moscowDateOf } from '../lib/dates'
import {
    aggregatePlays,
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

async function loadBase() {
    loadingBase.value = true
    error.value = ''
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
