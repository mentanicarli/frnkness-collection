import { supabase } from '@/supabaseClient'

/**
 * Обращения сайта к базе этапа «Музыка и друзья»
 * (supabase/migrations/20261007120000_music_friends.sql). Только RPC:
 * права и лимиты проверяет база, ошибки приходят готовым русским текстом.
 */

export interface Profile {
    id: string
    nick: string
    avatar: string
}

export interface NowPlaying {
    track_id: string
    updated_at: string
}

export type Relation = 'self' | 'friend' | 'incoming' | 'outgoing' | 'none'

export interface UserPage extends Profile {
    bio: string
    created_at: string
    friends_count: number
    relation: Relation
    now_playing: NowPlaying | null
}

export interface FavoriteRow {
    track_id: string
    added_at: string
}

export interface PlaylistSummary {
    id: string
    owner_id: string
    title: string
    description: string
    is_public: boolean
    cover_version: number | null
    created_at: string
    updated_at: string
    track_count: number
    first_tracks: string[]
}

export interface PlaylistFull extends PlaylistSummary {
    tracks: string[]
    owner: Profile | null
}

export interface FriendsList {
    friends: (Profile & { since: string; now_playing: NowPlaying | null })[]
    incoming: (Profile & { created_at: string })[]
    outgoing: (Profile & { created_at: string })[]
}

export interface TopRow {
    track_key: string
    plays: number
}

export class SocialError extends Error {
    constructor(message: string, readonly code?: string) {
        super(message)
    }
}

// Сообщения базы (raise exception) — для людей; всё остальное заменяем.
const KNOWN_CODES = new Set(['42501', 'P0002', '22023', '23505', '54000'])

export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    let result
    try {
        result = await supabase.rpc(name, args)
    } catch {
        throw new SocialError('Не удалось связаться с сервером — попробуй ещё раз', 'network')
    }
    const { data, error } = result
    if (error) {
        const code = (error as { code?: string }).code
        const known = code && KNOWN_CODES.has(code) && error.message && !/permission denied|violates|syntax/i.test(error.message)
        throw new SocialError(known ? error.message : 'Что-то пошло не так, попробуй позже', code)
    }
    return data as T
}

export const errorText = (e: unknown): string => (e instanceof SocialError ? e.message : 'Что-то пошло не так, попробуй позже')

// ── Обёртки ────────────────────────────────────────────────────────────

export const api = {
    favoriteSet: (trackId: string, on: boolean) => rpc('favorite_set', { p_track_id: trackId, p_on: on }),
    userFavorites: (userId: string) => rpc<FavoriteRow[]>('user_favorites', { p_user: userId }),

    playlistCreate: (title: string, description = '', isPublic = false) =>
        rpc<PlaylistFull>('playlist_create', { p_title: title, p_description: description, p_is_public: isPublic }),
    playlistUpdate: (id: string, patch: { title?: string; description?: string; isPublic?: boolean }) =>
        rpc<PlaylistSummary>('playlist_update', {
            p_id: id,
            p_title: patch.title ?? null,
            p_description: patch.description ?? null,
            p_is_public: patch.isPublic ?? null
        }),
    playlistDelete: (id: string) => rpc<null>('playlist_delete', { p_id: id }),
    playlistAddTrack: (id: string, trackId: string) => rpc<PlaylistSummary>('playlist_add_track', { p_id: id, p_track_id: trackId }),
    playlistRemoveTrack: (id: string, trackId: string) => rpc<PlaylistSummary>('playlist_remove_track', { p_id: id, p_track_id: trackId }),
    playlistReorder: (id: string, trackIds: string[]) => rpc<PlaylistFull>('playlist_reorder', { p_id: id, p_track_ids: trackIds }),
    playlistSetCover: (id: string, version: number | null) => rpc<PlaylistSummary>('playlist_set_cover', { p_id: id, p_version: version }),
    playlistGet: (id: string) => rpc<PlaylistFull>('playlist_get', { p_id: id }),
    userPlaylists: (userId: string) => rpc<PlaylistSummary[]>('user_playlists', { p_user: userId }),

    userTop: (userId: string, days: 7 | 30 | null) => rpc<TopRow[]>('user_top', { p_user: userId, p_days: days }),
    nowPlayingSet: (trackId: string) => rpc<null>('now_playing_set', { p_track_id: trackId }),

    friendRequest: (userId: string) => rpc<{ status: 'pending' | 'accepted' }>('friend_request', { p_user: userId }),
    friendRespond: (userId: string, accept: boolean) => rpc<{ status: string }>('friend_respond', { p_user: userId, p_accept: accept }),
    friendCancel: (userId: string) => rpc<null>('friend_cancel', { p_user: userId }),
    friendRemove: (userId: string) => rpc<null>('friend_remove', { p_user: userId }),
    friendsList: () => rpc<FriendsList>('friends_list'),
    friendRequestsCount: () => rpc<number>('friend_requests_count'),
    userSearch: (query: string) => rpc<(Profile & { relation: Relation })[]>('user_search', { p_query: query }),
    profileByNick: (nick: string) => rpc<UserPage | null>('profile_by_nick', { p_nick: nick })
}
