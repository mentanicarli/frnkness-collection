<template>
    <div class="adm-page-head">
        <div>
            <h1 class="adm-h1">Теги</h1>
            <p class="adm-sub">Тег — значок рядом с ником. Прав он не даёт, только показывается на сайте у всех, у кого стоит. Название и цвет меняются сразу для всех; удаление тега снимает его со всех. Назначить тег человеку можно в его карточке («Пользователи»).</p>
        </div>
        <button class="adm-btn" type="button" :disabled="loading" @click="load">Обновить</button>
    </div>

    <div v-if="!auth.isOwner.value" class="adm-alert adm-alert-error" role="alert">Теги настраивает только владелец сайта.</div>
    <template v-else>
        <div v-if="error" class="adm-alert adm-alert-error" role="alert" data-testid="tags-error">{{ error }}</div>

        <section class="adm-card" aria-label="Новый тег">
            <h2 class="adm-h2" style="margin-top: 0">Новый тег</h2>
            <form class="adm-row" @submit.prevent="create">
                <input v-model="newName" class="adm-input" style="flex: 1; min-width: 10rem" :maxlength="TAG_NAME_MAX" placeholder="Название" aria-label="Название нового тега" data-testid="tag-new-name" />
                <input v-model="newColor" class="adm-color" type="color" aria-label="Цвет нового тега" data-testid="tag-new-color" />
                <span class="adm-tag-preview" :style="{ background: newColor, color: tagTextColor(newColor) }" data-testid="tag-new-preview">{{ newName.trim() || 'Пример' }}</span>
                <button class="adm-btn adm-btn-sm adm-btn-primary" type="submit" :disabled="busy" data-testid="tag-create">Создать</button>
            </form>
        </section>

        <p v-if="!tags.length && !loading" class="adm-empty" data-testid="tags-empty">Тегов пока нет.</p>
        <div class="adm-grid" style="margin-top: 1rem">
            <section v-for="t in tags" :key="t.id" class="adm-card" data-testid="tag-row">
                <form class="adm-row" @submit.prevent="save(t)">
                    <input v-model="drafts[t.id].name" class="adm-input" style="flex: 1; min-width: 10rem" :maxlength="TAG_NAME_MAX" aria-label="Название тега" data-testid="tag-name" />
                    <input v-model="drafts[t.id].color" class="adm-color" type="color" aria-label="Цвет тега" data-testid="tag-color" />
                    <span class="adm-tag-preview" :style="{ background: drafts[t.id].color, color: tagTextColor(drafts[t.id].color) }" data-testid="tag-preview">{{ drafts[t.id].name.trim() || '…' }}</span>
                    <span class="adm-small adm-faint" data-testid="tag-count">{{ counts[t.id] ?? 0 }} {{ pluralUsers(counts[t.id] ?? 0) }}</span>
                    <button class="adm-btn adm-btn-sm" type="submit" :disabled="busy || !changed(t)" data-testid="tag-save">Сохранить</button>
                    <button class="adm-btn adm-btn-sm adm-btn-danger" type="button" :disabled="busy" data-testid="tag-delete" @click="remove(t)">Удалить</button>
                </form>
            </section>
        </div>
    </template>
</template>

<script setup lang="ts">
// Админка → «Теги» (группа «Люди», только владелец): создать, переименовать,
// перекрасить, удалить. Название — до 20 символов, цвет — любой через выбор цвета
// (#RRGGBB; формат проверяет и база). Названия выводятся только текстом.
import { computed, onMounted, reactive, ref } from 'vue'
import { AdminApiError } from '../api/content'
import { createTag, deleteTag, fetchTagsPayload, updateTag } from '../api/tags'
import { useAuth } from '../composables/useAuth'
import { applyTags, tagsStore, type Tag } from '@/site/social/tags'
import { TAG_NAME_MAX, tagTextColor } from '@/utils/tagColor'

const auth = useAuth()
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const newName = ref('')
const newColor = ref('#3b82f6')
const drafts = reactive<Record<number, { name: string; color: string }>>({})

const tags = computed(() => [...tagsStore.tags.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru')))
const counts = computed(() => {
    const out: Record<number, number> = {}
    for (const id of tagsStore.byUser.values()) out[id] = (out[id] ?? 0) + 1
    return out
})

const message = (e: unknown) => (e instanceof AdminApiError ? e.message : 'Что-то пошло не так')
const pluralUsers = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'человек' : 'человек')

function syncDrafts() {
    for (const t of tags.value) if (!drafts[t.id]) drafts[t.id] = { name: t.name, color: t.color }
    for (const id of Object.keys(drafts)) if (!tagsStore.tags.has(Number(id))) delete drafts[Number(id)]
}

const changed = (t: Tag) => drafts[t.id]?.name.trim() !== t.name || drafts[t.id]?.color.toLowerCase() !== t.color

async function load() {
    loading.value = true
    error.value = ''
    try {
        applyTags(await fetchTagsPayload())
        for (const id of Object.keys(drafts)) delete drafts[Number(id)]
        syncDrafts()
    } catch (e) {
        error.value = message(e)
    } finally {
        loading.value = false
    }
}

async function create() {
    if (!newName.value.trim()) {
        error.value = 'Введи название тега'
        return
    }
    busy.value = true
    error.value = ''
    try {
        await createTag(newName.value.trim(), newColor.value)
        newName.value = ''
        await load()
    } catch (e) {
        error.value = message(e)
    } finally {
        busy.value = false
    }
}

async function save(t: Tag) {
    busy.value = true
    error.value = ''
    try {
        await updateTag(t.id, drafts[t.id].name.trim(), drafts[t.id].color)
        await load()
    } catch (e) {
        error.value = message(e)
    } finally {
        busy.value = false
    }
}

async function remove(t: Tag) {
    const n = counts.value[t.id] ?? 0
    if (!window.confirm(`Удалить тег «${t.name}»? Он пропадёт у всех, у кого стоит (сейчас: ${n}).`)) return
    busy.value = true
    error.value = ''
    try {
        await deleteTag(t.id)
        await load()
    } catch (e) {
        error.value = message(e)
    } finally {
        busy.value = false
    }
}

onMounted(load)
</script>
