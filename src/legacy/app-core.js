export function initLegacyApp(deps = {}) {
    if (window.__legacyAppInitialized) return;
    window.__legacyAppInitialized = true;

    /**
             * ============================================================
             * FRNK NESS COLLECTION - MUSIC PLAYER
             * ============================================================
             *Раздел
             *Раздел
             */
    (function () {
        'use strict';

        // ============================================================
        // ============================================================
        const {
            config = {},
            shared = {},
            utils = {}
        } = deps;

        const {
            SUPABASE_URL = '',
            SUPABASE_ANON_KEY = '',
            SHOW_NEW_RELEASE_PROMO = false,
            NEW_RELEASE_PROMO_ID = '',
            releases = {}
        } = config;

        const {
            DEFAULT_COLOR = { hex: 'rgb(103, 114, 131)', glow: 'rgba(103, 114, 131, 0.32)', soft: 'rgba(103, 114, 131, 0.18)' },
            runtimeState = {},
            runtimeCaches = {}
        } = shared;

        const {
            formatTime = (seconds) => {
                if (isNaN(seconds)) return '0:00';
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            },
            throttle = (func, limit) => {
                let inThrottle;
                return function (...args) {
                    if (!inThrottle) {
                        func.apply(this, args);
                        inThrottle = true;
                        setTimeout(() => inThrottle = false, limit);
                    }
                };
            },
            debounce = (func, delay) => {
                let timer;
                return function (...args) {
                    clearTimeout(timer);
                    timer = setTimeout(() => func.apply(this, args), delay);
                };
            },
            parseLRC = (text) => {
                return text.split('\n').map(line => {
                    const m = line.match(/\[(\d{2}):(\d{2})(?:\.|:)(\d{2})?\](.*)/);
                    if (m) {
                        return {
                            time: parseInt(m[1]) * 60 + parseInt(m[2]) + (m[3] ? parseInt(m[3]) / 100 : 0),
                            text: m[4] || ''
                        };
                    }
                    return null;
                }).filter(Boolean).sort((a, b) => a.time - b.time);
            },
            parseTrackKey = (key) => {
                if (typeof key !== 'string') return null;
                const legacyMatch = key.match(/^(.*)--(\d+)$/);
                if (legacyMatch) {
                    const releaseId = legacyMatch[1];
                    const oneBased = parseInt(legacyMatch[2], 10);
                    const trackIndex = oneBased - 1;
                    if (Number.isInteger(trackIndex) && trackIndex >= 0) {
                        return { releaseId, trackIndex };
                    }
                    return null;
                }
                const modernMatch = key.match(/^(.*)-(\d+)$/);
                if (modernMatch) {
                    const releaseId = modernMatch[1];
                    const trackIndex = parseInt(modernMatch[2], 10);
                    if (Number.isInteger(trackIndex) && trackIndex >= 0) {
                        return { releaseId, trackIndex };
                    }
                }
                return null;
            }
        } = utils;

        const state = runtimeState;
        const { colorCache = {}, colorPromiseCache = {}, releasePlayCountCache = {} } = runtimeCaches;

        // ============================================================
        // ============================================================

        /**
         *Раздел
         */
        const $ = id => document.getElementById(id);

        // ============================================================
        // ============================================================
        const dom = {};
        const perf = {
            lastProgressPercent: -1,
            lastSecond: -1,
            searchCache: new Map(),
            preloadedAudio: new Set()
        };

        function runWhenIdle(fn) {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(fn, { timeout: 800 });
            } else {
                setTimeout(fn, 16);
            }
        }

        function preloadTrackMetadata(releaseId, trackIndex) {
            const release = releases[releaseId];
            const track = release && release.tracks[trackIndex];
            if (!release || !track) return;

            const src = release.audioPath + track.file;
            if (perf.preloadedAudio.has(src)) return;
            if (perf.preloadedAudio.size > 14) {
                const oldest = perf.preloadedAudio.values().next().value;
                if (oldest) perf.preloadedAudio.delete(oldest);
            }

            const probe = new Audio();
            probe.preload = 'metadata';
            probe.src = src;
            perf.preloadedAudio.add(src);
        }

        function warmupVisibleReleaseAssets() {
            runWhenIdle(() => {
                const firstItems = Object.values(releases).slice(0, 5);
                firstItems.forEach((release) => {
                    const img = new Image();
                    img.decoding = 'async';
                    img.src = release.cover;
                });
            });
        }

        function cacheDomElements() {
            dom.audio = $('audio-player');
            dom.player = $('player');
            dom.progress = $('progress-bar');
            dom.iconPlay = $('icon-play');
            dom.iconPause = $('icon-pause');
            dom.lyricsPanel = $('lyrics-panel');
            dom.downloadContainer = $('download-container');
            dom.downloadBtn = $('download-lyrics-btn');
            dom.lyricsContent = $('lyrics-content');
            dom.videoContainer = $('video-container');
            dom.videoIframe = $('video-iframe');
            dom.volumeSlider = $('volume-slider');
            dom.volWave1 = $('vol-wave-1');
            dom.volWave2 = $('vol-wave-2');
            dom.playPauseBtn = $('play-pause-btn');
            dom.playerCover = $('player-cover');
            dom.lyricsBtn = $('lyrics-btn');
            dom.lyricsBtnMobile = $('lyrics-btn-mobile');
            dom.fsPlayer = $('fullscreen-player');
            dom.fsBg = $('fs-bg');
            dom.fsCoverA = $('fs-cover-a');
            dom.fsCoverB = $('fs-cover-b');
            dom.fsPlayBtn = $('fs-play-btn');
            dom.fsIconPlay = $('fs-icon-play');
            dom.fsIconPause = $('fs-icon-pause');
            dom.fsProgress = $('fs-progress-bar');
            dom.fsTimeCurrent = $('fs-time-current');
            dom.fsTimeTotal = $('fs-time-total');
            dom.fsTitle = $('fs-track-title');
            dom.fsLyricsToggle = $('fs-lyrics-toggle');
            dom.fsLyricsBody = $('fs-lyrics-body');
            dom.fsLyricsTitle = $('fs-lyrics-title');
            dom.fsVolumeSlider = $('fs-volume-slider');
            dom.fsVolWave1 = $('fs-vol-wave-1');
            dom.fsVolWave2 = $('fs-vol-wave-2');
            dom.albumsGrid = $('albums-grid');
            dom.singlesGrid = $('singles-grid');
            dom.chartList = $('chart-list');
            dom.tracklist = $('tracklist');
            dom.playerTrack = $('player-track');
            dom.releaseCover = $('release-cover');
            dom.releaseTitle = $('release-title');
            dom.releaseMeta = $('release-meta');
            dom.releasePlays = $('release-plays');
            dom.flowModeBtn = $('flow-mode-btn');
            dom.flowModeLabel = $('flow-mode-label');
            dom.homePromo = $('home-promo');
            dom.searchInput = $('global-search');
            dom.searchResults = $('search-results');
            dom.searchPanel = $('header-search-panel');
            dom.searchToggle = $('search-toggle-btn');
            dom.searchBackdrop = $('search-backdrop');
            dom.albumsSection = dom.albumsGrid ? dom.albumsGrid.closest('section') : null;
            dom.singlesSection = dom.singlesGrid ? dom.singlesGrid.closest('section') : null;
            dom.lyricsModeSwitch = $('lyrics-mode-switch');
            dom.lyricsModeText = $('lyrics-mode-text');
            dom.lyricsModeKaraoke = $('lyrics-mode-karaoke');
            dom.fsLyricsModeSwitch = $('fs-lyrics-mode-switch');
            dom.fsLyricsModeText = $('fs-lyrics-mode-text');
            dom.fsLyricsModeKaraoke = $('fs-lyrics-mode-karaoke');
        }

        // ============================================================
        // ?Открыть релиз?
        // ============================================================

        /**
         *Раздел
         *Раздел
         */
        function getAverageColorFromImage(img) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            const width = Math.max(1, Math.min(64, img.naturalWidth || 64));
            const height = Math.max(1, Math.min(64, img.naturalHeight || 64));

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            const { data } = ctx.getImageData(0, 0, width, height);
            let r = 0, g = 0, b = 0, count = 0;

            for (let i = 0; i < data.length; i += 16) {
                const alpha = data[i + 3];
                if (alpha < 16) continue;
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
                count++;
            }

            if (!count) throw new Error('Average color extraction failed');
            return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
        }

        /**
         *Раздел
         */
        function getDominantColor(imageUrl) {
            return new Promise((resolve, reject) => {
                if (colorCache[imageUrl]) return resolve(colorCache[imageUrl]);
                if (colorPromiseCache[imageUrl]) return colorPromiseCache[imageUrl].then(resolve, reject);
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                colorPromiseCache[imageUrl] = new Promise((innerResolve, innerReject) => {
                    img.onload = () => {
                        try {
                            let rgb;

                            if (state.colorThief) {
                                try {
                                    rgb = state.colorThief.getColor(img);
                                } catch {
                                    rgb = getAverageColorFromImage(img);
                                }
                            } else {
                                rgb = getAverageColorFromImage(img);
                            }

                            colorCache[imageUrl] = rgb;
                            delete colorPromiseCache[imageUrl];
                            innerResolve(rgb);
                        } catch (e) {
                            delete colorPromiseCache[imageUrl];
                            innerReject(e);
                        }
                    };
                    img.onerror = () => {
                        delete colorPromiseCache[imageUrl];
                        innerReject(new Error('Image load error'));
                    };
                });
                img.src = imageUrl;
                colorPromiseCache[imageUrl].then(resolve, reject);
            });
        }

        /**
         *Раздел
         */
        function rgbToHsl(r, g, b) {
            r /= 255; g /= 255; b /= 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            let h = 0, s = 0, l = (max + min) / 2;
            if (max !== min) {
                const d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
                    case g: h = ((b - r) / d + 2); break;
                    case b: h = ((r - g) / d + 4); break;
                }
                h /= 6;
            }
            return { h: h * 360, s: s * 100, l: l * 100 };
        }

        /**
         *Раздел
         */
        function hslToRgb(h, s, l) {
            h /= 360; s /= 100; l /= 100;
            let r, g, b;
            if (s === 0) {
                r = g = b = l;
            } else {
                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1 / 6) return p + (q - p) * 6 * t;
                    if (t < 1 / 2) return q;
                    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
                    return p;
                };
                const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                const p = 2 * l - q;
                r = hue2rgb(p, q, h + 1 / 3);
                g = hue2rgb(p, q, h);
                b = hue2rgb(p, q, h - 1 / 3);
            }
            return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
        }

        /**
         *Раздел
         */
        function normalizeColor(rgb) {
            const [r, g, b] = rgb;
            const hsl = rgbToHsl(r, g, b);

            if (hsl.s < 12) {
                const neutralLightness = hsl.l > 75
                    ? 90
                    : hsl.l < 30
                        ? 72
                        : Math.min(88, Math.max(72, hsl.l + 10));
                const neutralRgb = hslToRgb(0, 0, neutralLightness);
                return {
                    hex: `rgb(${neutralRgb.r}, ${neutralRgb.g}, ${neutralRgb.b})`,
                    glow: `rgba(${neutralRgb.r}, ${neutralRgb.g}, ${neutralRgb.b}, 0.24)`,
                    soft: `rgba(${neutralRgb.r}, ${neutralRgb.g}, ${neutralRgb.b}, 0.14)`
                };
            }

            if (hsl.l < 30) hsl.l = 66;
            else if (hsl.l > 82) hsl.l = 74;
            else hsl.l = Math.min(76, Math.max(64, hsl.l + 8));

            if (hsl.s < 22) hsl.s = 32;
            else if (hsl.s > 72) hsl.s = 52;
            else hsl.s = Math.min(56, Math.max(34, hsl.s - 10));

            const finalRgb = hslToRgb(hsl.h, hsl.s, hsl.l);
            return {
                hex: `rgb(${finalRgb.r}, ${finalRgb.g}, ${finalRgb.b})`,
                glow: `rgba(${finalRgb.r}, ${finalRgb.g}, ${finalRgb.b}, 0.28)`,
                soft: `rgba(${finalRgb.r}, ${finalRgb.g}, ${finalRgb.b}, 0.14)`
            };
        }

        /**
         *Раздел
         */
        async function updatePlayerAccent(imageUrl) {
            try {
                const rgb = await getDominantColor(imageUrl);
                const vars = normalizeColor(rgb);
                const root = document.documentElement;
                root.style.setProperty('--player-accent', vars.hex);
                root.style.setProperty('--player-accent-glow', vars.glow);
                root.style.setProperty('--player-accent-soft', vars.soft);
            } catch (e) { }
        }

        /**
         *Раздел
         */
        async function updatePageAccent(imageUrl) {
            try {
                const rgb = await getDominantColor(imageUrl);
                const vars = normalizeColor(rgb);
                const root = document.documentElement;
                root.style.setProperty('--page-accent', vars.hex);
                root.style.setProperty('--page-accent-glow', vars.glow);
                root.style.setProperty('--page-accent-soft', vars.soft);
            } catch (e) { }
        }

        /**
         *Раздел
         */
        function resetPageAccent() {
            const root = document.documentElement;
            root.style.setProperty('--page-accent', DEFAULT_COLOR.hex);
            root.style.setProperty('--page-accent-glow', DEFAULT_COLOR.glow);
            root.style.setProperty('--page-accent-soft', DEFAULT_COLOR.soft);
        }

        /**
         *Раздел
         */
        async function applyCardAccent(card, imageUrl) {
            try {
                const rgb = await getDominantColor(imageUrl);
                const vars = normalizeColor(rgb);
                card.style.setProperty('--card-accent', vars.hex);
                card.style.setProperty('--card-glow', vars.glow);
                card.style.setProperty('--card-soft', vars.soft);
            } catch (e) { }
        }

        /**
         *Раздел
         */
        function resetCardAccent(card) {
            card.style.removeProperty('--card-accent');
            card.style.removeProperty('--card-glow');
            card.style.removeProperty('--card-soft');
        }

        // ============================================================
        // ============================================================

        /**
         *Раздел
         */
        function initParticles() {
            const container = $('particles-js');
            if (!container) return;

            const style = document.createElement('style');
            style.textContent = `
                @keyframes float {
                    0% { transform: translateY(0) translateX(0); opacity: 0; }
                    50% { opacity: 0.5; }
                    100% { transform: translateY(-100vh) translateX(${Math.random() > 0.5 ? '' : '-'}50px); opacity: 0; }
                }
            `;
            document.head.appendChild(style);

            for (let i = 0; i < 15; i++) {
                const p = document.createElement('div');
                const size = Math.random() * 3 + 1;
                p.style.cssText = `
                    position: absolute; width: ${size}px; height: ${size}px;
                    background: rgba(212, 255, 0, 0.4); border-radius: 50%;
                    left: ${Math.random() * 100}%; top: ${Math.random() * 100}%;
                    box-shadow: 0 0 ${size * 2}px rgba(212, 255, 0, 0.2);
                    animation: float ${Math.random() * 10 + 10}s linear infinite;
                    animation-delay: ${Math.random() * 5}s;
                    will-change: transform, opacity;
                `;
                container.appendChild(p);
            }
        }

        /**
         *Раздел
         */
        function initStaggerAnimation() {
            document.querySelectorAll('.stagger-item').forEach((item, i) => {
                item.classList.remove('visible');
                setTimeout(() => item.classList.add('visible'), i * 150);
            });
        }

        // ============================================================
        // ============================================================

        /**
         *Раздел
         */
        function renderHome() {
            if (!dom.albumsGrid || !dom.singlesGrid) return;

            let albumsHtml = '', singlesHtml = '';

            if (dom.homePromo) {
                if (SHOW_NEW_RELEASE_PROMO && releases[NEW_RELEASE_PROMO_ID]) {
                    const promo = releases[NEW_RELEASE_PROMO_ID];
                    dom.homePromo.innerHTML = `
                        <button class="release-card promo-release-card text-left rounded-xl p-5 transition-all group relative w-full" data-id="${NEW_RELEASE_PROMO_ID}" data-fixed-accent="true" onclick="App.openRelease('${NEW_RELEASE_PROMO_ID}')">
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
                                    <p class="text-sm text-[var(--fg-muted)] max-w-2xl leading-relaxed relative z-10">Новый сингл P-Team уже доступен. Перейди к релизу и послушай его первым.</p>
                                    <div class="flex items-center gap-3">
                                        <span class="promo-cta inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs tracking-widest uppercase font-semibold">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M8 5v14l11-7z" />
                                            </svg>
                                            Открыть релиз
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </button>
                    `;
                    const promoCard = dom.homePromo.querySelector('.promo-release-card');
                    if (promoCard) {
                        applyCardAccent(promoCard, promo.cover);
                    }
                } else {
                    dom.homePromo.innerHTML = '';
                }
            }

            Object.entries(releases).forEach(([id, r], index) => {
                const isPriorityCard = index < 6;
                const meta = r.type === 'album' ? `${r.tracks.length} треков` : 'Сингл';
                const card = `
                    <button class="release-card text-left rounded-xl p-4 transition-all group relative" data-id="${id}" onclick="App.openRelease('${id}')">
                        <div class="aspect-square rounded-lg overflow-hidden mb-4 bg-[var(--bg)] shadow-lg">
                            <img src="${r.cover}" alt="${r.title}" class="card-image w-full h-full object-cover" loading="${isPriorityCard ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${index < 4 ? 'high' : 'low'}" onerror="this.style.display='none'">
                        </div>
                        <h3 class="font-semibold text-[var(--fg)] group-hover:text-[var(--card-accent)] transition-colors line-clamp-2 relative z-10">${r.title}</h3>
                        <p class="text-xs text-[var(--fg-muted)] mt-1 relative z-10">${meta} • ${r.year}</p>
                    </button>
                `;
                if (r.type === 'album') albumsHtml += card;
                else singlesHtml += card;
            });

            dom.albumsGrid.innerHTML = albumsHtml;
            dom.singlesGrid.innerHTML = singlesHtml;

            const throttledMove = throttle(moveCardGradient, 16);
            document.querySelectorAll('.release-card').forEach(card => {
                card.addEventListener('mouseenter', async (e) => {
                    card.addEventListener('mousemove', throttledMove);
                    const img = card.querySelector('img');
                    if (img) await applyCardAccent(card, img.src);
                });
                card.addEventListener('mouseleave', () => {
                    card.removeEventListener('mousemove', throttledMove);
                    if (card.dataset.fixedAccent !== 'true') {
                        resetCardAccent(card);
                    }
                });
            });
        }

        function normalizeSearchText(value) {
            return (value || '').toString().toLowerCase().trim();
        }

        function escapeHtml(value) {
            return (value || '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        function setSearchMode(active) {
            return active;
        }

        function toggleSearchPanel(forceState = null) {
            if (!dom.searchPanel) return;
            const shouldOpen = forceState === null
                ? !dom.searchPanel.classList.contains('open')
                : Boolean(forceState);

            dom.searchPanel.classList.toggle('open', shouldOpen);
            if (dom.searchToggle) dom.searchToggle.classList.toggle('active', shouldOpen);
            if (dom.searchBackdrop) dom.searchBackdrop.classList.toggle('open', shouldOpen);
            document.body.classList.toggle('search-open', shouldOpen);

            if (shouldOpen && dom.searchInput) {
                requestAnimationFrame(() => dom.searchInput.focus());
            }
        }

        function renderSearchResults(results, query) {
            if (!dom.searchResults) return;

            const normalized = normalizeSearchText(query);
            if (!normalized) {
                dom.searchResults.innerHTML = '<p class="text-sm text-[var(--fg-muted)]/85">Введите запрос, чтобы искать по релизам, трекам и строкам из текстов.</p>';
                setSearchMode(false);
                return;
            }

            setSearchMode(true);

            if (!results.length) {
                dom.searchResults.innerHTML = '<p class="text-sm text-[var(--fg-muted)]">Ничего не найдено. Попробуйте другой запрос.</p>';
                return;
            }

            const labels = {
                release: 'Альбом/релиз',
                track: 'Трек',
                lyric: 'Строка из текста'
            };

            const html = results.map(item => {
                const badge = labels[item.type] || 'Результат';
                const line = item.line ? `<p class="text-xs text-[var(--fg-muted)]/85 mt-1 line-clamp-2">${escapeHtml(item.line)}</p>` : '';
                const trackTitle = item.trackTitle ? `<p class="text-xs text-[var(--fg-muted)] mt-1">${escapeHtml(item.trackTitle)}</p>` : '';
                return `
                    <button class="w-full text-left rounded-xl border border-white/8 bg-[var(--bg-card)]/55 hover:bg-[var(--bg-card)]/80 transition-colors p-4 mb-2"
                        onclick="App.openSearchResult('${item.type}', '${item.releaseId}', ${item.trackIndex ?? -1}, ${item.time ?? -1})">
                        <div class="flex items-start justify-between gap-4">
                            <div class="min-w-0">
                                <p class="text-sm font-medium text-[var(--fg)] truncate">${escapeHtml(item.title)}</p>
                                ${trackTitle}
                                ${line}
                            </div>
                            <span class="text-[10px] uppercase tracking-wider text-[var(--fg-muted)]/80 flex-shrink-0">${badge}</span>
                        </div>
                    </button>
                `;
            }).join('');

            dom.searchResults.innerHTML = `<div class="pb-2"><p class="text-xs uppercase tracking-widest text-[var(--fg-muted)] mb-3">Результаты: ${results.length}</p>${html}</div>`;
        }

        async function fetchTrackLyrics(release, track) {
            const base = track.lyricsFile.replace(/\.[^/.]+$/, '');
            let txt = '';
            let lrc = '';

            try {
                const txtRes = await fetch(release.lyricsPath + track.lyricsFile);
                if (txtRes.ok) txt = await txtRes.text();
            } catch { }

            try {
                const lrcRes = await fetch(release.lyricsPath + base + '.lrc');
                if (lrcRes.ok) lrc = await lrcRes.text();
            } catch { }

            return { txt, lrc };
        }

        async function ensureLyricsIndex() {
            if (state.lyricsIndexReady) return;
            if (state.lyricsIndexPromise) return state.lyricsIndexPromise;

            state.lyricsIndexPromise = (async () => {
                const entries = [];
                const tasks = [];

                Object.entries(releases).forEach(([releaseId, release]) => {
                    release.tracks.forEach((track, trackIndex) => {
                        tasks.push(async () => {
                            const { txt, lrc } = await fetchTrackLyrics(release, track);
                            if (txt) {
                                txt.split('\n').forEach(line => {
                                    const clean = line.trim();
                                    if (!clean) return;
                                    entries.push({
                                        releaseId,
                                        releaseTitle: release.title,
                                        trackIndex,
                                        trackTitle: track.title,
                                        line: clean,
                                        normalized: normalizeSearchText(clean),
                                        time: -1
                                    });
                                });
                            }

                            if (lrc) {
                                parseLRC(lrc).forEach(item => {
                                    const clean = (item.text || '').trim();
                                    if (!clean) return;
                                    entries.push({
                                        releaseId,
                                        releaseTitle: release.title,
                                        trackIndex,
                                        trackTitle: track.title,
                                        line: clean,
                                        normalized: normalizeSearchText(clean),
                                        time: item.time
                                    });
                                });
                            }
                        });
                    });
                });

                const concurrency = 4;
                let pointer = 0;
                const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
                    while (pointer < tasks.length) {
                        const taskIndex = pointer;
                        pointer += 1;
                        await tasks[taskIndex]();
                    }
                });

                await Promise.all(workers);
                state.lyricsIndex = entries;
                state.lyricsIndexReady = true;
            })();

            try {
                await state.lyricsIndexPromise;
            } finally {
                state.lyricsIndexPromise = null;
            }
        }

        function searchCatalog(query) {
            const normalized = normalizeSearchText(query);
            if (!normalized) return [];

            const cacheKey = `${normalized}|${state.lyricsIndexReady ? 1 : 0}|${state.lyricsIndex.length}`;
            const cached = perf.searchCache.get(cacheKey);
            if (cached) return cached;

            const results = [];

            Object.entries(releases).forEach(([releaseId, release]) => {
                if (normalizeSearchText(release.title).includes(normalized)) {
                    results.push({ type: 'release', releaseId, title: release.title, trackIndex: -1, line: '', time: -1 });
                }

                release.tracks.forEach((track, trackIndex) => {
                    const titleMatch = normalizeSearchText(track.title).includes(normalized);
                    if (titleMatch) {
                        results.push({
                            type: 'track',
                            releaseId,
                            title: release.title,
                            trackTitle: track.title,
                            trackIndex,
                            line: '',
                            time: -1
                        });
                    }
                });
            });

            if (state.lyricsIndexReady) {
                state.lyricsIndex
                    .filter(item => item.normalized.includes(normalized))
                    .slice(0, 20)
                    .forEach(item => {
                        results.push({
                            type: 'lyric',
                            releaseId: item.releaseId,
                            title: item.releaseTitle,
                            trackTitle: item.trackTitle,
                            trackIndex: item.trackIndex,
                            line: item.line,
                            time: item.time
                        });
                    });
            }

            const output = results.slice(0, 28);
            perf.searchCache.set(cacheKey, output);
            if (perf.searchCache.size > 45) {
                const firstKey = perf.searchCache.keys().next().value;
                perf.searchCache.delete(firstKey);
            }

            return output;
        }

        function handleSearchInput(value) {
            const query = normalizeSearchText(value);
            const baseResults = searchCatalog(query);
            renderSearchResults(baseResults, query);

            if (!query || state.lyricsIndexReady || state.lyricsIndexPromise) return;
            ensureLyricsIndex().then(() => {
                perf.searchCache.clear();
                if (!dom.searchInput) return;
                const freshQuery = normalizeSearchText(dom.searchInput.value);
                if (!freshQuery) return;
                renderSearchResults(searchCatalog(freshQuery), freshQuery);
            });
        }

        function initGlobalSearch() {
            if (!dom.searchInput) return;
            const onInput = debounce(e => handleSearchInput(e.target.value), 180);
            dom.searchInput.addEventListener('input', onInput);

            if (dom.searchToggle) {
                dom.searchToggle.addEventListener('click', e => {
                    e.stopPropagation();
                    toggleSearchPanel();
                });
            }

            if (dom.searchPanel) {
                dom.searchPanel.addEventListener('click', e => e.stopPropagation());
            }

            document.addEventListener('click', () => toggleSearchPanel(false));
            renderSearchResults([], '');
        }

        function openSearchResult(type, releaseId, trackIndex, time = -1) {
            if (!releases[releaseId]) return;

            toggleSearchPanel(false);

            openRelease(releaseId);

            if (type === 'release' || trackIndex < 0) return;

            setTimeout(() => {
                playTrack(trackIndex, 'fade');
                if (type === 'lyric') {
                    showLyrics(trackIndex);
                    if (Number.isFinite(time) && time >= 0) {
                        seekTo(time);
                    }
                }
            }, 120);
        }

        /**
         *Раздел
         */
        function moveCardGradient(e) {
            const card = e.currentTarget;
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
            card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
        }

        function getAllTrackRefs() {
            return Object.entries(releases).flatMap(([releaseId, release]) =>
                release.tracks.map((_, trackIndex) => ({ releaseId, trackIndex }))
            );
        }

        function isSameTrackRef(a, b) {
            return Boolean(a && b && a.releaseId === b.releaseId && a.trackIndex === b.trackIndex);
        }

        function pickRandomTrackRef(excludeRef = null) {
            const refs = getAllTrackRefs().filter(ref => !excludeRef || !isSameTrackRef(ref, excludeRef));
            if (!refs.length) return null;
            return refs[Math.floor(Math.random() * refs.length)];
        }

        function updateFlowButtonState() {
            if (dom.flowModeBtn) {
                dom.flowModeBtn.classList.toggle('active', state.flowModeActive);
                dom.flowModeBtn.setAttribute('aria-pressed', String(state.flowModeActive));
                dom.flowModeBtn.setAttribute('aria-label', state.flowModeActive ? 'Остановить поток' : 'Включить поток');
            }
            if (dom.flowModeLabel) {
                dom.flowModeLabel.textContent = state.flowModeActive ? 'Поток' : 'Поток';
            }
        }

        function playTrackByRef(releaseId, trackIndex, direction = 'fade') {
            const release = releases[releaseId];
            if (!release || !release.tracks[trackIndex]) return;
            state.currentRelease = release;
            state.currentReleaseId = releaseId;
            playTrack(trackIndex, direction);
        }

        function startFlowMode() {
            const nextRef = pickRandomTrackRef();
            if (!nextRef) return;
            state.flowModeActive = true;
            updateFlowButtonState();
            playTrackByRef(nextRef.releaseId, nextRef.trackIndex, 'fade');
        }

        function stopFlowMode() {
            state.flowModeActive = false;
            updateFlowButtonState();
        }

        function toggleFlowMode() {
            if (state.flowModeActive) stopFlowMode();
            else startFlowMode();
        }

        function playFlowNext(direction = 'next') {
            const currentRef = state.currentReleaseId !== null
                ? { releaseId: state.currentReleaseId, trackIndex: state.currentTrackIndex }
                : null;
            const nextRef = pickRandomTrackRef(currentRef);
            if (!nextRef) return;
            playTrackByRef(nextRef.releaseId, nextRef.trackIndex, direction);
        }

        async function getReleasePlayCount(releaseId) {
            const release = releases[releaseId];
            if (!release || release.type !== 'album') return 0;
            if (releasePlayCountCache[releaseId] !== undefined) return releasePlayCountCache[releaseId];
            if (!state.db) return 0;

            try {
                const { data, error } = await state.db.from('play_counts').select('track_key, plays');
                if (error) throw error;

                let total = 0;
                (data || []).forEach(item => {
                    const parsed = parseTrackKey(item.track_key);
                    if (!parsed || parsed.releaseId !== releaseId) return;
                    total += Number(item.plays) || 0;
                });

                releasePlayCountCache[releaseId] = total;
                return total;
            } catch (e) {
                console.warn('Release play count load failed:', e);
                return 0;
            }
        }

        /**
         * ?Открыть релиз
         */
        function openRelease(id) {
            const r = releases[id];
            if (!r) return;

            state.currentRelease = r;
            state.currentReleaseId = id;
            state.currentTrackIndex = -1;
            updatePageAccent(r.cover);

            if (dom.releaseCover) {
                dom.releaseCover.innerHTML = `<img src="${r.cover}" alt="${r.title}" class="w-full h-full object-cover" loading="eager" fetchpriority="high" decoding="async" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full bg-[var(--bg-card)] flex items-center justify-center\\'><span class=\\'text-[var(--fg-muted)]\\'>Нет обложки</span></div>'">`;
            }
            if (dom.releaseTitle) dom.releaseTitle.textContent = r.title;
            if (dom.releaseMeta) dom.releaseMeta.textContent = `${r.type === 'album' ? 'Альбом' : 'Сингл'} • ${r.year}`;
            if (dom.releasePlays) {
                dom.releasePlays.classList.toggle('hidden', r.type !== 'album');
                dom.releasePlays.textContent = r.type === 'album' ? 'Счетчик прослушиваний загружается...' : '';
            }

            if (dom.downloadContainer) {
                if (r.lyricsBookPath && dom.downloadBtn) {
                    dom.downloadBtn.href = r.lyricsBookPath;
                    dom.downloadContainer.classList.remove('hidden');
                } else {
                    dom.downloadContainer.classList.add('hidden');
                }
            }

            if (dom.videoContainer) {
                if (r.videoUrl && dom.videoIframe) {
                    dom.videoContainer.classList.remove('hidden');
                    setTimeout(() => dom.videoIframe.src = r.videoUrl, 50);
                } else {
                    if (dom.videoIframe) dom.videoIframe.src = '';
                    dom.videoContainer.classList.add('hidden');
                }
            }

            if (r.type === 'album' && dom.releasePlays) {
                getReleasePlayCount(id).then(total => {
                    if (state.currentReleaseId !== id || !dom.releasePlays) return;
                    dom.releasePlays.textContent = `Прослушиваний альбома: ${total}`;
                });
            }

            renderTracklist();
            showPage('release');
        }

        /**
         *Раздел
         */
        function renderTracklist() {
            if (!dom.tracklist || !state.currentRelease) return;

            dom.tracklist.innerHTML = state.currentRelease.tracks.map((t, i) => `
                <div class="track-row flex items-center gap-5 py-4 px-4 cursor-pointer group" onclick="App.handleTrackClick(${i})">
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
            `).join('');
        }

        // ============================================================
        // ============================================================

        /**
         *Раздел
         */
        function handleTrackClick(index) {
            if (state.currentReleaseId && state.currentTrackIndex === index) {
                togglePlay();
            } else {
                playTrack(index, 'fade');
            }
        }

        /**
         *Раздел
         */
        function playTrack(index, direction = null) {
            if (!state.currentRelease) return;

            state.currentTrackIndex = index;
            state.trackCounted = false;
            state.trackCountPending = false;
            const track = state.currentRelease.tracks[index];
            if (!track) return;

            dom.audio.src = state.currentRelease.audioPath + track.file;
            if (dom.playerTrack) dom.playerTrack.textContent = track.title;

            dom.playerCover.innerHTML = `
                <img src="${state.currentRelease.cover}" class="w-full h-full object-cover" loading="eager" fetchpriority="high" decoding="async" onerror="this.style.display='none'">
                <div class="cover-overlay">
                    <button onclick="event.stopPropagation(); App.openFsPlayer()" class="fullscreen-trigger-btn" aria-label="Открыть на весь экран">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                        </svg>
                    </button>
                </div>
            `;

            setMiniPlayerVisible(true);
            if (dom.lyricsBtn) dom.lyricsBtn.classList.remove('hidden');
            if (dom.lyricsBtnMobile) dom.lyricsBtnMobile.classList.remove('hidden');

            document.querySelectorAll('.track-row').forEach((row, i) => {
                row.classList.toggle('playing', i === index);
                row.classList.remove('paused');
            });

            updateFullscreen(track.title, state.currentRelease.cover, direction);
            updatePlayerAccent(state.currentRelease.cover);
            updatePageAccent(state.currentRelease.cover);
            updateFlowButtonState();

            if (state.currentReleaseId) {
                const nextIndex = (index + 1) % state.currentRelease.tracks.length;
                preloadTrackMetadata(state.currentReleaseId, nextIndex);
            }

            dom.audio.play().then(() => {
                state.isPlaying = true;
                updatePlayPauseIcon();
            }).catch(err => console.log('Play error:', err));

            loadLyrics(index);
        }

        /**
         *Раздел
         */
        function togglePlay() {
            if (dom.audio.paused) {
                dom.audio.play();
                state.isPlaying = true;
                setMiniPlayerVisible(true);
                const rows = document.querySelectorAll('.track-row');
                if (rows[state.currentTrackIndex]) {
                    rows[state.currentTrackIndex].classList.add('playing');
                    rows[state.currentTrackIndex].classList.remove('paused');
                }
            } else {
                dom.audio.pause();
                state.isPlaying = false;
            }
            updatePlayPauseIcon();
        }

        /**
         *Раздел
         */
        function updatePlayPauseIcon() {
            if (dom.iconPlay) dom.iconPlay.classList.toggle('hidden', state.isPlaying);
            if (dom.iconPause) dom.iconPause.classList.toggle('hidden', !state.isPlaying);
            if (dom.playPauseBtn) dom.playPauseBtn.classList.toggle('playing-state', state.isPlaying);
            if (dom.playerCover) dom.playerCover.classList.toggle('playing-glow', state.isPlaying);
            const activeRow = document.querySelector('.track-row.playing');
            if (activeRow) activeRow.classList.toggle('paused', !state.isPlaying);
            updateFsPlayPauseIcon();
        }

        /**
         *Раздел
         */
        function nextTrack() {
            if (state.flowModeActive) {
                playFlowNext('next');
                return;
            }
            if (state.currentRelease) {
                playTrack((state.currentTrackIndex + 1) % state.currentRelease.tracks.length, 'next');
            }
        }

        /**
         *Раздел
         */
        function prevTrack() {
            if (state.currentRelease) {
                playTrack(state.currentTrackIndex === 0 ? state.currentRelease.tracks.length - 1 : state.currentTrackIndex - 1, 'prev');
            }
        }

        /**
         *Раздел
         */
        function seekTrack(e) {
            if (!dom.audio.duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            dom.audio.currentTime = ((e.clientX - rect.left) / rect.width) * dom.audio.duration;
        }

        /**
         *Раздел
         */
        function seekTrackFs(e) {
            if (!dom.audio.duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            dom.audio.currentTime = ((e.clientX - rect.left) / rect.width) * dom.audio.duration;
        }

        // ============================================================
        // ============================================================

        function openFsPlayer() {
            if (dom.fsPlayer) {
                dom.fsPlayer.classList.add('open');
                document.body.style.overflow = 'hidden';
            }
        }

        function closeFsPlayer() {
            if (dom.fsPlayer) {
                dom.fsPlayer.classList.remove('open');
                state.fsLyricsOpen = false;
                dom.fsPlayer.classList.remove('lyrics-open');
                if (dom.fsLyricsToggle) dom.fsLyricsToggle.classList.remove('active');
                document.body.style.overflow = '';
            }
        }

        function updateFullscreen(title, cover, direction) {
            if (dom.fsTitle) dom.fsTitle.textContent = title;
            if (dom.fsBg) dom.fsBg.style.backgroundImage = `url(${cover})`;
            if (dom.fsLyricsTitle) dom.fsLyricsTitle.textContent = title;
            animateCover(cover, direction);
        }

        function animateCover(src, dir) {
            const active = state.currentCoverSlot === 'a' ? dom.fsCoverA : dom.fsCoverB;
            const inactive = state.currentCoverSlot === 'a' ? dom.fsCoverB : dom.fsCoverA;

            if (state.animationInProgress) {
                active.classList.remove('enter-left', 'enter-right');
                active.classList.add('active');
                inactive.classList.remove('active', 'exit-left', 'exit-right');
            }

            state.animationInProgress = true;

            if (!dir) {
                active.src = src;
                active.classList.add('active');
                active.classList.remove('exit-left', 'exit-right', 'enter-left', 'enter-right');
                inactive.classList.remove('active', 'exit-left', 'exit-right');
                state.animationInProgress = false;
                return;
            }

            inactive.src = src;
            const [exitClass, enterClass] = dir === 'next' ? ['exit-left', 'enter-right'] : ['exit-right', 'enter-left'];

            active.classList.remove('playing');
            inactive.classList.remove('playing');
            active.classList.remove('exit-left', 'exit-right', 'enter-left', 'enter-right');
            inactive.classList.remove('active', 'exit-left', 'exit-right', 'enter-left', 'enter-right');
            inactive.classList.add(enterClass);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    active.classList.remove('active');
                    active.classList.add(exitClass);
                    inactive.classList.remove(enterClass);
                    inactive.classList.add('active');
                    state.currentCoverSlot = state.currentCoverSlot === 'a' ? 'b' : 'a';
                    if (state.isPlaying) inactive.classList.add('playing');
                    setTimeout(() => {
                        state.animationInProgress = false;
                        active.classList.remove(exitClass);
                    }, 650);
                });
            });
        }

        function updateFsPlayPauseIcon() {
            if (dom.fsIconPlay) dom.fsIconPlay.style.display = state.isPlaying ? 'none' : 'block';
            if (dom.fsIconPause) dom.fsIconPause.style.display = state.isPlaying ? 'block' : 'none';
            if (dom.fsPlayBtn) dom.fsPlayBtn.classList.toggle('playing', state.isPlaying);
            const active = state.currentCoverSlot === 'a' ? dom.fsCoverA : dom.fsCoverB;
            const inactive = state.currentCoverSlot === 'a' ? dom.fsCoverB : dom.fsCoverA;
            if (active) active.classList.toggle('playing', state.isPlaying);
            if (inactive) inactive.classList.remove('playing');
        }

        function toggleFsLyrics() {
            state.fsLyricsOpen = !state.fsLyricsOpen;
            if (dom.fsPlayer) dom.fsPlayer.classList.toggle('lyrics-open', state.fsLyricsOpen);
            if (dom.fsLyricsToggle) dom.fsLyricsToggle.classList.toggle('active', state.fsLyricsOpen);
        }

        // ============================================================
        // ============================================================

        function setupAudioEvents() {
            dom.audio.addEventListener('timeupdate', () => {
                if (!dom.audio.duration) return;
                const currentTime = dom.audio.currentTime;
                const progress = (currentTime / dom.audio.duration) * 100;
                const roundedProgress = Math.round(progress * 5) / 5;
                if (roundedProgress !== perf.lastProgressPercent) {
                    perf.lastProgressPercent = roundedProgress;
                    if (dom.progress) dom.progress.style.width = roundedProgress + '%';
                    if (dom.fsProgress) dom.fsProgress.style.width = roundedProgress + '%';
                }

                const currentSecond = Math.floor(currentTime);
                if (currentSecond !== perf.lastSecond) {
                    perf.lastSecond = currentSecond;
                    const cur = formatTime(currentTime);
                    if ($('time-current')) $('time-current').textContent = cur;
                    if (dom.fsTimeCurrent) dom.fsTimeCurrent.textContent = cur;
                }

                updateKaraoke();
                const threshold = Math.min(30, Math.max(10, dom.audio.duration * 0.5));
                if (currentTime >= threshold && !state.trackCounted && !state.trackCountPending) {
                    incrementPlayCount();
                }
            });

            dom.audio.addEventListener('loadedmetadata', () => {
                const total = formatTime(dom.audio.duration);
                if ($('time-total')) $('time-total').textContent = total;
                if (dom.fsTimeTotal) dom.fsTimeTotal.textContent = total;
            });

            dom.audio.addEventListener('ended', nextTrack);
        }

        async function incrementPlayCount() {
            if (!state.currentReleaseId || !state.db || state.trackCounted || state.trackCountPending) return;
            state.trackCountPending = true;
            const releaseId = state.currentReleaseId;
            try {
                const { error } = await state.db.rpc('increment_play_count', {
                    track_key_input: `${releaseId}-${state.currentTrackIndex}`
                });
                if (error) throw error;
                state.trackCounted = true;
                delete releasePlayCountCache[releaseId];
                if (state.currentReleaseId === releaseId && state.currentRelease && state.currentRelease.type === 'album' && dom.releasePlays) {
                    dom.releasePlays.textContent = 'Счетчик прослушиваний обновляется...';
                    getReleasePlayCount(releaseId).then(total => {
                        if (state.currentReleaseId === releaseId && dom.releasePlays) {
                            dom.releasePlays.textContent = `Прослушиваний альбома: ${total}`;
                        }
                    });
                }
                if ($('page-chart') && $('page-chart').classList.contains('active')) renderChart();
            } catch (e) {
                console.warn('Play count update failed:', e);
            } finally {
                state.trackCountPending = false;
            }
        }

        async function renderChart() {
            if (!dom.chartList) return;
            if (!state.db) {
                dom.chartList.innerHTML = '<p class="text-center text-[var(--fg-muted)] mt-10">База недоступна.</p>';
                return;
            }
            const { data, error } = await state.db.from('play_counts').select('track_key, plays').order('plays', { ascending: false }).limit(50);
            if (error) {
                dom.chartList.innerHTML = '<p class="text-center text-[var(--fg-muted)] mt-10">Ошибка загрузки.</p>';
                return;
            }
            const tracksMap = new Map();
            (data || []).forEach(item => {
                const parsed = parseTrackKey(item.track_key);
                if (!parsed) return;
                const release = releases[parsed.releaseId];
                const track = release && release.tracks[parsed.trackIndex];
                if (!track) return;

                const aggregateKey = `${parsed.releaseId}::${parsed.trackIndex}`;
                const existing = tracksMap.get(aggregateKey);
                const plays = Number(item.plays) || 0;

                if (existing) {
                    existing.plays += plays;
                } else {
                    tracksMap.set(aggregateKey, {
                        title: track.title,
                        cover: release.cover,
                        plays,
                        releaseId: parsed.releaseId,
                        trackIndex: parsed.trackIndex
                    });
                }
            });

            const tracks = Array.from(tracksMap.values())
                .sort((a, b) => b.plays - a.plays)
                .slice(0, 50);
            dom.chartList.innerHTML = tracks.length === 0
                ? '<p class="text-center text-[var(--fg-muted)] mt-10">Список пуст.</p>'
                : tracks.map((t, i) => `
                    <div class="chart-row cursor-pointer group" onclick="App.playChart('${t.releaseId}', ${t.trackIndex})">
                        <div class="chart-num ${i < 3 ? `top-${i + 1}` : ''}">${i + 1}</div>
                        <div class="chart-cover"><img src="${t.cover}" alt="" loading="${i < 8 ? 'eager' : 'lazy'}" decoding="async" fetchpriority="${i < 3 ? 'high' : 'low'}"></div>
                        <div class="chart-info"><div class="chart-title">${t.title}</div><div class="chart-artist">frnk ness</div></div>
                        <div class="chart-plays"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>${t.plays}</div>
                    </div>
                `).join('');
        }

        function playChart(releaseId, trackIndex) {
            openRelease(releaseId);
            setTimeout(() => playTrack(trackIndex, 'fade'), 100);
        }

        // ============================================================
        // ============================================================

        function updateKaraoke() {
            if (state.lyricsMode !== 'karaoke' || !state.parsedLyrics.length) return;

            const currentTime = dom.audio.currentTime;
            let newIndex = state.currentLyricIndex;

            if (newIndex === -1) {
                for (let i = state.parsedLyrics.length - 1; i >= 0; i--) {
                    if (currentTime >= state.parsedLyrics[i].time) {
                        newIndex = i;
                        break;
                    }
                }
            } else {
                while (newIndex + 1 < state.parsedLyrics.length && currentTime >= state.parsedLyrics[newIndex + 1].time) {
                    newIndex += 1;
                }

                while (newIndex > 0 && currentTime < state.parsedLyrics[newIndex].time) {
                    newIndex -= 1;
                }

                if (currentTime < state.parsedLyrics[0].time) newIndex = -1;
            }

            if (newIndex !== state.currentLyricIndex) {
                const prevIndex = state.currentLyricIndex;
                state.currentLyricIndex = newIndex;
                [
                    { container: dom.lyricsContent, lines: state.lyricsNodes.regular },
                    { container: dom.fsLyricsBody, lines: state.lyricsNodes.fullscreen }
                ].forEach(({ container, lines }) => {
                    if (!container || !lines.length) return;
                    if (prevIndex !== -1 && lines[prevIndex]) {
                        lines[prevIndex].classList.remove('active');
                    }
                    if (newIndex !== -1 && lines[newIndex]) {
                        const active = lines[newIndex];
                        active.classList.add('active');
                        const targetTop = active.offsetTop - (container.clientHeight / 2) + (active.clientHeight / 2);
                        const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
                        const clampedTop = Math.max(0, Math.min(targetTop, maxTop));
                        const distance = Math.abs(container.scrollTop - clampedTop);

                        if (distance > 6) {
                            container.scrollTo({
                                top: clampedTop,
                                behavior: distance > 140 ? 'smooth' : 'auto'
                            });
                        }
                    }
                });
            }
        }

        // ============================================================
        // ============================================================

        function updateLyricsModeControls(hasKaraoke) {
            [dom.lyricsModeSwitch, dom.fsLyricsModeSwitch].forEach(el => {
                if (!el) return;
                el.classList.toggle('hidden', !hasKaraoke);
                el.classList.toggle('flex', hasKaraoke);
            });

            const textActiveClasses = ['bg-white/10', 'text-[var(--fg)]'];
            const textInactiveClasses = ['text-[var(--fg-muted)]'];
            const karaokeActiveClasses = ['bg-white/10', 'text-[var(--fg)]'];
            const karaokeInactiveClasses = ['text-[var(--fg-muted)]'];

            [dom.lyricsModeText, dom.fsLyricsModeText].forEach(btn => {
                if (!btn) return;
                btn.classList.toggle(textActiveClasses[0], state.lyricsMode === 'text');
                btn.classList.toggle(textActiveClasses[1], state.lyricsMode === 'text');
                btn.classList.toggle(textInactiveClasses[0], state.lyricsMode !== 'text');
            });

            [dom.lyricsModeKaraoke, dom.fsLyricsModeKaraoke].forEach(btn => {
                if (!btn) return;
                btn.classList.toggle(karaokeActiveClasses[0], state.lyricsMode === 'karaoke');
                btn.classList.toggle(karaokeActiveClasses[1], state.lyricsMode === 'karaoke');
                btn.classList.toggle(karaokeInactiveClasses[0], state.lyricsMode !== 'karaoke');
            });
        }

        function renderLyricsByMode() {
            const hasKaraoke = state.parsedLyrics.length > 0;
            const plainText = state.currentLyricsPlainText || 'Текст не найден';

            if (hasKaraoke && state.lyricsMode === 'karaoke') {
                const render = l => l.map(x => `<p class="lrc-line" onclick="App.seekTo(${x.time})">${x.text || '...'}</p>`).join('');
                const renderFs = l => l.map(x => `<p class="fs-lrc-line" onclick="App.seekTo(${x.time})">${x.text || '...'}</p>`).join('');
                if (dom.lyricsContent) dom.lyricsContent.innerHTML = render(state.parsedLyrics);
                if (dom.fsLyricsBody) dom.fsLyricsBody.innerHTML = renderFs(state.parsedLyrics);
                state.lyricsNodes.regular = dom.lyricsContent ? Array.from(dom.lyricsContent.querySelectorAll('.lrc-line')) : [];
                state.lyricsNodes.fullscreen = dom.fsLyricsBody ? Array.from(dom.fsLyricsBody.querySelectorAll('.fs-lrc-line')) : [];
                state.currentLyricIndex = -1;
                updateKaraoke();
            } else {
                const html = plainText.split('\n').map(l => `<p class="mb-2">${l || '&nbsp;'}</p>`).join('');
                if (dom.lyricsContent) dom.lyricsContent.innerHTML = html;
                if (dom.fsLyricsBody) dom.fsLyricsBody.innerHTML = html;
                state.lyricsNodes.regular = [];
                state.lyricsNodes.fullscreen = [];
                state.currentLyricIndex = -1;
            }

            updateLyricsModeControls(hasKaraoke);
        }

        function setLyricsMode(mode) {
            if (!['text', 'karaoke'].includes(mode)) return;
            if (mode === 'karaoke' && !state.parsedLyrics.length) return;
            state.lyricsMode = mode;
            state.preferredLyricsMode = mode;
            renderLyricsByMode();
        }

        // ============================================================
        // ============================================================

        function setupVolumeControls() {
            dom.audio.volume = dom.volumeSlider ? parseFloat(dom.volumeSlider.value) : 1;
            updateVolumeIcon(dom.audio.volume);
            [dom.volumeSlider, dom.fsVolumeSlider].forEach(slider => {
                if (!slider) return;
                slider.addEventListener('input', e => {
                    const vol = parseFloat(e.target.value);
                    dom.audio.volume = vol;
                    dom.audio.muted = false;
                    updateVolumeIcon(vol);
                    if (dom.volumeSlider) dom.volumeSlider.value = vol;
                    if (dom.fsVolumeSlider) dom.fsVolumeSlider.value = vol;
                });
            });
        }

        function toggleMute() {
            dom.audio.muted = !dom.audio.muted;
            const vol = dom.audio.muted ? 0 : (dom.audio.volume || 0.5);
            if (dom.volumeSlider) dom.volumeSlider.value = vol;
            if (dom.fsVolumeSlider) dom.fsVolumeSlider.value = vol;
            updateVolumeIcon(vol);
        }

        function updateVolumeIcon(vol) {
            const show1 = vol > 0 && !dom.audio.muted;
            const show2 = vol >= 0.5 && !dom.audio.muted;
            [dom.volWave1, dom.fsVolWave1].forEach(el => { if (el) el.style.opacity = show1 ? '1' : '0'; });
            [dom.volWave2, dom.fsVolWave2].forEach(el => { if (el) el.style.opacity = show2 ? '1' : '0'; });
        }

        // ============================================================
        // ============================================================

        async function loadLyrics(index) {
            if (!state.currentRelease) return;
            const track = state.currentRelease.tracks[index];
            if (!track) return;

            let plainText = 'Текст не найден';
            let lrcText = '';
            const base = track.lyricsFile.replace(/\.[^/.]+$/, "");

            state.currentLyricsTrackIndex = index;
            state.currentLyricIndex = -1;

            try {
                const res = await fetch(state.currentRelease.lyricsPath + base + '.lrc');
                if (res.ok) {
                    lrcText = await res.text();
                }
            } catch { }

            try {
                const res = await fetch(state.currentRelease.lyricsPath + track.lyricsFile);
                if (res.ok) plainText = await res.text();
            } catch { }

            if ($('lyrics-track-title')) $('lyrics-track-title').textContent = track.title;

            state.currentLyricsPlainText = plainText;
            state.currentLyricsLrcRaw = lrcText;
            state.parsedLyrics = lrcText ? parseLRC(lrcText) : [];

            if (state.parsedLyrics.length && state.preferredLyricsMode === 'karaoke') {
                state.lyricsMode = 'karaoke';
            } else {
                state.lyricsMode = 'text';
            }

            renderLyricsByMode();
        }

        function seekTo(time) {
            if (dom.audio.duration) {
                dom.audio.currentTime = time;
                if (!state.isPlaying) togglePlay();
            }
        }

        function showLyrics(index) {
            loadLyrics(index);
            if (dom.lyricsPanel) dom.lyricsPanel.classList.add('open');
        }

        function closeLyrics() {
            if (dom.lyricsPanel) dom.lyricsPanel.classList.remove('open');
        }

        function toggleLyrics() {
            if (dom.lyricsPanel) dom.lyricsPanel.classList.toggle('open');
        }

        // ============================================================
        // ============================================================

        function showPage(name) {
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            const page = $('page-' + name);
            if (page) page.classList.add('active');
            document.body.classList.toggle('release-page', name === 'release');
            window.scrollTo(0, 0);
            if (name === 'home') resetPageAccent();
            if (name === 'home') setTimeout(initStaggerAnimation, 50);
            if (name === 'home' && dom.searchInput) handleSearchInput(dom.searchInput.value);
            if (name === 'chart') renderChart();
            if (name !== 'home') toggleSearchPanel(false);
        }

        function closeMiniPlayer() {
            dom.audio.pause();
            state.isPlaying = false;
            updatePlayPauseIcon();
            setMiniPlayerVisible(false);
            document.querySelectorAll('.track-row.playing').forEach(row => {
                row.classList.remove('playing', 'paused');
            });
        }

        function setMiniPlayerVisible(isVisible) {
            if (!dom.player) return;
            dom.player.classList.toggle('visible', isVisible);
            document.body.classList.toggle('mini-player-visible', isVisible);
        }

        // ============================================================
        // ============================================================

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                if (dom.fsPlayer && dom.fsPlayer.classList.contains('open')) closeFsPlayer();
                else if (dom.searchPanel && dom.searchPanel.classList.contains('open')) toggleSearchPanel(false);
                else closeLyrics();
            }
            if (e.key === ' ' && !['BUTTON', 'INPUT'].includes(document.activeElement.tagName)) {
                e.preventDefault();
                togglePlay();
            }
        });

        // ============================================================
        // ============================================================
        window.App = {
            openRelease,
            handleTrackClick,
            showLyrics,
            setLyricsMode,
            toggleFlowMode,
            startFlowMode,
            stopFlowMode,
            openFsPlayer,
            closeFsPlayer,
            closeLyrics,
            toggleLyrics,
            toggleFsLyrics,
            togglePlay,
            prevTrack,
            nextTrack,
            seekTo,
            seekTrack,
            seekTrackFs,
            showPage,
            playChart,
            openSearchResult,
            toggleSearchPanel,
            toggleMute,
            closeMiniPlayer
        };

        // ============================================================
        // ============================================================

        function init() {
            if (window.ColorThief) {
                state.colorThief = new ColorThief();
            }

            if (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY) {
                state.db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            }

            cacheDomElements();
            renderHome();
            initGlobalSearch();
            updateFlowButtonState();
            initStaggerAnimation();
            setupAudioEvents();
            setupVolumeControls();
            initParticles();
            warmupVisibleReleaseAssets();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }

    })();

}


