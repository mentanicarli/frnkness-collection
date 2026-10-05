import { createApp } from 'vue'
import App from './App.vue'
import './assets/app.css'

import { initLegacyApp } from './legacy/app-core'
import { ANNOUNCE, PROMO_RELEASE_ID, SHOW_NEW_RELEASE_PROMO, SUPABASE_ANON_KEY, SUPABASE_URL, releases } from './config'
import { runtimeCaches, runtimeState } from './runtime/sharedState'
import { normalizeInitialHash, router } from './site/router'
import { buildAssetUrl, debounce, escapeHtml, formatTime, normalizeSearchText, throttle } from './utils/helpers'
import { getAllTrackRefs, isSameTrackRef, parseLRC, parseTrackKey, pickRandomTrackRef } from './utils/lyrics'
import { buildTrackHash, findTrackRefBySlug, getTrackSlug } from './utils/slug'
import { createMatcher, normalizeForSearch } from './utils/search'
import { fetchTextFile } from './utils/textFiles'
import { buildNoteMap, renderAboutHtml, renderLyricsHtml } from './utils/trackNotes'
import { renderPromoCardHtml } from './utils/promoCard'
import { setupMediaSession } from './runtime/mediaSession'
import { createListenSender, setupListenTracker } from './runtime/listenTracker'
import { isAnnounceActive, renderAnnounceCardHtml, startAnnounceCountdown } from './utils/announceCard'

normalizeInitialHash()
const app = createApp(App)
app.use(router)
app.mount('#app')

const legacyDeps = {
    config: {
        PROMO_RELEASE_ID,
        SHOW_NEW_RELEASE_PROMO,
        ANNOUNCE,
        releases
    },
    shared: {
        runtimeState,
        runtimeCaches
    },
    utils: {
        buildAssetUrl,
        buildNoteMap,
        buildTrackHash,
        createMatcher,
        debounce,
        escapeHtml,
        fetchTextFile,
        findTrackRefBySlug,
        formatTime,
        getAllTrackRefs,
        getTrackSlug,
        isSameTrackRef,
        normalizeForSearch,
        normalizeSearchText,
        parseLRC,
        parseTrackKey,
        pickRandomTrackRef,
        renderAboutHtml,
        renderLyricsHtml,
        renderPromoCardHtml,
        renderAnnounceCardHtml,
        isAnnounceActive,
        startAnnounceCountdown,
        setupMediaSession,
        setupListenTracker,
        sendListenSession: createListenSender(SUPABASE_URL, SUPABASE_ANON_KEY),
        throttle
    }
}

// Сразу после монтирования: страницы рисует Vue, и кнопки на них должны
// работать с первого клика.
initLegacyApp(legacyDeps)

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const swUrl = `${import.meta.env.BASE_URL}sw.js`
        navigator.serviceWorker.register(swUrl).catch(() => {
            // Ошибку регистрации игнорируем: в private mode/PWA-ограничениях это допустимо.
        })
    })
}
