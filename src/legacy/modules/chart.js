export function createChartModule(ctx) {
    const { dom, state, releases, releasePlayCountCache, utils, getDb } = ctx
    const { parseTrackKey, escapeHtml } = utils

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
            const chartPage = document.getElementById('page-chart')
            if (chartPage && chartPage.classList.contains('active')) renderChart()
        } catch (e) {
            console.warn('Play count update failed:', e)
        } finally {
            if (isSameSession()) state.trackCountPending = false
        }
    }

    async function renderChart() {
        if (!dom.chartList) return
        const db = await getDb()
        if (!db) {
            dom.chartList.innerHTML = '<p class="text-center text-[var(--fg-muted)] mt-10">База недоступна.</p>'
            return
        }
        const { data, error } = await db
            .from('play_counts').select('track_key, plays')
            .order('plays', { ascending: false }).limit(50)
        if (error) {
            dom.chartList.innerHTML = '<p class="text-center text-[var(--fg-muted)] mt-10">Ошибка загрузки.</p>'
            return
        }
        const tracksMap = new Map()
        ;(data || []).forEach(item => {
            const parsed = parseTrackKey(item.track_key)
            if (!parsed) return
            const release = releases[parsed.releaseId]
            const track = release && release.tracks[parsed.trackIndex]
            if (!track) return
            const aggregateKey = `${parsed.releaseId}::${parsed.trackIndex}`
            const existing = tracksMap.get(aggregateKey)
            const plays = Number(item.plays) || 0
            if (existing) {
                existing.plays += plays
            } else {
                tracksMap.set(aggregateKey, { title: track.title, cover: release.cover, plays, releaseId: parsed.releaseId, trackIndex: parsed.trackIndex })
            }
        })

        const tracks = Array.from(tracksMap.values()).sort((a, b) => b.plays - a.plays).slice(0, 50)
        dom.chartList.innerHTML = tracks.length === 0
            ? '<p class="text-center text-[var(--fg-muted)] mt-10">Список пуст.</p>'
            : tracks.map((t, i) => `
                <div class="chart-row cursor-pointer group" onclick="App.playChart('${escapeHtml(t.releaseId)}', ${t.trackIndex})">
                    <div class="chart-num ${i < 3 ? `top-${i + 1}` : ''}">${i + 1}</div>
                    <div class="chart-cover"><img src="${t.cover}" alt="" loading="${i < 8 ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${i < 3 ? 'high' : 'low'}"></div>
                    <div class="chart-info"><div class="chart-title">${escapeHtml(t.title)}</div><div class="chart-artist">frnk ness</div></div>
                    <div class="chart-plays"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>${t.plays}</div>
                </div>
            `).join('')
    }

    function playChart(releaseId, trackIndex) {
        ctx.modules.router.goRelease(releaseId)
        ctx.modules.player.playTrackByRef(releaseId, trackIndex, 'fade')
    }

    return { getReleasePlayCount, getTrackPlayCount, incrementPlayCount, renderChart, playChart }
}
