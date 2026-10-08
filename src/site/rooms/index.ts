import { shallowReactive, watch } from 'vue'
import { session } from '../session'
import { showNotice } from '../social/notice'
import { roomApi } from './api'
import { createSupabaseChannel } from './channel'
import { createServerClock } from './clock'
import { playerPort } from './port'
import { createRoomController } from './store'

/**
 * Комната этой вкладки: настоящие зависимости (Supabase, плеер сайта, часы
 * устройства) для контроллера из ./store.ts. Экраны читают `room`, действия
 * вызывают у `rooms`.
 */

const clock = createServerClock({
    serverNow: roomApi.serverNow,
    deviceNow: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
})

export const rooms = createRoomController({
    api: roomApi,
    channel: createSupabaseChannel,
    port: playerPort,
    clock,
    me: () => (session.user ? { id: session.user.id } : null),
    notify: (text, error) => showNotice(text, error),
    onVisible: (cb) => {
        const handler = () => {
            if (document.visibilityState === 'visible') cb()
        }
        document.addEventListener('visibilitychange', handler)
        return () => document.removeEventListener('visibilitychange', handler)
    }
})

export const room = rooms.state

/** Окно «Создать комнату» (его открывают меню профиля и страница «Друзья»). */
export const roomUi = shallowReactive({ createOpen: false })

export const openCreateRoom = (): void => {
    roomUi.createOpen = true
}

/** Ссылка на комнату, которую можно отправить друзьям. */
export function roomLink(id: string, resolveHref: (id: string) => string): string {
    return new URL(resolveHref(id), window.location.href).href
}

/** Один раз из App.vue: вошли — вернуться в свою комнату; вышли — забыть её. */
export function bindRoomsToSession(): void {
    watch(
        () => session.user?.id ?? null,
        (id) => {
            if (id) void rooms.restore()
            else void rooms.reset()
        },
        { immediate: true }
    )
}
