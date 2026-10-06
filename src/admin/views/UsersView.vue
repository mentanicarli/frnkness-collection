<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Пользователи</h1>
            <p class="adm-sub">Поиск по нику. Права проверяет сервер: над админами действует только владелец, владельца изменить нельзя.</p>
        </div>
        <button class="adm-btn" type="button" :disabled="loading" @click="load">Обновить</button>
    </div>

    <div class="adm-row" style="margin-bottom: 1rem">
        <input v-model="search" class="adm-input" style="max-width: 22rem" type="search" placeholder="Ник…" aria-label="Поиск по нику" maxlength="40" />
        <span class="adm-faint adm-small" data-testid="users-count">{{ rows.length }} {{ pluralUsers(rows.length) }}</span>
    </div>

    <div v-if="error" class="adm-alert adm-alert-error" role="alert">{{ error }}</div>

    <div class="adm-users">
        <section class="adm-card adm-users-list" aria-label="Список пользователей">
            <p v-if="!rows.length && !loading" class="adm-faint adm-small">Никого не нашли.</p>
            <ul class="adm-user-rows">
                <li v-for="u in rows" :key="u.id">
                    <button type="button" class="adm-user-row" :class="{ active: selectedId === u.id }" :data-testid="`user-row-${u.nick ?? u.id}`" @click="select(u.id)">
                        <UserAvatar :avatar="u.avatar" :nick="u.nick ?? '?'" :user-id="u.id" :size="2" />
                        <span class="adm-user-row-main">
                            <span class="adm-user-row-nick">{{ u.nick ?? 'без профиля' }}</span>
                            <span class="adm-faint adm-small">с {{ formatDate(u.created_at) }} · вход {{ u.last_sign_in_at ? formatDate(u.last_sign_in_at) : '—' }}</span>
                        </span>
                        <span v-if="u.role !== 'user'" class="adm-badge">{{ ROLE_LABEL[u.role] }}</span>
                        <span v-if="u.banned_until" class="adm-badge adm-badge-err">бан</span>
                    </button>
                </li>
            </ul>
        </section>

        <section v-if="selectedId" class="adm-card adm-user-card" aria-label="Карточка пользователя" data-testid="user-card">
            <p v-if="!card" class="adm-faint adm-small">Загрузка…</p>
            <template v-else>
                <div class="adm-row" style="align-items: flex-start">
                    <UserAvatar :avatar="card.avatar" :nick="card.nick ?? '?'" :user-id="card.id" :size="3.5" />
                    <div style="min-width: 0; flex: 1">
                        <h2 class="adm-h2" style="margin: 0; word-break: break-word">{{ card.nick ?? 'без профиля' }}</h2>
                        <p class="adm-small adm-muted" style="margin: 0.25rem 0 0">
                            {{ ROLE_LABEL[card.role] }}<template v-if="card.banned_until"> · <b style="color: #ff8a80">забанен</b></template>
                            <template v-if="card.must_change_password"> · сменит пароль при входе</template>
                        </p>
                        <p class="adm-small adm-faint" style="margin: 0.25rem 0 0">
                            Регистрация {{ formatDate(card.created_at) }} · последний вход {{ card.last_sign_in_at ? formatDate(card.last_sign_in_at) : '—' }} · сеансов {{ card.sessions }}
                        </p>
                    </div>
                </div>

                <div class="adm-tiles adm-tiles-3" style="margin: 1rem 0">
                    <div class="adm-tile"><div class="adm-tile-label">Прослушиваний</div><div class="adm-tile-value">{{ formatNumber(card.plays) }}</div><div class="adm-tile-hint">за 30 дней: {{ formatNumber(card.plays_30d) }}</div></div>
                    <div class="adm-tile"><div class="adm-tile-label">Слушал</div><div class="adm-tile-value">{{ formatSeconds(card.listen_seconds) }}</div><div class="adm-tile-hint">всего</div></div>
                    <div class="adm-tile"><div class="adm-tile-label">Последнее</div><div class="adm-tile-value" style="font-size: 1rem">{{ card.last_play_at ? formatDate(card.last_play_at) : '—' }}</div><div class="adm-tile-hint">прослушивание</div></div>
                </div>

                <template v-if="card.top.length">
                    <h3 class="adm-label">Чаще всего слушает</h3>
                    <ol class="adm-small" style="margin: 0.25rem 0 1rem; padding-left: 1.25rem">
                        <li v-for="t in card.top" :key="t.track_key">{{ trackTitle(t.track_key) }} — {{ t.plays }}</li>
                    </ol>
                </template>

                <p v-if="card.bio" class="adm-small adm-muted" style="white-space: pre-wrap; word-break: break-word">«{{ card.bio }}»</p>

                <div v-if="notice" class="adm-alert" :class="noticeOk ? 'adm-alert-ok' : 'adm-alert-error'" role="status" data-testid="user-notice">{{ notice }}</div>

                <div class="adm-user-actions">
                    <!-- Сброс пароля -->
                    <form v-if="can('reset-password')" class="adm-field" @submit.prevent="resetPassword">
                        <span class="adm-label">Временный пароль (при входе попросим сменить)</span>
                        <div class="adm-row">
                            <input v-model="tempPassword" class="adm-input adm-mono" style="flex: 1; min-width: 10rem" aria-label="Временный пароль" />
                            <button class="adm-btn adm-btn-sm" type="button" @click="tempPassword = generateTempPassword()">Другой</button>
                            <button class="adm-btn adm-btn-sm adm-btn-primary" type="submit" :disabled="busy">Задать</button>
                        </div>
                    </form>

                    <!-- Ник -->
                    <form v-if="can('rename')" class="adm-field" @submit.prevent="rename">
                        <span class="adm-label">Ник</span>
                        <div class="adm-row">
                            <input v-model="newNick" class="adm-input" style="flex: 1; min-width: 10rem" maxlength="20" aria-label="Новый ник" />
                            <button class="adm-btn adm-btn-sm" type="submit" :disabled="busy || newNick === card.nick">Переименовать</button>
                        </div>
                    </form>

                    <!-- О себе -->
                    <form v-if="can('set-bio')" class="adm-field" @submit.prevent="saveBio">
                        <span class="adm-label">«О себе»</span>
                        <textarea v-model="newBio" class="adm-textarea" style="min-height: 3.5rem" maxlength="200" aria-label="О себе"></textarea>
                        <div><button class="adm-btn adm-btn-sm" type="submit" :disabled="busy || newBio === (card.bio ?? '')">Сохранить «о себе»</button></div>
                    </form>

                    <div class="adm-row">
                        <button v-if="can('remove-avatar') && card.avatar && !card.avatar.startsWith('initials:')" class="adm-btn adm-btn-sm" type="button" :disabled="busy" @click="run({ action: 'remove-avatar' }, 'Аватар удалён')">Удалить аватар</button>
                        <button v-if="can('sign-out')" class="adm-btn adm-btn-sm" type="button" :disabled="busy" @click="run({ action: 'sign-out' }, 'Все сеансы завершены')">Завершить все сеансы</button>
                        <button v-if="can('ban') && !card.banned_until" class="adm-btn adm-btn-sm adm-btn-danger" type="button" :disabled="busy" @click="confirmRun(`Забанить ${card.nick}? Все сеансы завершатся.`, { action: 'ban' }, 'Забанен')">Забанить</button>
                        <button v-if="can('unban') && card.banned_until" class="adm-btn adm-btn-sm" type="button" :disabled="busy" @click="run({ action: 'unban' }, 'Разбанен')">Разбанить</button>
                    </div>

                    <div v-if="can('set-role')" class="adm-row">
                        <button v-if="card.role === 'user'" class="adm-btn adm-btn-sm" type="button" :disabled="busy" @click="confirmRun(`Выдать ${card.nick} права админа?`, { action: 'set-role', role: 'admin' }, 'Теперь админ')">Сделать админом</button>
                        <button v-if="card.role === 'admin'" class="adm-btn adm-btn-sm" type="button" :disabled="busy" @click="confirmRun(`Снять с ${card.nick} права админа?`, { action: 'set-role', role: 'user' }, 'Права админа сняты')">Снять права админа</button>
                    </div>

                    <form v-if="can('delete')" class="adm-field" @submit.prevent="deleteUser">
                        <span class="adm-label">Удалить аккаунт со всеми данными — введи ник для подтверждения</span>
                        <div class="adm-row">
                            <input v-model="deleteConfirm" class="adm-input" style="flex: 1; min-width: 10rem" :placeholder="card.nick ?? ''" aria-label="Ник для подтверждения удаления" />
                            <button class="adm-btn adm-btn-sm adm-btn-danger" type="submit" :disabled="busy || deleteConfirm !== card.nick">Удалить</button>
                        </div>
                    </form>

                    <p v-if="denied" class="adm-small adm-faint">{{ denied }}</p>
                </div>
            </template>
        </section>
    </div>
</template>

<script setup lang="ts">
// Админка → «Пользователи» (раздел 9 плана): список, поиск, карточка,
// действия. Ник, «о себе» и контакты выводятся только текстом.
import { computed, onMounted, ref, watch } from 'vue'
import UserAvatar from '@/site/components/UserAvatar.vue'
import { parseTrackKey } from '@/utils/lyrics'
import { useAuth } from '../composables/useAuth'
import { useRepo } from '../composables/useRepo'
import { AdminApiError } from '../api/content'
import { fetchUserCard, fetchUsers, generateTempPassword, userAction, type UserAction, type UserCard, type UserRow } from '../api/users'
import { formatNumber } from '../lib/format'
import { formatSeconds } from '../lib/stats'
import { adminPermission, type AdminAction } from '../../../supabase/functions/_shared/accountsCore.ts'
import { cleanBio, validateBio, validateNick, validatePassword } from '../../../supabase/functions/_shared/accounts.ts'

const ROLE_LABEL = { user: 'пользователь', admin: 'админ', owner: 'владелец' } as const

const auth = useAuth()
const repo = useRepo()
const rows = ref<UserRow[]>([])
const search = ref('')
const loading = ref(false)
const error = ref('')
const selectedId = ref<string | null>(null)
const card = ref<UserCard | null>(null)
const busy = ref(false)
const notice = ref('')
const noticeOk = ref(true)
const tempPassword = ref(generateTempPassword())
const newNick = ref('')
const newBio = ref('')
const deleteConfirm = ref('')

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const pluralUsers = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'пользователь' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'пользователя' : 'пользователей')

function trackTitle(key: string): string {
    const parsed = parseTrackKey(key)
    const release = parsed && repo.state.releases?.[parsed.releaseId]
    const track = release && release.tracks[parsed!.trackIndex]
    return track ? `${track.title} (${release!.title})` : key
}

const actor = computed(() => ({ id: auth.userId.value, role: auth.role.value }))
function can(action: AdminAction): boolean {
    return Boolean(card.value) && adminPermission(actor.value, { id: card.value!.id, role: card.value!.role }, action) === null
}
const denied = computed(() => {
    if (!card.value) return ''
    const reason = adminPermission(actor.value, { id: card.value.id, role: card.value.role }, 'ban')
    return reason && reason !== 'Нет доступа' ? reason : ''
})

const message = (e: unknown) => (e instanceof AdminApiError ? e.message : 'Что-то пошло не так')

let searchTimer: ReturnType<typeof setTimeout> | undefined
async function load() {
    loading.value = true
    error.value = ''
    try {
        rows.value = await fetchUsers(search.value.trim())
    } catch (e) {
        error.value = message(e)
    } finally {
        loading.value = false
    }
}
watch(search, () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(load, 250)
})

async function loadCard() {
    if (!selectedId.value) return
    try {
        card.value = await fetchUserCard(selectedId.value)
        newNick.value = card.value.nick ?? ''
        newBio.value = card.value.bio ?? ''
    } catch (e) {
        noticeOk.value = false
        notice.value = message(e)
    }
}

function select(id: string) {
    if (selectedId.value === id) return
    selectedId.value = id
    card.value = null
    notice.value = ''
    deleteConfirm.value = ''
    tempPassword.value = generateTempPassword()
    void loadCard()
}

async function run(payload: UserAction, done: string): Promise<boolean> {
    if (!card.value) return false
    busy.value = true
    notice.value = ''
    try {
        await userAction(card.value.id, payload)
        noticeOk.value = true
        notice.value = done
        await Promise.all([loadCard(), load()])
        notice.value = done
        return true
    } catch (e) {
        noticeOk.value = false
        notice.value = message(e)
        return false
    } finally {
        busy.value = false
    }
}

function confirmRun(question: string, payload: UserAction, done: string) {
    if (window.confirm(question)) void run(payload, done)
}

async function resetPassword() {
    const problem = validatePassword(tempPassword.value, card.value?.nick ?? '')
    if (problem) {
        noticeOk.value = false
        notice.value = problem
        return
    }
    const password = tempPassword.value
    if (await run({ action: 'reset-password', password }, '')) {
        notice.value = `Временный пароль: ${password} — передай его лично. При входе попросим сменить, все сеансы завершены.`
    }
}

async function rename() {
    const problem = validateNick(newNick.value)
    if (problem) {
        noticeOk.value = false
        notice.value = problem
        return
    }
    await run({ action: 'rename', nick: newNick.value }, `Ник изменён на «${newNick.value.trim()}» — входить нужно с новым ником`)
}

async function saveBio() {
    const bio = cleanBio(newBio.value)
    const problem = validateBio(bio)
    if (problem) {
        noticeOk.value = false
        notice.value = problem
        return
    }
    await run({ action: 'set-bio', bio }, '«О себе» сохранено')
}

async function deleteUser() {
    if (!card.value || deleteConfirm.value !== card.value.nick) return
    const nick = card.value.nick
    busy.value = true
    try {
        await userAction(card.value.id, { action: 'delete' })
        selectedId.value = null
        card.value = null
        await load()
        noticeOk.value = true
        error.value = ''
        window.alert(`Аккаунт ${nick} удалён`)
    } catch (e) {
        noticeOk.value = false
        notice.value = message(e)
    } finally {
        busy.value = false
    }
}

onMounted(() => {
    void load()
    repo.load().catch(() => undefined)
})
</script>
