import { shallowReactive } from 'vue'
import { api } from './api'
import { isTagColor } from '@/utils/tagColor'

/**
 * Теги пользователей: значок рядом с ником (прав не даёт). Справочник тегов и
 * «у кого какой» приходят одним запросом tags_all (читают все вошедшие) и
 * лежат в памяти; один и тот же значок показывается везде, где виден ник.
 * Тег меняет только владелец; переименование и перекраска доходят до всех
 * при следующем обновлении (раз в минуту и когда вкладка снова на экране),
 * удаление снимает тег со всех.
 */
export interface Tag {
    id: number
    name: string
    color: string
}

export interface TagsPayload {
    tags: Tag[]
    assignments: { user_id: string; tag_id: number }[]
}

export const tagsStore = shallowReactive({
    tags: new Map<number, Tag>(),
    byUser: new Map<string, number>(),
    loaded: false
})

/** Применить ответ базы. Тег с неверным цветом не показывается (цвет попадает в стиль). */
export function applyTags(payload: TagsPayload | null | undefined): void {
    const tags = new Map<number, Tag>()
    for (const t of payload?.tags ?? []) {
        if (t && typeof t.name === 'string' && isTagColor(t.color)) tags.set(Number(t.id), { id: Number(t.id), name: t.name, color: t.color.toLowerCase() })
    }
    const byUser = new Map<string, number>()
    for (const a of payload?.assignments ?? []) if (tags.has(Number(a.tag_id))) byUser.set(a.user_id, Number(a.tag_id))
    tagsStore.tags = tags
    tagsStore.byUser = byUser
    tagsStore.loaded = true
}

/** Тег пользователя или null. */
export function tagOf(userId: string | null | undefined): Tag | null {
    if (!userId) return null
    const id = tagsStore.byUser.get(userId)
    return id === undefined ? null : tagsStore.tags.get(id) ?? null
}

let seq = 0

export async function loadTags(): Promise<void> {
    const my = ++seq
    try {
        const payload = await api.tagsAll()
        if (my === seq) applyTags(payload)
    } catch {
        // Значки — украшение: при ошибке остаются прежние.
    }
}

const POLL_MS = 60_000
let timer: ReturnType<typeof setInterval> | null = null

function onVisible() {
    if (document.visibilityState === 'visible') void loadTags()
}

export function startTagsPolling(): void {
    stopTagsPolling()
    void loadTags()
    timer = setInterval(() => {
        if (document.visibilityState === 'visible') void loadTags()
    }, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
}

export function stopTagsPolling(): void {
    seq++
    if (timer) clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisible)
    tagsStore.tags = new Map()
    tagsStore.byUser = new Map()
    tagsStore.loaded = false
}
