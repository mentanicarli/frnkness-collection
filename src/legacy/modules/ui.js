export function createUiModule(ctx) {
    const { dom, state, releases, utils } = ctx
    const { throttle } = utils

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

        if (dom.homePromo) {
            const promoId = ctx.SHOW_NEW_RELEASE_PROMO ? ctx.NEW_RELEASE_PROMO_ID : null
            if (promoId && releases[promoId]) {
                const promo = releases[promoId]
                dom.homePromo.innerHTML = `
                    <button class="release-card promo-release-card text-left rounded-xl p-5 transition-all group relative w-full" data-id="${promoId}" data-fixed-accent="true" onclick="App.openRelease('${promoId}')">
                        <div class="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                            <div class="w-full sm:w-44 aspect-square rounded-xl overflow-hidden bg-[var(--bg)] shadow-lg flex-shrink-0">
                                <img src="${promo.cover}" alt="${promo.title}" class="card-image w-full h-full object-cover" loading="eager" decoding="async" fetchpriority="high" onerror="this.style.display='none'">
                            </div>
                            <div class="flex-1 min-w-0 flex flex-col gap-4">
                                <div class="promo-badge text-sm sm:text-[0.95rem]">последний релиз</div>
                                <div>
                                    <h3 class="promo-title text-2xl sm:text-3xl font-semibold transition-colors line-clamp-2 relative z-10">${promo.title}</h3>
                                    <p class="text-sm text-[var(--fg-muted)] mt-2 relative z-10">${promo.tracks.length} трек${promo.tracks.length === 1 ? '' : promo.tracks.length < 5 ? 'а' : 'ов'} • ${promo.year}</p>
                                </div>
                                <p class="text-sm text-[var(--fg-muted)] max-w-2xl leading-relaxed relative z-10">Новый сингл уже доступен. Перейди к релизу и послушай его первым.</p>
                                <div class="flex items-center gap-3">
                                    <span class="promo-cta inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs tracking-widest uppercase font-semibold">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 5v14l11-7z" /></svg>
                                        Открыть
                                    </span>
                                </div>
                            </div>
                        </div>
                    </button>
                `
                const promoCard = dom.homePromo.querySelector('.promo-release-card')
                if (promoCard) ctx.modules.colors.applyCardAccent(promoCard, promo.cover)
            } else {
                dom.homePromo.innerHTML = ''
            }
        }

        Object.entries(releases).forEach(([id, r], index) => {
            const isPriorityCard = index < 6
            const meta = r.type === 'album' ? `${r.tracks.length} треков` : 'Сингл'
            const card = `
                <button class="release-card text-left rounded-xl p-4 transition-all group relative" data-id="${id}" onclick="App.openRelease('${id}')">
                    <div class="aspect-square rounded-lg overflow-hidden mb-4 bg-[var(--bg)] shadow-lg">
                        <img src="${r.cover}" alt="${r.title}" class="card-image w-full h-full object-cover" loading="${isPriorityCard ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${index < 4 ? 'high' : 'low'}" onerror="this.style.display='none'">
                    </div>
                    <h3 class="font-semibold text-[var(--fg)] group-hover:text-[var(--card-accent)] transition-colors line-clamp-2 relative z-10">${r.title}</h3>
                    <p class="text-xs text-[var(--fg-muted)] mt-1 relative z-10">${meta} • ${r.year}</p>
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
            dom.releaseCover.innerHTML = `<img src="${r.cover}" alt="${r.title}" class="w-full h-full object-cover" loading="eager" fetchpriority="high" decoding="async" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full bg-[var(--bg-card)] flex items-center justify-center\\'><span class=\\'text-[var(--fg-muted)]\\'>Нет обложки</span></div>'">`
        }
        if (dom.releaseTitle) dom.releaseTitle.textContent = r.title
        if (dom.releaseMeta) dom.releaseMeta.textContent = `${r.type === 'album' ? 'Альбом' : 'Сингл'} • ${r.year}`
        if (dom.releasePlays) {
            dom.releasePlays.classList.remove('hidden')
            dom.releasePlays.textContent = 'Счетчик прослушиваний загружается...'
        }

        if (dom.downloadContainer) {
            if (r.lyricsBookPath && dom.downloadBtn) {
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

        if (dom.releasePlays) {
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
        dom.tracklist.innerHTML = state.currentRelease.tracks.map((t, i) => `
            <div class="track-row flex items-center gap-5 py-4 px-4 cursor-pointer group" data-track-index="${i}" onclick="App.handleTrackClick(${i})">
                <span class="track-num w-6 text-center text-[var(--fg-muted)] text-sm font-mono group-hover:hidden">${String(t.num).padStart(2, '0')}</span>
                <span class="w-6 text-center hidden group-hover:block">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" class="text-[var(--page-accent)]"><path d="M8 5v14l11-7z"/></svg>
                </span>
                <div class="flex-1 min-w-0"><p class="font-medium truncate">${t.title}</p></div>
                <button onclick="event.stopPropagation(); App.showLyrics(${i})" class="lyrics-action-btn scale-90 opacity-0 group-hover:opacity-100" aria-label="Текст песни">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span>Текст</span>
                </button>
            </div>
        `).join('')
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
