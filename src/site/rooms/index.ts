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
    },
    onHide: (cb) => {
        window.addEventListener('pagehide', cb)
        return () => window.removeEventListener('pagehide', cb)
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

/** Как часто проверять «нет ли у меня комнаты», если при входе это не вышло (сеть, токен). */
const RESTORE_CHECK_MS = 60_000

/**
 * Один раз из App.vue: вошли — вернуться в свою комнату; вышли — забыть её.
 * Если комнаты нет в памяти, проверяем ещё раз при возвращении на вкладку и раз
 * в минуту: тогда хозяин находит свою комнату, даже если первая проверка не прошла.
 */
export function bindRoomsToSession(): void {
    const recheck = () => {
        if (session.user && !room.roomId && document.visibilityState === 'visible') void rooms.restore()
    }
    let timer: ReturnType<typeof setInterval> | null = null
    watch(
        () => session.user?.id ?? null,
        (id) => {
            if (timer) clearInterval(timer)
            timer = null
            document.removeEventListener('visibilitychange', recheck)
            if (!id) {
                void rooms.reset()
                return
            }
            void rooms.restore()
            timer = setInterval(recheck, RESTORE_CHECK_MS)
            document.addEventListener('visibilitychange', recheck)
        },
        { immediate: true }
    )
}
