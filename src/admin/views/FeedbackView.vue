<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Обращения</h1>
            <p class="adm-sub">Сообщения из «Сообщить о проблеме». Страницу, браузер и версию сайта приложил сам сайт.</p>
        </div>
        <button class="adm-btn" type="button" :disabled="loading" @click="load">Обновить</button>
    </div>

    <div class="adm-row" style="margin-bottom: 1rem">
        <button v-for="t in TABS" :key="t.id" class="adm-btn adm-btn-sm" type="button" :class="{ 'adm-btn-primary': tab === t.id }" :data-testid="`feedback-tab-${t.id}`" @click="setTab(t.id)">{{ t.label }}</button>
    </div>

    <div v-if="error" class="adm-alert adm-alert-error" role="alert" data-testid="feedback-error">{{ error }}</div>
    <p v-if="!rows.length && !loading && !error" class="adm-empty" data-testid="feedback-empty">Обращений нет.</p>

    <div class="adm-grid">
        <section v-for="r in rows" :key="r.id" class="adm-card" data-testid="feedback-row" :class="{ 'adm-recovery-closed': r.status === 'done' }">
            <div class="adm-row" style="align-items: baseline">
                <h2 class="adm-h2" style="margin: 0; word-break: break-word" data-testid="feedback-nick">{{ r.nick }}</h2>
                <span class="adm-badge" data-testid="feedback-status">{{ r.status === 'new' ? 'новое' : 'решено' }}</span>
                <span class="adm-spacer"></span>
                <span class="adm-small adm-faint" data-testid="feedback-date">{{ formatDateTime(r.created_at) }}</span>
            </div>
            <p class="adm-small" style="margin: 0.5rem 0 0; white-space: pre-wrap; word-break: break-word" data-testid="feedback-text">{{ r.message }}</p>
            <p class="adm-small adm-faint" style="margin: 0.5rem 0 0; word-break: break-word">
                Страница: <span class="adm-mono" data-testid="feedback-page">{{ r.page || '—' }}</span>
                <template v-if="r.browser"> · {{ r.browser }}</template>
                <template v-if="r.build"> · сборка <span class="adm-mono">{{ r.build }}</span></template>
            </p>
            <div class="adm-row" style="margin-top: 0.75rem">
                <button v-if="r.status === 'new'" class="adm-btn adm-btn-sm adm-btn-primary" type="button" :disabled="busy === r.id" data-testid="feedback-done" @click="setStatus(r, 'done')">Отметить решённым</button>
                <button v-else class="adm-btn adm-btn-sm" type="button" :disabled="busy === r.id" data-testid="feedback-reopen" @click="setStatus(r, 'new')">Вернуть в новые</button>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
// Админка → «Обращения» (группа «Люди»): «Сообщить о проблеме» с сайта.
import { onMounted, ref } from 'vue'
import { AdminApiError } from '../api/content'
import { fetchFeedback, setFeedbackStatus, type FeedbackRow, type FeedbackStatus } from '../api/diagnostics'
import { refreshFeedbackBadge } from '../composables/useFeedbackBadge'

const TABS = [
    { id: 'new', label: 'Новые' },
    { id: 'done', label: 'Решённые' },
    { id: 'all', label: 'Все' }
] as const
type Tab = (typeof TABS)[number]['id']

const rows = ref<FeedbackRow[]>([])
const loading = ref(false)
const error = ref('')
const busy = ref<number | null>(null)
const tab = ref<Tab>('new')

const formatDateTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const message = (e: unknown) => (e instanceof AdminApiError ? e.message : 'Что-то пошло не так')

async function load() {
    loading.value = true
    error.value = ''
    try {
        rows.value = await fetchFeedback(tab.value === 'all' ? null : tab.value)
    } catch (e) {
        error.value = message(e)
    } finally {
        loading.value = false
    }
}

function setTab(next: Tab) {
    if (tab.value === next) return
    tab.value = next
    void load()
}

async function setStatus(r: FeedbackRow, status: FeedbackStatus) {
    busy.value = r.id
    error.value = ''
    try {
        await setFeedbackStatus(r.id, status)
        await load()
        void refreshFeedbackBadge()
    } catch (e) {
        error.value = message(e)
    } finally {
        busy.value = null
    }
}

onMounted(load)
</script>
