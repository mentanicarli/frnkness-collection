<template>
    <div v-if="flow.state.open && flow.state.plan" class="adm-modal-backdrop" @click.self="!flow.state.busy && flow.cancel()">
        <div class="adm-modal" role="dialog" aria-modal="true" aria-labelledby="adm-commit-title" @keydown.esc="!flow.state.busy && flow.cancel()">
            <h2 id="adm-commit-title">{{ flow.state.plan.title }}</h2>
            <p class="adm-small adm-muted">
                Будет создан один коммит в ветку <span class="adm-mono">main</span> — сайт обновится через 1–2 минуты после сборки.
            </p>
            <div class="adm-commit-msg adm-mono" data-testid="commit-message">{{ fullMessage }}</div>
            <p v-if="auth.email.value" class="adm-small adm-faint" style="margin: 0.375rem 0 0" data-testid="commit-author">
                Автор правки: {{ auth.email.value }} — допишется в коммит
            </p>
            <h3 class="adm-h2" style="margin: 1rem 0 0.25rem">Файлы ({{ flow.state.plan.files.length }})</h3>
            <ul class="adm-file-list" data-testid="commit-files">
                <li v-for="f in flow.state.plan.files" :key="f.path">
                    <span class="adm-file-kind" :class="f.kind">{{ KIND_LABEL[f.kind] }}</span>
                    <b>{{ f.path }}</b><template v-if="f.size !== undefined"> · {{ formatSize(f.size) }}</template>
                </li>
            </ul>
            <ul v-if="flow.state.plan.notes?.length" class="adm-small adm-muted adm-commit-notes">
                <li v-for="n in flow.state.plan.notes" :key="n">{{ n }}</li>
            </ul>

            <div v-if="flow.state.error" class="adm-alert adm-alert-error" role="alert" style="margin-top: 1rem" data-testid="commit-error">
                {{ flow.state.error }}
                <ul v-if="flow.state.details.length && !flow.state.conflicts.length">
                    <li v-for="d in flow.state.details" :key="d">{{ d }}</li>
                </ul>
            </div>

            <!-- Настоящий конфликт: тот же файл изменили в main. Работа не теряется. -->
            <div v-if="flow.state.conflict" class="adm-conflict" data-testid="conflict">
                <div v-for="c in flow.state.conflicts" :key="c.path" class="adm-conflict-file">
                    <div class="adm-mono adm-small"><b>{{ c.path }}</b></div>
                    <ul v-if="c.commits.length" class="adm-small adm-muted adm-conflict-commits">
                        <li v-for="x in c.commits" :key="x.sha">
                            {{ x.message }}<template v-if="x.user"> — {{ x.user }}</template><template v-if="x.date">, {{ formatDate(x.date) }}</template>
                        </li>
                    </ul>
                    <div class="adm-row" style="gap: 0.5rem; margin-top: 0.375rem">
                        <button v-if="mine(c.path) !== null" class="adm-btn adm-btn-sm" type="button" @click="download(c.path)">Скачать мой вариант</button>
                        <button
                            v-if="mine(c.path) !== null && flow.state.conflictHead"
                            class="adm-btn adm-btn-ghost adm-btn-sm"
                            type="button"
                            :disabled="diffs[c.path]?.loading"
                            @click="toggleDiff(c.path)"
                        >{{ diffs[c.path]?.lines ? 'Скрыть разницу' : 'Что изменилось' }}</button>
                    </div>
                    <div v-if="diffs[c.path]?.error" class="adm-small" style="color: #ffc4be">{{ diffs[c.path].error }}</div>
                    <div v-if="diffs[c.path]?.lines" class="adm-diff adm-mono" data-testid="conflict-diff">
                        <div class="adm-diff-legend adm-small adm-faint"><span class="lg-del">−</span> сейчас в main · <span class="lg-add">+</span> твой вариант</div>
                        <template v-for="(l, i) in diffs[c.path].lines" :key="i">
                            <div v-if="l.kind === 'gap'" class="gap">… {{ l.count }} без изменений</div>
                            <div v-else :class="l.kind"><span>{{ l.kind === 'del' ? '−' : l.kind === 'add' ? '+' : ' ' }}</span>{{ l.text || ' ' }}</div>
                        </template>
                        <div v-if="!diffs[c.path].changed" class="gap">Содержимое совпадает — можно просто обновить страницу.</div>
                    </div>
                </div>
                <p class="adm-small" style="margin: 0.75rem 0 0">
                    <template v-if="flow.state.plan.draft">
                        Твоя работа не потеряна: черновик сохранён в этом браузере. Обнови страницу — подтянется версия из main,
                        и админка предложит восстановить черновик поверх неё.
                    </template>
                    <template v-else>Скачай свой вариант, если он нужен, и обнови страницу, чтобы подтянуть версию из main.</template>
                </p>
                <button class="adm-btn adm-btn-sm" type="button" style="margin-top: 0.5rem" @click="reload">Обновить страницу</button>
            </div>

            <div class="adm-row" style="margin-top: 1.25rem; justify-content: flex-end">
                <span v-if="flow.state.progress" class="adm-small adm-muted adm-row" style="gap: 0.5rem; margin-right: auto">
                    <span class="adm-spinner"></span>{{ flow.state.progress }}
                </span>
                <button class="adm-btn adm-btn-ghost" type="button" :disabled="flow.state.busy" @click="flow.cancel()">
                    {{ flow.state.conflict ? 'Закрыть' : 'Отмена' }}
                </button>
                <button class="adm-btn adm-btn-primary" type="button" :disabled="flow.state.busy || flow.state.conflict" @click="flow.confirm()">
                    Опубликовать
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { CommitFlow } from '../composables/useCommitFlow'
import { useAuth } from '../composables/useAuth'
import { readFiles } from '../api/content'
import { compactDiff, hasChanges, lineDiff, type DiffLine } from '../lib/lineDiff'
import { downloadText } from '../lib/download'

const props = defineProps<{ flow: CommitFlow }>()
const auth = useAuth()

const KIND_LABEL = { new: 'новый', changed: 'изменён', deleted: 'удалён', restored: 'восстановлен' } as const

const fullMessage = computed(() => {
    const m = props.flow.state.plan?.message ?? ''
    return m.startsWith('admin: ') ? m : `admin: ${m}`
})

function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} Б`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

function formatDate(iso: string) {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Свой вариант файла из последней попытки; null — медиафайл или удаление. */
function mine(path: string): string | null {
    const f = props.flow.state.files.find((x) => x.path === path)
    return typeof f?.content === 'string' ? f.content : null
}

function download(path: string) {
    const content = mine(path)
    if (content !== null) downloadText(path, content)
}

const diffs = reactive<Record<string, { loading?: boolean; lines?: DiffLine[]; changed?: boolean; error?: string }>>({})
watch(
    () => props.flow.state.conflicts,
    () => Object.keys(diffs).forEach((k) => delete diffs[k])
)

async function toggleDiff(path: string) {
    if (diffs[path]?.lines) {
        delete diffs[path]
        return
    }
    const head = props.flow.state.conflictHead
    const content = mine(path)
    if (!head || content === null) return
    diffs[path] = { loading: true }
    try {
        const theirs = (await readFiles(head, [path]))[path] ?? ''
        const full = lineDiff(theirs, content)
        diffs[path] = full ? { lines: compactDiff(full), changed: hasChanges(full) } : { error: 'Файл слишком большой для сравнения — скачай свой вариант' }
    } catch (e) {
        diffs[path] = { error: `Не удалось загрузить версию из main: ${(e as Error).message}` }
    }
}

const reload = () => location.reload()
</script>
