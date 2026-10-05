import { markStatsChanged } from '../../site/services/stats'

export function createChartModule(ctx) {
    const { dom, state, releases, releasePlayCountCache, utils, getDb } = ctx
    const { parseTrackKey } = utils

    // Один запрос на релиз отдаёт и сумму по релизу, и разбивку по трекам,
    // поэтому странице трека не нужен отдельный поход в базу.
    const releaseTrackPlaysCache = {}

    async function loadReleasePlays(releaseId) {
        const release = releases[releaseId]
        if (!release) return { total: 0, byTrack: {} }
        if (releasePlayCountCache[releaseId] !== undefined) {
            return { total: releasePlayCountCache[releaseId], byTrack: releaseTrackPlaysCache[releaseId] || {} }
        }
        const db = await getDb()
        if (!db) return { total: 0, byTrack: {} }

        try {
            // Ключи трека начинаются с releaseId, поэтому префиксный фильтр
            // отдаёт только нужные строки вместо всей таблицы.
            const { data, error } = await db
                .from('play_counts')
                .select('track_key, plays')
                .like('track_key', `${releaseId}-%`)
            if (error) throw error
            let total = 0
            const byTrack = {}
            ;(data || []).forEach(item => {
                const parsed = parseTrackKey(item.track_key)
                if (!parsed || parsed.releaseId !== releaseId) return
                const plays = Number(item.plays) || 0
                total += plays
                // Старый и новый формат ключа могут указывать на один трек,
                // поэтому складываем, а не перезаписываем.
                byTrack[parsed.trackIndex] = (byTrack[parsed.trackIndex] || 0) + plays
            })
            releasePlayCountCache[releaseId] = total
            releaseTrackPlaysCache[releaseId] = byTrack
            return { total, byTrack }
        } catch (e) {
            console.warn('Release play count load failed:', e)
            return { total: 0, byTrack: {} }
        }
    }

    async function getReleasePlayCount(releaseId) {
        const { total } = await loadReleasePlays(releaseId)
        return total
    }

    async function getTrackPlayCount(releaseId, trackIndex) {
        const { byTrack } = await loadReleasePlays(releaseId)
        return byTrack[trackIndex] || 0
    }

    async function incrementPlayCount() {
        if (!state.currentReleaseId || state.trackCounted || state.trackCountPending) return
        // Всё, что входит в ключ, фиксируем до await: пока идёт запрос,
        // может заиграть другой трек.
        const releaseId = state.currentReleaseId
        const trackIndex = state.currentTrackIndex
        const session = state.playSession
        const release = releases[releaseId]
        // Защита от мусорных ключей: «release--1» база прочитала бы как
        // старый 1-based формат и засчитала бы первому треку релиза.
        if (!release || !Number.isInteger(trackIndex) || trackIndex < 0 || !release.tracks[trackIndex]) return
        const isSameSession = () => state.playSession === session
        state.trackCountPending = true
        try {
            const db = await getDb()
            if (!db) return
            const { error } = await db.rpc('increment_play_count', {
                track_key_input: `${releaseId}-${trackIndex}`
            })
            if (error) throw error
            // Флаг относится к запуску, который засчитывали: новый запуск
            // (даже того же трека) должен засчитаться сам.
            if (isSameSession()) state.trackCounted = true
            delete releasePlayCountCache[releaseId]
            delete releaseTrackPlaysCache[releaseId]
            // Счётчик на странице — только если открыт тот релиз, которому засчитали.
            if (state.viewedReleaseId === releaseId && dom.releasePlays) {
                dom.releasePlays.textContent = 'Счетчик прослушиваний обновляется...'
                getReleasePlayCount(releaseId).then(total => {
                    if (state.viewedReleaseId === releaseId && dom.releasePlays) {
                        const type = release.type === 'album' ? 'альбома' : 'сингла'
                        dom.releasePlays.textContent = `Прослушиваний ${type}: ${total}`
                    }
                })
            }
            // Открытый чарт перечитает цифры сам.
            markStatsChanged(releaseId)
        } catch (e) {
            console.warn('Play count update failed:', e)
        } finally {
            if (isSameSession()) state.trackCountPending = false
        }
    }

    return { getReleasePlayCount, getTrackPlayCount, incrementPlayCount }
}
