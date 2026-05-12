export function createChartModule(ctx) {
    const { dom, state, releases, releasePlayCountCache, utils } = ctx
    const { parseTrackKey } = utils

    async function getReleasePlayCount(releaseId) {
        const release = releases[releaseId]
        if (!release) return 0
        if (releasePlayCountCache[releaseId] !== undefined) return releasePlayCountCache[releaseId]
        if (!state.db) return 0

        try {
            const { data, error } = await state.db.from('play_counts').select('track_key, plays')
            if (error) throw error
            let total = 0
            ;(data || []).forEach(item => {
                const parsed = parseTrackKey(item.track_key)
                if (!parsed || parsed.releaseId !== releaseId) return
                total += Number(item.plays) || 0
            })
            releasePlayCountCache[releaseId] = total
            return total
        } catch (e) {
            console.warn('Release play count load failed:', e)
            return 0
        }
    }

    async function incrementPlayCount() {
        if (!state.currentReleaseId || !state.db || state.trackCounted || state.trackCountPending) return
        state.trackCountPending = true
        const releaseId = state.currentReleaseId
        try {
            const { error } = await state.db.rpc('increment_play_count', {
                track_key_input: `${releaseId}-${state.currentTrackIndex}`
            })
            if (error) throw error
            state.trackCounted = true
            delete releasePlayCountCache[releaseId]
            if (state.currentReleaseId === releaseId && state.currentRelease && dom.releasePlays) {
                dom.releasePlays.textContent = 'Счетчик прослушиваний обновляется...'
                getReleasePlayCount(releaseId).then(total => {
                    if (state.currentReleaseId === releaseId && dom.releasePlays) {
                        const type = state.currentRelease?.type === 'album' ? 'альбома' : 'сингла'
                        dom.releasePlays.textContent = `Прослушиваний ${type}: ${total}`
                    }
                })
            }
            const chartPage = document.getElementById('page-chart')
            if (chartPage && chartPage.classList.contains('active')) renderChart()
        } catch (e) {
            console.warn('Play count update failed:', e)
        } finally {
            state.trackCountPending = false
        }
    }

    async function renderChart() {
        if (!dom.chartList) return
        if (!state.db) {
            dom.chartList.innerHTML = '<p class="text-center text-[var(--fg-muted)] mt-10">База недоступна.</p>'
            return
        }
        const { data, error } = await state.db
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
                <div class="chart-row cursor-pointer group" onclick="App.playChart('${t.releaseId}', ${t.trackIndex})">
                    <div class="chart-num ${i < 3 ? `top-${i + 1}` : ''}">${i + 1}</div>
                    <div class="chart-cover"><img src="${t.cover}" alt="" loading="${i < 8 ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${i < 3 ? 'high' : 'low'}"></div>
                    <div class="chart-info"><div class="chart-title">${t.title}</div><div class="chart-artist">frnk ness</div></div>
                    <div class="chart-plays"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>${t.plays}</div>
                </div>
            `).join('')
    }

    function playChart(releaseId, trackIndex) {
        ctx.modules.ui.openRelease(releaseId)
        setTimeout(() => ctx.modules.player.playTrack(trackIndex, 'fade'), 100)
    }

    return { getReleasePlayCount, incrementPlayCount, renderChart, playChart }
}
