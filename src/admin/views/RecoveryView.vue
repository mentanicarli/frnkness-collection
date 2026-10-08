<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Заявки на восстановление</h1>
            <p class="adm-sub">Проверь, что пишет действительно владелец аккаунта (свяжись по контакту), задай временный пароль и передай его лично. Контакт удаляется при закрытии заявки.</p>
        </div>
        <button class="adm-btn" type="button" :disabled="loading" @click="load">Обновить</button>
    </div>

    <div v-if="!auth.isOwner.value" class="adm-alert adm-alert-error" role="alert">Заявки видит только владелец сайта.</div>
    <template v-else>
        <div v-if="error" class="adm-alert adm-alert-error" role="alert">{{ error }}</div>
        <p v-if="!rows.length && !loading && !error" class="adm-empty">Заявок нет.</p>

        <div class="adm-grid">
            <section v-for="r in rows" :key="r.id" class="adm-card" :data-testid="`recovery-${r.id}`" :class="{ 'adm-recovery-closed': r.status !== 'new' }">
                <div class="adm-row" style="align-items: baseline">
                    <h2 class="adm-h2" style="margin: 0; word-break: break-word">{{ r.nick }}</h2>
                    <span class="adm-badge" :class="{ 'adm-badge-err': r.status === 'rejected' }">{{ STATUS[r.status] }}</span>
                    <span class="adm-spacer"></span>
                    <span class="adm-small adm-faint">{{ formatDateTime(r.created_at) }}</span>
                </div>
                <p class="adm-small" style="margin: 0.5rem 0 0">
                    <template v-if="r.user_id">Аккаунт: <b>{{ r.current_nick ?? r.nick }}</b></template>
                    <template v-else><span class="adm-faint">Такого ника нет — аккаунт не найден</span></template>
                </p>
                <p v-if="r.contact" class="adm-small" style="margin: 0.375rem 0 0; word-break: break-word">Контакт: <b>{{ r.contact }}</b></p>
                <p v-if="r.comment" class="adm-small adm-muted" style="margin: 0.375rem 0 0; white-space: pre-wrap; word-break: break-word">«{{ r.comment }}»</p>
                <p v-if="r.closed_at" class="adm-small adm-faint" style="margin: 0.375rem 0 0">Закрыта {{ formatDateTime(r.closed_at) }}, контакт удалён</p>

                <template v-if="r.status === 'new'">
                    <form v-if="r.user_id" class="adm-row" style="margin-top: 0.75rem" @submit.prevent="setPassword(r)">
                        <input v-model="passwords[r.id]" class="adm-input adm-mono" style="flex: 1; min-width: 10rem" aria-label="Временный пароль" />
                        <button class="adm-btn adm-btn-sm" type="button" @click="passwords[r.id] = generateTempPassword()">Другой</button>
                        <button class="adm-btn adm-btn-sm adm-btn-primary" type="submit" :disabled="busy === r.id">Задать временный пароль</button>
                    </form>
                    <div v-if="notices[r.id]" class="adm-alert adm-alert-ok" style="margin-top: 0.75rem" role="status">{{ notices[r.id] }}</div>
                    <div class="adm-row" style="margin-top: 0.75rem">
                        <button class="adm-btn adm-btn-sm" type="button" :disabled="busy === r.id" @click="close(r, 'done')">Закрыть: выполнена</button>
                        <button class="adm-btn adm-btn-sm adm-btn-danger" type="button" :disabled="busy === r.id" @click="close(r, 'rejected')">Закрыть: отклонена</button>
                    </div>
                </template>
            </section>
        </div>
    </template>
</template>

<script setup lang="ts">
// Админка → «Заявки на восстановление» (только владелец).
import { onMounted, reactive, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { AdminApiError } from '../api/content'
import { closeRecovery, fetchRecovery, generateTempPassword, userAction, type RecoveryRow } from '../api/users'
import { validatePassword } from '../../../supabase/functions/_shared/accounts.ts'

const STATUS = { new: 'новая', done: 'выполнена', rejected: 'отклонена' } as const

const auth = useAuth()
const rows = ref<RecoveryRow[]>([])
const loading = ref(false)
const error = ref('')
const busy = ref<number | null>(null)
const passwords = reactive<Record<number, string>>({})
const notices = reactive<Record<number, string>>({})

const formatDateTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const message = (e: unknown) => (e instanceof AdminApiError ? e.message : 'Что-то пошло не так')

async function load() {
    if (!auth.isOwner.value) return
    loading.value = true
    error.value = ''
    try {
        rows.value = await fetchRecovery()
        for (const r of rows.value) if (!passwords[r.id]) passwords[r.id] = generateTempPassword()
    } catch (e) {
        error.value = message(e)
    } finally {
        loading.value = false
    }
}

async function setPassword(r: RecoveryRow) {
    if (!r.user_id) return
    const password = passwords[r.id]
    const problem = validatePassword(password, r.current_nick ?? r.nick)
    if (problem) {
        error.value = problem
        return
    }
    busy.value = r.id
    error.value = ''
    try {
        await userAction(r.user_id, { action: 'reset-password', password })
        notices[r.id] = `Временный пароль ${password} задан. Передай его по контакту; при входе попросим сменить. Потом закрой заявку.`
    } catch (e) {
        error.value = message(e)
    } finally {
        busy.value = null
    }
}

async function close(r: RecoveryRow, status: 'done' | 'rejected') {
    if (!window.confirm(status === 'done' ? 'Закрыть заявку как выполненную? Контакт удалится.' : 'Отклонить заявку? Контакт удалится.')) return
    busy.value = r.id
    error.value = ''
    try {
        await closeRecovery(r.id, status)
        delete notices[r.id]
        await load()
    } catch (e) {
        error.value = message(e)
    } finally {
        busy.value = null
    }
}

onMounted(load)
</script>
