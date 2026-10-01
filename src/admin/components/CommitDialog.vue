<template>
    <div v-if="flow.state.open && flow.state.plan" class="adm-modal-backdrop" @click.self="!flow.state.busy && flow.cancel()">
        <div class="adm-modal" role="dialog" aria-modal="true" aria-labelledby="adm-commit-title" @keydown.esc="!flow.state.busy && flow.cancel()">
            <h2 id="adm-commit-title">{{ flow.state.plan.title }}</h2>
            <p class="adm-small adm-muted">
                Будет создан один коммит в ветку <span class="adm-mono">main</span> — сайт обновится через 1–2 минуты после сборки.
            </p>
            <div class="adm-commit-msg adm-mono" data-testid="commit-message">{{ fullMessage }}</div>
            <h3 class="adm-h2" style="margin: 1rem 0 0.25rem">Файлы ({{ flow.state.plan.files.length }})</h3>
            <ul class="adm-file-list" data-testid="commit-files">
                <li v-for="f in flow.state.plan.files" :key="f.path">
                    <span class="adm-file-kind" :class="f.kind">{{ f.kind === 'new' ? 'новый' : 'изменён' }}</span>
                    <b>{{ f.path }}</b><template v-if="f.size !== undefined"> · {{ formatSize(f.size) }}</template>
                </li>
            </ul>
            <ul v-if="flow.state.plan.notes?.length" class="adm-small adm-muted adm-commit-notes">
                <li v-for="n in flow.state.plan.notes" :key="n">{{ n }}</li>
            </ul>

            <div v-if="flow.state.error" class="adm-alert adm-alert-error" role="alert" style="margin-top: 1rem">
                {{ flow.state.error }}
                <ul v-if="flow.state.details.length">
                    <li v-for="d in flow.state.details" :key="d">{{ d }}</li>
                </ul>
                <div v-if="flow.state.conflict" style="margin-top: 0.5rem">
                    Твои правки на этой странице не сохранены — скопируй их, если нужно, и
                    <button class="adm-btn adm-btn-sm" type="button" @click="reload">обнови страницу</button>
                </div>
            </div>

            <div class="adm-row" style="margin-top: 1.25rem; justify-content: flex-end">
                <span v-if="flow.state.progress" class="adm-small adm-muted adm-row" style="gap: 0.5rem; margin-right: auto">
                    <span class="adm-spinner"></span>{{ flow.state.progress }}
                </span>
                <button class="adm-btn adm-btn-ghost" type="button" :disabled="flow.state.busy" @click="flow.cancel()">Отмена</button>
                <button class="adm-btn adm-btn-primary" type="button" :disabled="flow.state.busy || flow.state.conflict" @click="flow.confirm()">
                    Опубликовать
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CommitFlow } from '../composables/useCommitFlow'

const props = defineProps<{ flow: CommitFlow }>()

const fullMessage = computed(() => {
    const m = props.flow.state.plan?.message ?? ''
    return m.startsWith('admin: ') ? m : `admin: ${m}`
})

function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} Б`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

const reload = () => location.reload()
</script>
