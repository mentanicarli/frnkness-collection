import { shallowReactive } from 'vue'
import { api } from './api'
import { roomApi } from '../rooms/api'

/**
 * Индикатор новых заявок в шапке: число входящих заявок, ещё не
 * принятых и не отклонённых, и приглашений в комнаты (показываются так же).
 * Перечитываем при входе, раз в 2 минуты, когда вкладка снова на экране,
 * и после действий на странице «Друзья».
 */
export const friendRequests = shallowReactive({ incoming: 0, invites: 0 })

/** Всё, что ждёт ответа: заявки в друзья и приглашения в комнаты. */
export const pendingCount = (): number => friendRequests.incoming + friendRequests.invites

const POLL_MS = 120_000
let timer: ReturnType<typeof setInterval> | null = null
let seq = 0

export async function refreshFriendRequests(): Promise<void> {
    const my = ++seq
    try {
        const [n, invites] = await Promise.all([api.friendRequestsCount(), roomApi.invitesCount().catch(() => 0)])
        if (my === seq) {
            friendRequests.incoming = Number(n) || 0
            friendRequests.invites = Number(invites) || 0
        }
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
    friendRequests.invites = 0
}
