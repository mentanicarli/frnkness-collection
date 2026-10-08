import { watch } from 'vue'
import { player } from '../player/state'
import { session } from '../session'
import { api } from './api'
import { feed } from './feedStore'
import { loadFavorites, resetFavorites } from './favorites'
import { startFriendRequestsPolling, stopFriendRequestsPolling } from './friends'
import { createNowPlayingReporter } from './nowPlaying'
import { loadMyPlaylists, resetMyPlaylists } from './playlists'
import { loadRecapState, resetRecap } from '../recap/store'
import { startTagsPolling, stopTagsPolling } from './tags'

/**
 * Связь «кто вошёл» ↔ социальные сторы сайта. Вызывается один раз
 * из App.vue: при входе загружает избранное и плейлисты, включает
 * индикатор заявок и «сейчас слушает»; при выходе всё сбрасывает.
 */
export function bindSocialToSession(): void {
    const reporter = createNowPlayingReporter({
        send: (trackId) => api.nowPlayingSet(trackId),
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
    })

    watch(
        () => session.user?.id ?? null,
        (id) => {
            reporter.reset()
            feed.reset()
            resetFavorites(id)
            resetMyPlaylists(id)
            resetRecap()
            if (!id) {
                stopFriendRequestsPolling()
                stopTagsPolling()
                return
            }
            void loadFavorites()
            void loadMyPlaylists()
            void loadRecapState()
            startFriendRequestsPolling()
            startTagsPolling()
        },
        { immediate: true }
    )

    watch(
        () => [player.currentTrackId, player.isPlaying, player.playSession] as const,
        ([trackId, playing]) => {
            if (session.user) reporter.update(trackId, playing)
        }
    )
}
