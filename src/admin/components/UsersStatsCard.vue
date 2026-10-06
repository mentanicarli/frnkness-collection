<template>
    <section class="adm-card" data-testid="users-stats" aria-labelledby="users-stats-title">
        <div class="adm-row" style="margin-bottom: 0.75rem">
            <h2 id="users-stats-title" class="adm-h2" style="margin: 0">Пользователи</h2>
            <span class="adm-spacer"></span>
            <a class="adm-small" href="#/users">Список пользователей</a>
        </div>
        <div v-if="error" class="adm-alert adm-alert-error" role="alert">{{ error }}</div>
        <template v-else-if="overview">
            <div class="adm-tiles" style="margin-bottom: 1rem">
                <div class="adm-tile">
                    <div class="adm-tile-label">Всего</div>
                    <div class="adm-tile-value">{{ formatNumber(overview.total) }}</div>
                    <div class="adm-tile-hint">аккаунтов</div>
                </div>
                <div class="adm-tile">
                    <div class="adm-tile-label">Активные</div>
                    <div class="adm-tile-value">{{ formatNumber(overview.active7) }}</div>
                    <div class="adm-tile-hint">за 7 дней: слушали или входили</div>
                </div>
                <div class="adm-tile">
                    <div class="adm-tile-label">Новые</div>
                    <div class="adm-tile-value">{{ formatNumber(overview.new7) }}</div>
                    <div class="adm-tile-hint">за 7 дней</div>
                </div>
                <div class="adm-tile">
                    <div class="adm-tile-label">Забанены</div>
                    <div class="adm-tile-value">{{ formatNumber(overview.banned) }}</div>
                    <div class="adm-tile-hint">сейчас</div>
                </div>
            </div>
            <h3 class="adm-label" style="margin-bottom: 0.5rem">Регистрации по дням, последние 30 дней</h3>
            <BarChart :points="points" :busy="loading" aria-label="Регистрации по дням" empty-text="Регистраций не было" value-label="Регистрации" :format="(v) => `${v}`" />
        </template>
        <p v-else class="adm-faint adm-small">Загрузка…</p>
    </section>
</template>

<script setup lang="ts">
// «Статистика» → пользователи: число, активные за неделю, регистрации по дням.
import { onMounted, ref } from 'vue'
import BarChart, { type BarPoint } from './BarChart.vue'
import { fetchRegistrationsDaily, fetchUsersOverview, type UsersOverview } from '../api/users'
import { AdminApiError } from '../api/content'
import { addDays, formatMediumDate, formatShortDate, moscowToday } from '../lib/dates'
import { formatNumber } from '../lib/format'

const overview = ref<UsersOverview | null>(null)
const points = ref<BarPoint[]>([])
const error = ref('')
const loading = ref(false)

async function load() {
    loading.value = true
    error.value = ''
    try {
        const to = moscowToday()
        const from = addDays(to, -29)
        const [o, daily] = await Promise.all([fetchUsersOverview(), fetchRegistrationsDaily(from, to)])
        overview.value = o
        points.value = daily.map((d) => {
            const day = String(d.day).slice(0, 10)
            return { key: day, label: formatShortDate(day), title: formatMediumDate(day), value: d.plays }
        })
    } catch (e) {
        error.value = e instanceof AdminApiError ? e.message : 'Не удалось загрузить статистику пользователей'
    } finally {
        loading.value = false
    }
}

onMounted(load)
defineExpose({ load })
</script>
