export function createUiModule(ctx) {
    const { dom, state, releases, utils, PROMO_RELEASE_ID, SHOW_NEW_RELEASE_PROMO } = ctx
    const { throttle, escapeHtml } = utils

    function initParticles() {
        const container = document.getElementById('particles-js')
        if (!container) return
        const style = document.createElement('style')
        style.textContent = `
            @keyframes float {
                0% { transform: translateY(0) translateX(0); opacity: 0; }
                50% { opacity: 0.5; }
                100% { transform: translateY(-100vh) translateX(${Math.random() > 0.5 ? '' : '-'}50px); opacity: 0; }
            }
        `
        document.head.appendChild(style)
        for (let i = 0; i < 15; i++) {
            const p = document.createElement('div')
            const size = Math.random() * 3 + 1
            p.style.cssText = `
                position: absolute; width: ${size}px; height: ${size}px;
                background: rgba(212, 255, 0, 0.4); border-radius: 50%;
                left: ${Math.random() * 100}%; top: ${Math.random() * 100}%;
                box-shadow: 0 0 ${size * 2}px rgba(212, 255, 0, 0.2);
                animation: float ${Math.random() * 10 + 10}s linear infinite;
                animation-delay: ${Math.random() * 5}s;
                will-change: transform, opacity;
            `
            container.appendChild(p)
        }
    }

    function initStaggerAnimation() {
        document.querySelectorAll('.stagger-item').forEach((item, i) => {
            item.classList.remove('visible')
            setTimeout(() => item.classList.add('visible'), i * 150)
        })
    }

    function moveCardGradient(e) {
        const card = e.currentTarget
        const rect = card.getBoundingClientRect()
        card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
        card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
    }

    function renderHome() {
        if (!dom.albumsGrid || !dom.singlesGrid) return
        let albumsHtml = '', singlesHtml = ''

        // Промо-блок собирается из релиза, на который указывает PROMO_RELEASE_ID.
        const promoRelease = SHOW_NEW_RELEASE_PROMO ? releases[PROMO_RELEASE_ID] : null
        if (dom.homePromo && promoRelease) {
            const promoCover = promoRelease.cover
            const promoTitle = escapeHtml(promoRelease.title)
            const promoId = escapeHtml(PROMO_RELEASE_ID)
            dom.homePromo.innerHTML = `
                <div class="release-card promo-release-card text-left relative w-full" data-fixed-accent="true" onclick="App.openRelease('${promoId}')" style="cursor: pointer; padding: clamp(16px,2vw,26px);">
                    <div class="flex flex-col sm:flex-row items-start sm:items-center" style="gap: clamp(18px,3vw,40px);">
                        <div class="promo-cover-wrap aspect-square overflow-hidden bg-[var(--bg)] flex-shrink-0" style="border-radius: 8px;">
                            <img src="${promoCover}" alt="${promoTitle}" class="card-image w-full h-full object-cover" loading="eager" decoding="async" fetchpriority="high" onerror="this.style.display='none'">
                        </div>
                        <div class="flex-1 min-w-0 flex flex-col" style="gap: 16px;">
                            <div class="promo-badge">последний релиз</div>
                            <h3 class="promo-title line-clamp-2 relative z-10" style="font-size: clamp(24px,4vw,50px); line-height: 1;">${promoTitle}</h3>
                            <div class="flex items-center gap-3">
                                <button class="promo-cta inline-flex items-center gap-2" style="height: 44px; padding: 0 20px; border-radius: 6px; font-size: 13px;" onclick="App.openRelease('${promoId}')">
                                    Перейти
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `
            const promoCard = dom.homePromo.querySelector('.promo-release-card')
            if (promoCard) ctx.modules.colors.applyCardAccent(promoCard, promoCover)
        } else if (dom.homePromo) {
            dom.homePromo.innerHTML = ''
        }

        Object.entries(releases).forEach(([id, r], index) => {
            const isPriorityCard = index < 6
            const meta = r.type === 'album' ? `${r.tracks.length} треков` : 'Сингл'
            const safeId = escapeHtml(id)
            const safeTitle = escapeHtml(r.title)
            const card = `
                <button class="release-card text-left transition-all group relative" data-id="${safeId}" onclick="App.openRelease('${safeId}')">
                    <div class="aspect-square overflow-hidden mb-3 bg-[var(--bg)] relative">
                        <img src="${r.cover}" alt="${safeTitle}" class="card-image w-full h-full object-cover" loading="${isPriorityCard ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${index < 4 ? 'high' : 'low'}" onerror="this.style.display='none'">
                    </div>
                    <h3 class="font-semibold text-[var(--fg)] transition-colors line-clamp-2 relative z-10">${safeTitle}</h3>
                    <p class="text-xs text-[var(--fg-muted)] mt-1 relative z-10">${meta} • ${escapeHtml(r.year)}</p>
                </button>
            `
            if (r.type === 'album') albumsHtml += card
            else singlesHtml += card
        })

        dom.albumsGrid.innerHTML = albumsHtml
        dom.singlesGrid.innerHTML = singlesHtml

        const throttledMove = throttle(moveCardGradient, 16)
        document.querySelectorAll('.release-card').forEach(card => {
            card.addEventListener('mouseenter', async (e) => {
                card.addEventListener('mousemove', throttledMove)
                const img = card.querySelector('img')
                if (img) await ctx.modules.colors.applyCardAccent(card, img.src)
            })
            card.addEventListener('mouseleave', () => {
                card.removeEventListener('mousemove', throttledMove)
                if (card.dataset.fixedAccent !== 'true') ctx.modules.colors.resetCardAccent(card)
            })
        })
    }

    function openRelease(id) {
        const r = releases[id]
        if (!r) return

        state.currentRelease = r
        state.currentReleaseId = id
        state.currentTrackIndex = -1
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
                if (state.currentReleaseId !== id || !dom.releasePlays) return
                dom.releasePlays.textContent = `Прослушиваний ${r.type === 'album' ? 'альбома' : 'сингла'}: ${total}`
            })
        }

        renderTracklist()
        showPage('release')
    }

    function renderTracklist() {
        if (!dom.tracklist || !state.currentRelease) return
        dom.tracklist.innerHTML = state.currentRelease.tracks.map((t, i) => {
            return `
                <div class="track-row cursor-pointer group" data-track-index="${i}" onclick="App.handleTrackClick(${i})">
                    <span class="track-num">
                        <span class="track-num-digit group-hover:hidden">${String(t.num).padStart(2, '0')}</span>
                        <svg class="track-num-play hidden group-hover:block" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </span>
                    <div class="flex-1 min-w-0"><p class="font-medium truncate">${escapeHtml(t.title)}</p></div>
                    <button onclick="event.stopPropagation(); App.showLyrics(${i})" class="lyrics-action-btn opacity-0 group-hover:opacity-100" aria-label="Текст песни">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <span>Текст</span>
                    </button>
                </div>
            `
        }).join('')
    }

    function showPage(name) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
        const page = document.getElementById('page-' + name)
        if (page) page.classList.add('active')
        document.body.classList.toggle('release-page', name === 'release')
        window.scrollTo(0, 0)
        if (name === 'home') ctx.modules.colors.resetPageAccent()
        if (name === 'home') setTimeout(initStaggerAnimation, 50)
        if (name === 'home' && dom.searchInput) ctx.modules.search.handleSearchInput(dom.searchInput.value)
        if (name === 'chart') ctx.modules.chart.renderChart()
        if (name !== 'home') ctx.modules.search.toggleSearchPanel(false)
    }

    return { initParticles, initStaggerAnimation, renderHome, openRelease, renderTracklist, showPage }
}
