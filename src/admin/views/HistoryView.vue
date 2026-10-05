<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">История</h1>
            <p class="adm-sub">Последние {{ commits.length || 30 }} коммитов ветки main. Правки из админки можно откатить — новым коммитом.</p>
        </div>
        <button class="adm-btn" type="button" :disabled="loading" @click="load">Обновить</button>
    </div>

    <div v-if="error" class="adm-alert adm-alert-error" role="alert">{{ error }}</div>
    <div v-else-if="loading && !commits.length" class="adm-empty"><span class="adm-spinner"></span></div>

    <ol v-else class="adm-history" data-testid="history">
        <li v-for="c in commits" :key="c.sha" :data-sha="c.sha">
            <div class="adm-history-head">
                <span class="adm-badge" :class="c.source">{{ c.source === 'admin' ? 'админка' : 'код' }}</span>
                <span class="adm-history-msg">{{ c.message }}</span>
                <span class="adm-history-meta">
                    <span v-if="c.user" class="adm-history-user" data-testid="history-user">{{ c.user }} · </span>{{ formatDate(c.date) }} ·
                    <span class="adm-mono">{{ c.sha.slice(0, 7) }}</span>
                </span>
                <button
                    v-if="c.source === 'admin'"
                    class="adm-btn adm-btn-sm"
                    type="button"
                    :disabled="checking === c.sha"
                    @click="startRevert(c)"
                >
                    <span v-if="checking === c.sha" class="adm-spinner"></span>
                    Откатить
                </button>
            </div>
            <details v-if="c.files.length">
                <summary>{{ c.files.length }} {{ pluralFiles(c.files.length) }}</summary>
                <ul class="adm-file-list">
                    <li v-for="f in c.files" :key="f.path">
                        <span class="adm-file-kind" :class="STATUS_CLASS[f.status] || 'changed'">{{ STATUS_LABEL[f.status] || f.status }}</span>
                        <b>{{ f.path }}</b><template v-if="f.previous"> ← {{ f.previous }}</template>
                    </li>
                </ul>
            </details>
        </li>
    </ol>

    <!-- Откат невозможен: объяснение -->
    <div v-if="refusal" class="adm-modal-backdrop" @click.self="refusal = null">
        <div class="adm-modal" role="dialog" aria-modal="true" aria-labelledby="adm-refusal-title" @keydown.esc="refusal = null">
            <h2 id="adm-refusal-title">Откат невозможен</h2>
            <p class="adm-small adm-muted">«{{ refusal.message }}»</p>
            <div v-if="refusal.conflicts.length" class="adm-alert adm-alert-warn" data-testid="revert-conflicts">
                Эти файлы позже изменили другие коммиты — откат затёр бы их правки:
                <ul>
                    <li v-for="c in refusal.conflicts" :key="c.path">
                        <span class="adm-mono">{{ c.path }}</span> —
                        <template v-for="(x, i) in c.commits" :key="x.sha">{{ i ? ', ' : '' }}«{{ x.message }}» <span class="adm-mono">{{ x.sha.slice(0, 7) }}</span></template>
                    </li>
                </ul>
            </div>
            <div v-if="refusal.blocked.length" class="adm-alert adm-alert-error" data-testid="revert-blocked">
                <ul style="margin: 0">
                    <li v-for="b in refusal.blocked" :key="b">{{ b }}</li>
                </ul>
            </div>
            <div class="adm-row" style="margin-top: 1rem; justify-content: flex-end">
                <button class="adm-btn" type="button" @click="refusal = null">Понятно</button>
            </div>
        </div>
    </div>

    <CommitDialog :flow="flow" />
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import CommitDialog from '../components/CommitDialog.vue'
import { useCommitFlow } from '../composables/useCommitFlow'
import { useRepo } from '../composables/useRepo'
import { AdminApiError, fetchHistory, previewRevert, revertCommit, type HistoryCommit, type RevertPreview } from '../api/content'

const repo = useRepo()
const flow = useCommitFlow()
const commits = ref<HistoryCommit[]>([])
const loading = ref(false)
const error = ref('')
const checking = ref('')
const refusal = ref<RevertPreview | null>(null)

const STATUS_LABEL: Record<string, string> = { added: 'новый', modified: 'изменён', removed: 'удалён', renamed: 'переименован' }
const STATUS_CLASS: Record<string, string> = { added: 'new', modified: 'changed', removed: 'deleted', renamed: 'changed' }

function pluralFiles(n: number) {
    const m10 = n % 10
    const m100 = n % 100
    if (m10 === 1 && m100 !== 11) return 'файл'
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'файла'
    return 'файлов'
}

function formatDate(iso: string | null) {
    if (!iso) return ''
    return new Intl.DateTimeFormat('ru-RU', {
        timeZone: 'Europe/Moscow',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(iso))
}

const message = (e: unknown) => (e instanceof AdminApiError ? e.message : `Ошибка: ${(e as Error).message}`)

async function load() {
    loading.value = true
    error.value = ''
    try {
        commits.value = (await fetchHistory()).commits
    } catch (e) {
        error.value = message(e)
    } finally {
        loading.value = false
    }
}

async function startRevert(c: HistoryCommit) {
    checking.value = c.sha
    try {
        const preview = await previewRevert(c.sha)
        if (!preview.ok) {
            refusal.value = preview
            return
        }
        // Откат строится поверх той версии, что видела проверка.
        repo.state.sha = preview.head
        const result = await flow.request({
            title: 'Откатить правку',
            message: preview.revertMessage,
            files: preview.files.map((f) => ({
                path: f.path,
                kind: f.action === 'delete' ? ('deleted' as const) : f.action === 'recreate' ? ('restored' as const) : ('changed' as const)
            })),
            notes: [`Файлы вернутся к состоянию до правки «${preview.message}». Медиафайлы восстанавливаются из истории git — без повторной загрузки.`],
            run: (baseSha) => revertCommit(c.sha, baseSha)
        })
        if (result) await load()
    } catch (e) {
        error.value = message(e)
    } finally {
        checking.value = ''
    }
}

onMounted(load)
</script>
