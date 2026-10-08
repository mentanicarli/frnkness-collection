<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Ошибки</h1>
            <p class="adm-sub">Ошибки JavaScript с сайта: одинаковые собраны в группы. Записи старше 30 дней удаляются сами. Если решённая ошибка появится снова, группа вернётся в список.</p>
        </div>
        <button class="adm-btn" type="button" :disabled="loading" @click="load">Обновить</button>
    </div>

    <div class="adm-row" style="margin-bottom: 1rem">
        <button class="adm-btn adm-btn-sm" type="button" :class="{ 'adm-btn-primary': !showResolved }" data-testid="errors-open" @click="setTab(false)">Нерешённые</button>
        <button class="adm-btn adm-btn-sm" type="button" :class="{ 'adm-btn-primary': showResolved }" data-testid="errors-resolved" @click="setTab(true)">Решённые</button>
    </div>

    <div v-if="error" class="adm-alert adm-alert-error" role="alert" data-testid="errors-error">{{ error }}</div>
    <p v-if="!groups.length && !loading && !error" class="adm-empty" data-testid="errors-empty">{{ showResolved ? 'Решённых ошибок нет.' : 'Нерешённых ошибок нет.' }}</p>

    <div class="adm-grid">
        <section v-for="g in groups" :key="g.fingerprint" class="adm-card" data-testid="error-group">
            <div class="adm-row" style="align-items: baseline">
                <h2 class="adm-h2" style="margin: 0; word-break: break-word" data-testid="error-message">{{ g.message }}</h2>
                <span class="adm-spacer"></span>
                <span class="adm-badge" data-testid="error-count" :title="`Сколько раз случилась`">{{ g.count }}×</span>
            </div>
            <p class="adm-small adm-faint" style="margin: 0.375rem 0 0">
                Последний раз: <span data-testid="error-last">{{ formatDateTime(g.last_seen) }}</span>
                · впервые {{ formatDateTime(g.first_seen) }}
                · {{ g.users }} {{ plural(g.users, 'пользователь', 'пользователя', 'пользователей') }}, остальные без входа
            </p>
            <p v-if="g.page" class="adm-small" style="margin: 0.375rem 0 0; word-break: break-word">Страница: <span class="adm-mono">{{ g.page }}</span><template v-if="g.build"> · сборка <span class="adm-mono">{{ g.build }}</span></template></p>
            <p v-if="g.browsers.length" class="adm-small" style="margin: 0.375rem 0 0" data-testid="error-browsers">
                Браузеры: <template v-for="(b, i) in g.browsers" :key="b.browser"><template v-if="i">, </template>{{ b.browser }} ({{ b.count }})</template>
            </p>
            <pre v-if="g.stack" class="adm-mono adm-small adm-muted" style="margin: 0.5rem 0 0; white-space: pre-wrap; word-break: break-word; max-height: 9rem; overflow: auto">{{ g.stack }}</pre>
            <div class="adm-row" style="margin-top: 0.75rem">
                <button v-if="!g.resolved" class="adm-btn adm-btn-sm adm-btn-primary" type="button" :disabled="busy === g.fingerprint" data-testid="error-resolve" @click="resolve(g, true)">Отметить решённой</button>
                <button v-else class="adm-btn adm-btn-sm" type="button" :disabled="busy === g.fingerprint" data-testid="error-reopen" @click="resolve(g, false)">Вернуть в работу</button>
            </div>
        </section>
    </div>
</template>

<script setup lang="ts">
// Админка → «Ошибки» (группа «Статистика»): журнал ошибок сайта.
import { onMounted, ref } from 'vue'
import { AdminApiError } from '../api/content'
import { fetchErrorGroups, resolveErrorGroup, type ErrorGroup } from '../api/diagnostics'

const groups = ref<ErrorGroup[]>([])
const loading = ref(false)
const error = ref('')
const busy = ref<string | null>(null)
const showResolved = ref(false)

const formatDateTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const message = (e: unknown) => (e instanceof AdminApiError ? e.message : 'Что-то пошло не так')

function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10
    const m100 = n % 100
    if (m10 === 1 && m100 !== 11) return one
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
    return many
}

async function load() {
    loading.value = true
    error.value = ''
    try {
        groups.value = await fetchErrorGroups(showResolved.value)
    } catch (e) {
        error.value = message(e)
    } finally {
        loading.value = false
    }
}

function setTab(resolved: boolean) {
    if (showResolved.value === resolved) return
    showResolved.value = resolved
    void load()
}

async function resolve(g: ErrorGroup, resolved: boolean) {
    busy.value = g.fingerprint
    error.value = ''
    try {
        await resolveErrorGroup(g.fingerprint, resolved)
        groups.value = groups.value.filter((x) => x.fingerprint !== g.fingerprint)
    } catch (e) {
        error.value = message(e)
    } finally {
        busy.value = null
    }
}

onMounted(load)
</script>
