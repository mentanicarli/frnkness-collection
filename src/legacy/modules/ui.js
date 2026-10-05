import { lyricsBookFilename } from '../../utils/lyricsBook'

export function createUiModule(ctx) {
    const { dom, state, releases, utils } = ctx
    const { escapeHtml } = utils

    function initStaggerAnimation() {
        document.querySelectorAll('.stagger-item').forEach((item, i) => {
            item.classList.remove('visible')
            setTimeout(() => item.classList.add('visible'), i * 150)
        })
    }

    // Только отрисовка содержимого страницы релиза.
    // Показ страницы и адрес в URL — задача роутера.
    // Меняет только «открытый» релиз: играющий трек (state.currentRelease*)
    // принадлежит плееру и от навигации не зависит.
    function renderRelease(id) {
        const r = releases[id]
        if (!r) return

        state.viewedReleaseId = id
        ctx.modules.colors.updatePageAccent(r.cover)

        if (dom.releaseCover) {
            dom.releaseCover.innerHTML = `<img src="${r.cover}" alt="${escapeHtml(r.title)}" class="w-full h-full object-cover" loading="eager" fetchpriority="high" decoding="async" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full bg-[var(--bg-card)] flex items-center justify-center\\'><span class=\\'text-[var(--fg-muted)]\\'>Нет обложки</span></div>'">`
        }
        if (dom.releaseTitle) dom.releaseTitle.textContent = r.title
        if (dom.releaseMeta) {
            const dateDisplay = r.releaseDate || r.year
            dom.releaseMeta.textContent = r.upcoming
                ? 'Альбом • скоро...'
                : `${r.type === 'album' ? 'Альбом' : 'Сингл'} • ${dateDisplay}`
        }
        if (dom.releasePlays) {
            if (r.upcoming) {
                dom.releasePlays.classList.add('hidden')
            } else {
                dom.releasePlays.classList.remove('hidden')
                dom.releasePlays.textContent = 'Счетчик прослушиваний загружается...'
            }
        }

        if (dom.downloadContainer) {
            if (!r.upcoming && r.lyricsBookPath && dom.downloadBtn) {
                dom.downloadBtn.href = r.lyricsBookPath
                dom.downloadBtn.download = lyricsBookFilename(r.title)
                dom.downloadContainer.classList.remove('hidden')
            } else {
                dom.downloadContainer.classList.add('hidden')
            }
        }

        if (dom.videoContainer) {
            if (r.videoUrl && dom.videoIframe) {
                dom.videoContainer.classList.remove('hidden')
                setTimeout(() => { dom.videoIframe.src = r.videoUrl }, 50)
            } else {
                if (dom.videoIframe) dom.videoIframe.src = ''
                dom.videoContainer.classList.add('hidden')
            }
        }

        if (dom.releasePlays && !r.upcoming) {
            ctx.modules.chart.getReleasePlayCount(id).then(total => {
                if (state.viewedReleaseId !== id || !dom.releasePlays) return
                dom.releasePlays.textContent = `Прослушиваний ${r.type === 'album' ? 'альбома' : 'сингла'}: ${total}`
            })
        }

        renderTracklist()
    }

    function renderTracklist() {
        const release = state.viewedReleaseId ? releases[state.viewedReleaseId] : null
        if (!dom.tracklist || !release) return
        dom.tracklist.innerHTML = release.tracks.map((t, i) => {
            return `
                <div class="track-row cursor-pointer group" data-track-index="${i}" onclick="App.handleTrackClick(${i})">
                    <span class="track-num">
                        <span class="track-num-digit group-hover:hidden">${String(t.num).padStart(2, '0')}</span>
                        <svg class="track-num-play hidden group-hover:block" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </span>
                    <div class="flex-1 min-w-0"><p class="track-title font-medium truncate">${escapeHtml(t.title)}</p></div>
                    <button onclick="event.stopPropagation(); App.openTrackPage(${i})" class="lyrics-action-btn track-page-btn opacity-0 group-hover:opacity-100" aria-label="Страница трека">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <span>Текст</span>
                    </button>
                </div>
            `
        }).join('')
        // Если открыт играющий релиз — сразу подсвечиваем его трек.
        ctx.modules.player.syncTracklistState()
    }

    function showPage(name) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
        const page = document.getElementById('page-' + name)
        if (page) page.classList.add('active')
        document.body.classList.toggle('release-page', name === 'release' || name === 'track')
        // Страницы релиза и трека выставляют открытый релиз сами при отрисовке.
        if (name !== 'release' && name !== 'track') state.viewedReleaseId = null
        window.scrollTo(0, 0)
        if (name === 'home') ctx.modules.colors.resetPageAccent()
        if (name === 'home') setTimeout(initStaggerAnimation, 50)
        if (name === 'home' && dom.searchInput) ctx.modules.search.handleSearchInput(dom.searchInput.value)
        if (name === 'chart') ctx.modules.chart.renderChart()
        if (name !== 'home') ctx.modules.search.toggleSearchPanel(false)
    }

    return { initStaggerAnimation, renderRelease, renderTracklist, showPage }
}
