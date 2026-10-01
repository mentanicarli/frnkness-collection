<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Обзор</h1>
            <p class="adm-sub">Состояние подключений админки.</p>
        </div>
        <button class="adm-btn" type="button" :disabled="loading" @click="check">Проверить снова</button>
    </div>

    <section class="adm-card">
        <h2 class="adm-h2">Подключения</h2>
        <div class="adm-status-list" data-testid="status">
            <div class="adm-status-item">
                <span class="adm-dot adm-dot-ok"></span>
                <span>Вход: {{ auth.email.value }}, роль admin</span>
            </div>
            <div class="adm-status-item" data-testid="status-github">
                <span class="adm-dot" :class="dot(github.state)"></span>
                <span v-if="github.state === 'loading'">GitHub: проверяем…</span>
                <span v-else-if="github.state === 'ok'">GitHub: репозиторий {{ github.repo }}, ветка {{ github.branch }}</span>
                <span v-else>GitHub: {{ github.error }}</span>
            </div>
            <div v-if="github.state === 'ok'" class="adm-status-item" data-testid="status-token">
                <span class="adm-dot" :class="tokenDot"></span>
                <span>{{ tokenText }}</span>
            </div>
            <div class="adm-status-item" data-testid="status-deploy">
                <span class="adm-dot" :class="dot(deploy.state)"></span>
                <span v-if="deploy.state === 'loading'">Сайт: проверяем последний деплой…</span>
                <span v-else-if="deploy.state === 'ok'">
                    Сайт: последняя версия <span class="adm-mono">{{ deploy.sha.slice(0, 7) }}</span> — {{ deploy.label }}
                    <a v-if="deploy.url" :href="deploy.url" target="_blank" rel="noopener">в GitHub Actions</a>
                </span>
                <span v-else>Сайт: {{ deploy.error }}</span>
            </div>
        </div>
    </section>

    <div v-if="announceExpired" class="adm-alert adm-alert-warn" style="margin-top: 1rem" data-testid="announce-expired">
        Анонс истёк — добавьте релиз и выключите анонс. <a href="#/promo">Открыть «Промо»</a>
    </div>

    <div v-if="github.state === 'ok' && (token.kind === 'soon' || token.kind === 'expired')"
         class="adm-alert" :class="token.kind === 'expired' ? 'adm-alert-error' : 'adm-alert-warn'" style="margin-top: 1rem" data-testid="token-alert">
        <template v-if="token.kind === 'expired'">Токен GitHub истёк {{ token.date }} — сохранения из админки не работают.</template>
        <template v-else>Токен GitHub истекает через {{ token.days }} {{ pluralDays(token.days!) }} ({{ token.date }}).</template>
        Обнови его по инструкции: <a :href="TOKEN_DOCS_URL" target="_blank" rel="noopener">«Срок действия и обновление»</a>.
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { deployStatus, fetchHead, ping, AdminApiError } from '../api/content'
import { TOKEN_DOCS_URL, pluralDays, tokenStatus } from '../lib/token'
import { useRepo } from '../composables/useRepo'
import { isAnnounceExpired } from '@/utils/announceCard'

const repo = useRepo()
const announceExpired = computed(() => isAnnounceExpired(repo.state.site?.announce))

type CheckState = 'loading' | 'ok' | 'error'

const auth = useAuth()
const loading = ref(false)
const github = reactive({ state: 'loading' as CheckState, repo: '', branch: '', error: '', tokenExpiresAt: undefined as string | null | undefined })
const deploy = reactive({ state: 'loading' as CheckState, sha: '', label: '', url: '' as string | null, error: '' })

const DEPLOY_LABELS = {
    pending: 'публикуется…',
    published: 'опубликована',
    failed: 'ошибка сборки',
    cancelled: 'сборка отменена'
}

function dot(state: CheckState) {
    return { 'adm-dot-ok': state === 'ok', 'adm-dot-err': state === 'error', 'adm-dot-pulse': state === 'loading' }
}

const token = computed(() => tokenStatus(github.tokenExpiresAt ?? null))
const tokenText = computed(() => {
    if (github.tokenExpiresAt === undefined) return 'Срок токена GitHub неизвестен — обнови функцию admin-content (см. команды в инструкции)'
    const t = token.value
    if (t.kind === 'none') return 'Токен GitHub без срока действия'
    if (t.kind === 'expired') return `Токен GitHub истёк ${t.date}`
    return `Токен GitHub действует ещё ${t.days} ${pluralDays(t.days!)} (до ${t.date})`
})
const tokenDot = computed(() => ({
    'adm-dot-ok': github.tokenExpiresAt !== undefined && (token.value.kind === 'ok' || token.value.kind === 'none'),
    'adm-dot-warn': github.tokenExpiresAt === undefined || token.value.kind === 'soon',
    'adm-dot-err': token.value.kind === 'expired'
}))

const message = (e: unknown) => (e instanceof AdminApiError ? e.message : 'неизвестная ошибка')

async function check() {
    loading.value = true
    github.state = 'loading'
    deploy.state = 'loading'
    try {
        const info = await ping()
        Object.assign(github, { state: 'ok', repo: info.repo, branch: info.branch, tokenExpiresAt: info.tokenExpiresAt })
        // site.json нужен для подсказки об истёкшем анонсе; ошибки — не про «Обзор».
        repo.load().catch(() => undefined)
        const head = await fetchHead()
        const status = await deployStatus(head.sha)
        Object.assign(deploy, { state: 'ok', sha: head.sha, label: DEPLOY_LABELS[status.state], url: status.url })
    } catch (e) {
        if (github.state === 'loading') Object.assign(github, { state: 'error', error: message(e) })
        Object.assign(deploy, { state: 'error', error: github.state === 'error' ? 'нет связи с GitHub' : message(e) })
    } finally {
        loading.value = false
    }
}

onMounted(check)
</script>
