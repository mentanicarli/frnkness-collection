import { shallowReactive } from 'vue'

/** Диалог «+ в плейлист» (AddToPlaylistDialog.vue, один на страницу). */
export const addDialog = shallowReactive({ trackId: null as string | null })

export function openAddToPlaylist(trackId: string): void {
    addDialog.trackId = trackId
}

export function closeAddToPlaylist(): void {
    addDialog.trackId = null
}
