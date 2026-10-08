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
/** Пока открыта страница «Друзья», проверяем чаще: заявка и приглашение должны появиться сами. */
export const FAST_POLL_MS = 10_000
let fast = false
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
    const keep = { incoming: friendRequests.incoming, invites: friendRequests.invites }
    stopFriendRequestsPolling()
    friendRequests.incoming = keep.incoming
    friendRequests.invites = keep.invites
    void refreshFriendRequests()
    timer = setInterval(() => {
        if (document.visibilityState === 'visible') void refreshFriendRequests()
    }, fast ? FAST_POLL_MS : POLL_MS)
    document.addEventListener('visibilitychange', onVisible)
}

/** Страница «Друзья» открыта (true) или закрыта (false): частота проверки. */
export function setFastFriendPolling(on: boolean): void {
    fast = on
    if (timer) startFriendRequestsPolling()
}

export function stopFriendRequestsPolling(): void {
    seq++
    if (timer) clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisible)
    friendRequests.incoming = 0
    friendRequests.invites = 0
}
