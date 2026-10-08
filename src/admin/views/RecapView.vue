<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Итоги года</h1>
            <p class="adm-sub">Пока итоги не открыты, пользователи не видят ничего. Год считается по Москве; текущий год обновляется при каждом просмотре, закончившийся — зафиксирован.</p>
        </div>
        <div class="adm-row">
            <select v-model.number="year" class="adm-select" style="width: auto" aria-label="Год" data-testid="recap-year">
                <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
            </select>
            <button class="adm-btn" type="button" :disabled="loading" @click="loadAll">Обновить</button>
        </div>
    </div>

    <div v-if="error" class="adm-alert adm-alert-error" role="alert" data-testid="recap-admin-error">{{ error }}</div>
    <div v-if="notice" class="adm-alert adm-alert-ok" role="status" data-testid="recap-admin-notice">{{ notice }}</div>

    <!-- Общие цифры -->
    <template v-if="overview">
        <section class="adm-tiles" aria-label="Общие цифры" data-testid="recap-overview">
            <div class="adm-tile"><div class="adm-tile-label">Слушали с аккаунтом</div><div class="adm-tile-value">{{ formatNumber(overview.users_listening) }}</div><div class="adm-tile-hint">из {{ formatNumber(overview.users_total) }}</div></div>
            <div class="adm-tile"><div class="adm-tile-label">Прослушиваний</div><div class="adm-tile-value">{{ formatNumber(overview.plays) }}</div></div>
            <div class="adm-tile"><div class="adm-tile-label">Минут</div><div class="adm-tile-value">{{ formatNumber(overview.minutes) }}</div></div>
            <div class="adm-tile"><div class="adm-tile-label">В избранное</div><div class="adm-tile-value">{{ formatNumber(overview.favorites_added) }}</div><div class="adm-tile-hint">комнат: {{ formatNumber(overview.rooms) }}</div></div>
        </section>
        <section v-if="overviewTop.length" class="adm-card" aria-label="Топ треков года">
            <h2 class="adm-h2">Топ треков у всех</h2>
            <ol class="adm-top-list">
                <li v-for="(t, i) in overviewTop" :key="t.key">
                    <span class="adm-top-rank">{{ i + 1 }}</span>
                    <span class="adm-top-main"><span class="adm-top-title">{{ t.title }}</span></span>
                    <span class="adm-top-value">{{ formatNumber(t.plays) }}</span>
                </li>
            </ol>
        </section>
    </template>

    <!-- Публикация -->
    <section class="adm-card" aria-label="Публикация" data-testid="recap-publish">
        <h2 class="adm-h2">Кому открыты итоги {{ year }}</h2>
        <p v-if="!status" class="adm-faint adm-small">Загрузка…</p>
        <template v-else>
            <p class="adm-small" data-testid="recap-status">
                <b>{{ MODE_TEXT[status.mode] }}</b>
                · видят {{ formatNumber(status.visible_count) }} из {{ formatNumber(status.users_total) }}
                <template v-if="status.mode === 'all'"> · «Показать всем» действует и на тех, кто зарегистрируется позже</template>
            </p>

            <ul v-if="status.grants.length" class="adm-recap-grants" data-testid="recap-grants">
                <li v-for="g in status.grants" :key="g.user_id">
                    <UserAvatar :avatar="g.avatar" :nick="g.nick" :user-id="g.user_id" :size="1.75" />
                    <span>{{ g.nick }}</span>
                    <span class="adm-chip" :class="g.granted ? 'ok' : 'err'">{{ g.granted ? 'открыто' : 'скрыто' }}</span>
                </li>
            </ul>
            <p v-else-if="status.mode === 'selected'" class="adm-faint adm-small">Выбранных нет.</p>

            <div class="adm-row" style="margin-top: 0.75rem">
                <template v-if="confirming">
                    <span class="adm-small">{{ confirming === 'show_all' ? `Открыть итоги ${year} всем пользователям?` : `Скрыть итоги ${year} у всех?` }}</span>
                    <button class="adm-btn adm-btn-primary adm-btn-sm" type="button" :disabled="busy" data-testid="recap-confirm" @click="run(confirming!)">Да</button>
                    <button class="adm-btn adm-btn-ghost adm-btn-sm" type="button" :disabled="busy" @click="confirming = null">Отмена</button>
                </template>
                <template v-else>
                    <button class="adm-btn adm-btn-primary" type="button" :disabled="busy" data-testid="recap-show-all" @click="confirming = 'show_all'">Показать всем</button>
                    <button class="adm-btn adm-btn-danger" type="button" :disabled="busy || status.mode === 'off' && !status.grants.length" data-testid="recap-hide-all" @click="confirming = 'hide_all'">Скрыть у всех</button>
                </template>
            </div>
        </template>
    </section>

    <!-- Пользователи: выбор и просмотр -->
    <section class="adm-card" aria-label="Пользователи" data-testid="recap-users">
        <h2 class="adm-h2">Выбранным и просмотр</h2>
        <div class="adm-row">
            <input v-model="search" class="adm-input" style="max-width: 22rem" type="search" placeholder="Ник…" aria-label="Поиск по нику" maxlength="40" data-testid="recap-search" />
            <button class="adm-btn adm-btn-sm" type="button" :disabled="busy || !selected.size" data-testid="recap-show-selected" @click="run('show_selected')">Показать выбранным ({{ selected.size }})</button>
            <button class="adm-btn adm-btn-danger adm-btn-sm" type="button" :disabled="busy || !selected.size" data-testid="recap-hide-selected" @click="run('hide_selected')">Скрыть выбранным</button>
        </div>
        <p v-if="!users.length && !usersLoading" class="adm-faint adm-small" style="margin-top: 0.75rem">Никого не нашли.</p>
        <ul class="adm-recap-users">
            <li v-for="u in users" :key="u.id" :class="{ active: previewId === u.id }">
                <label class="adm-recap-pick">
                    <input type="checkbox" :checked="selected.has(u.id)" :aria-label="`Выбрать ${u.nick}`" :data-testid="`recap-pick-${u.nick}`" @change="toggle(u.id)" />
                    <UserAvatar :avatar="u.avatar" :nick="u.nick ?? '?'" :user-id="u.id" :size="1.75" />
                    <span class="adm-recap-nick">{{ u.nick }}</span>
                </label>
                <span class="adm-chip" :class="canSee(u.id) ? 'ok' : ''" :data-testid="`recap-vis-${u.nick}`">{{ canSee(u.id) ? 'открыто' : 'закрыто' }}</span>
                <button class="adm-btn adm-btn-ghost adm-btn-sm" type="button" :data-testid="`recap-view-${u.nick}`" @click="preview(u.id)">Посмотреть</button>
            </li>
        </ul>
    </section>

    <!-- Предпросмотр: те же карточки, что увидит пользователь -->
    <section v-if="previewId" class="adm-card" aria-label="Как это увидит пользователь" data-testid="recap-preview">
        <h2 class="adm-h2">Так увидит {{ previewNick }}</h2>
        <p v-if="previewError" class="adm-alert adm-alert-error" role="alert">{{ previewError }}</p>
        <p v-else-if="!previewData" class="adm-faint adm-small">Загрузка…</p>
        <RecapStory v-else :recap="previewData" :catalog="catalog" embedded @close="previewId = ''" />
    </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import UserAvatar from '@/site/components/UserAvatar.vue'
import RecapStory from '@/site/recap/RecapStory.vue'
import { catalogFromReleases } from '@/site/recap/catalog'
import type { Recap } from '@/site/recap/types'
import { useRepo } from '../composables/useRepo'
import { AdminApiError } from '../api/content'
import { fetchUsers, type UserRow } from '../api/users'
import {
    fetchRecapOverview,
    fetchRecapStatus,
    fetchUserRecap,
    setRecapPublication,
    type RecapAction,
    type RecapMode,
    type RecapOverview,
    type RecapStatus
} from '../api/recap'
import { formatNumber } from '../lib/format'

const MODE_TEXT: Record<RecapMode, string> = { off: 'Закрыто для всех', selected: 'Открыто выбранным', all: 'Открыто всем' }

const repo = useRepo()
const catalog = computed(() => catalogFromReleases(repo.state.releases || {}))

const startYear = 2024
const currentYear = Number(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }).slice(0, 4))
const years = Array.from({ length: Math.max(1, currentYear - startYear + 1) }, (_, i) => currentYear - i)
const year = ref(currentYear)

const overview = ref<RecapOverview | null>(null)
const status = ref<RecapStatus | null>(null)
const error = ref('')
const notice = ref('')
const loading = ref(false)
const busy = ref(false)
const confirming = ref<'show_all' | 'hide_all' | null>(null)

const users = ref<UserRow[]>([])
const usersLoading = ref(false)
const search = ref('')
const selected = ref(new Set<string>())

const previewId = ref('')
const previewData = ref<Recap | null>(null)
const previewError = ref('')
const previewNick = computed(() => users.value.find((u) => u.id === previewId.value)?.nick ?? previewData.value?.user?.nick ?? '')

const text = (e: unknown) => (e instanceof AdminApiError ? e.message : 'Что-то пошло не так — попробуй ещё раз')

const overviewTop = computed(() =>
    (overview.value?.top_tracks ?? []).map((t) => {
        const info = catalog.value.track(t.track_key)
        return { key: t.track_key, title: info ? `${info.title} — ${info.releaseTitle}` : `${t.track_key} (нет в каталоге)`, plays: t.plays }
    })
)

function canSee(userId: string): boolean {
    const s = status.value
    if (!s) return false
    const g = s.grants.find((x) => x.user_id === userId)
    return g ? g.granted : s.mode === 'all'
}

async function loadAll() {
    loading.value = true
    error.value = ''
    try {
        const [o, s] = await Promise.all([fetchRecapOverview(year.value), fetchRecapStatus(year.value), repo.load().catch(() => undefined)])
        overview.value = o
        status.value = s
    } catch (e) {
        overview.value = null
        status.value = null
        error.value = text(e)
    } finally {
        loading.value = false
    }
}

let searchToken = 0
async function loadUsers() {
    const mine = ++searchToken
    usersLoading.value = true
    try {
        const rows = await fetchUsers(search.value.trim())
        if (mine === searchToken) users.value = rows.filter((u) => u.has_profile && u.nick)
    } catch (e) {
        if (mine === searchToken) error.value = text(e)
    } finally {
        if (mine === searchToken) usersLoading.value = false
    }
}

function toggle(id: string) {
    const next = new Set(selected.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selected.value = next
}

async function run(action: RecapAction) {
    busy.value = true
    error.value = ''
    notice.value = ''
    try {
        status.value = await setRecapPublication(year.value, action, action.endsWith('_selected') ? [...selected.value] : [])
        notice.value = {
            show_all: 'Итоги открыты всем',
            hide_all: 'Итоги скрыты у всех',
            show_selected: 'Итоги открыты выбранным',
            hide_selected: 'Итоги скрыты у выбранных'
        }[action]
        if (action.endsWith('_selected')) selected.value = new Set()
    } catch (e) {
        error.value = text(e)
    } finally {
        busy.value = false
        confirming.value = null
    }
}

async function preview(userId: string) {
    previewId.value = userId
    previewData.value = null
    previewError.value = ''
    try {
        const data = await fetchUserRecap(year.value, userId)
        if (previewId.value === userId) previewData.value = data
    } catch (e) {
        if (previewId.value === userId) previewError.value = text(e)
    }
}

let timer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(loadUsers, 250)
})
watch(year, () => {
    previewId.value = ''
    selected.value = new Set()
    notice.value = ''
    void loadAll()
})

onMounted(() => {
    void loadAll()
    void loadUsers()
})
</script>
