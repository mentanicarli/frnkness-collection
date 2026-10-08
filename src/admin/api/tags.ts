import { rpc } from './users'
import type { Tag, TagsPayload } from '@/site/social/tags'

/**
 * Теги пользователей. Читать их может любой вошедший (tags_all), писать —
 * только владелец: проверка is_owner() в самих функциях базы. Админам эти
 * вызовы вернут «Нет доступа».
 */

export function fetchTagsPayload(): Promise<TagsPayload> {
    return rpc<TagsPayload>('tags_all')
}

export function createTag(name: string, color: string): Promise<Tag> {
    return rpc<Tag>('owner_tag_create', { p_name: name, p_color: color })
}

export function updateTag(id: number, name: string, color: string): Promise<Tag> {
    return rpc<Tag>('owner_tag_update', { p_id: id, p_name: name, p_color: color })
}

export function deleteTag(id: number): Promise<null> {
    return rpc<null>('owner_tag_delete', { p_id: id })
}

/** tagId = null — «без тега». */
export function setUserTag(userId: string, tagId: number | null): Promise<null> {
    return rpc<null>('owner_user_set_tag', { p_user: userId, p_tag: tagId })
}
