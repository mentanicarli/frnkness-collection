import { shallowReactive } from 'vue'

/** Доп. действие в меню трека (в плейлисте: выше, ниже, убрать). */
export interface MenuAction {
    id: string
    label: string
    danger?: boolean
    disabled?: boolean
    run(): void
}

/** Меню «⋯» у трека (TrackMenuSheet.vue, одно на страницу). */
export const trackMenu = shallowReactive({ trackId: null as string | null, extras: [] as MenuAction[] })

export function openTrackMenu(trackId: string, extras: MenuAction[] = []): void {
    trackMenu.trackId = trackId
    trackMenu.extras = extras
}

export function closeTrackMenu(): void {
    trackMenu.trackId = null
    trackMenu.extras = []
}
