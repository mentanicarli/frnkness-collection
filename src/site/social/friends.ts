import { shallowReactive } from 'vue'
import { api } from './api'

/**
 * Индикатор новых заявок в шапке: число входящих заявок, ещё не
 * принятых и не отклонённых. Перечитываем при входе, раз в 2 минуты,
 * когда вкладка снова на экране, и после действий на странице «Друзья».
 */
export const friendRequests = shallowReactive({ incoming: 0 })

const POLL_MS = 120_000
let timer: ReturnType<typeof setInterval> | null = null
let seq = 0

export async function refreshFriendRequests(): Promise<void> {
    const my = ++seq
    try {
        const n = await api.friendRequestsCount()
        if (my === seq) friendRequests.incoming = Number(n) || 0
    } catch {
        // Индикатор — не главное; ошибку не показываем.
    }
}

function onVisible() {
    if (document.visibilityState === 'visible') void refreshFriendRequests()
}

export function startFriendRequestsPolling(): void {
    stopFriendRequestsPolling()
    void refreshFriendRequests()
    timer = setInterval(() => {
        if (document.visibilityState === 'visible') void refreshFriendRequests()
    }, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
}

export function stopFriendRequestsPolling(): void {
    seq++
    if (timer) clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisible)
    friendRequests.incoming = 0
}
