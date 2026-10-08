// Индикатор на аватаре: заявки и приглашения в комнаты, частота проверки.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const counts = { requests: 0, invites: 0 }
vi.mock('../social/api', () => ({ api: { friendRequestsCount: vi.fn(async () => counts.requests) } }))
vi.mock('../rooms/api', () => ({ roomApi: { invitesCount: vi.fn(async () => counts.invites) } }))

const { api } = await import('../social/api')
const { roomApi } = await import('../rooms/api')
const friends = await import('../social/friends')

beforeEach(() => {
    vi.useFakeTimers()
    counts.requests = 0
    counts.invites = 0
    vi.mocked(api.friendRequestsCount).mockClear()
    vi.mocked(roomApi.invitesCount).mockClear()
})
afterEach(() => {
    friends.stopFriendRequestsPolling()
    vi.useRealTimers()
})

describe('индикатор заявок и приглашений', () => {
    it('считает заявки и приглашения вместе', async () => {
        counts.requests = 2
        counts.invites = 1
        await friends.refreshFriendRequests()
        expect(friends.friendRequests).toMatchObject({ incoming: 2, invites: 1 })
        expect(friends.pendingCount()).toBe(3)
    })

    it('обычная проверка — раз в 2 минуты, на странице «Друзья» — каждые 10 секунд, после ухода со страницы снова реже', async () => {
        friends.startFriendRequestsPolling()
        await vi.advanceTimersByTimeAsync(0)
        vi.mocked(roomApi.invitesCount).mockClear()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(roomApi.invitesCount).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(roomApi.invitesCount).toHaveBeenCalledTimes(1)

        friends.setFastFriendPolling(true)
        await vi.advanceTimersByTimeAsync(0)
        vi.mocked(roomApi.invitesCount).mockClear()
        await vi.advanceTimersByTimeAsync(35_000)
        expect(roomApi.invitesCount).toHaveBeenCalledTimes(3)

        friends.setFastFriendPolling(false)
        await vi.advanceTimersByTimeAsync(0)
        vi.mocked(roomApi.invitesCount).mockClear()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(roomApi.invitesCount).not.toHaveBeenCalled()
    })

    it('смена частоты не обнуляет значок', async () => {
        counts.invites = 1
        friends.startFriendRequestsPolling()
        await vi.advanceTimersByTimeAsync(0)
        expect(friends.friendRequests.invites).toBe(1)
        friends.setFastFriendPolling(true)
        expect(friends.friendRequests.invites).toBe(1)
    })

    it('приглашение, пришедшее между проверками, появляется на следующей', async () => {
        friends.setFastFriendPolling(true)
        friends.startFriendRequestsPolling()
        await vi.advanceTimersByTimeAsync(0)
        expect(friends.friendRequests.invites).toBe(0)
        counts.invites = 1
        await vi.advanceTimersByTimeAsync(10_500)
        expect(friends.friendRequests.invites).toBe(1)
    })
})
