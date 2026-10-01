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
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { deployStatus, fetchHead, ping, AdminApiError } from '../api/content'

type CheckState = 'loading' | 'ok' | 'error'

const auth = useAuth()
const loading = ref(false)
const github = reactive({ state: 'loading' as CheckState, repo: '', branch: '', error: '' })
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

const message = (e: unknown) => (e instanceof AdminApiError ? e.message : 'неизвестная ошибка')

async function check() {
    loading.value = true
    github.state = 'loading'
    deploy.state = 'loading'
    try {
        const info = await ping()
        Object.assign(github, { state: 'ok', repo: info.repo, branch: info.branch })
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
