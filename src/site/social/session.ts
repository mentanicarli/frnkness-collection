import { watch } from 'vue'
import { player } from '../player/state'
import { session } from '../session'
import { api } from './api'
import { loadFavorites, resetFavorites } from './favorites'
import { startFriendRequestsPolling, stopFriendRequestsPolling } from './friends'
import { createNowPlayingReporter } from './nowPlaying'
import { loadMyPlaylists, resetMyPlaylists } from './playlists'

/**
 * Связь «кто вошёл» ↔ сторы этапа «Музыка и друзья». Вызывается один раз
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
            resetFavorites(id)
            resetMyPlaylists(id)
            if (!id) {
                stopFriendRequestsPolling()
                return
            }
            void loadFavorites()
            void loadMyPlaylists()
            startFriendRequestsPolling()
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
