import { createApp } from 'vue'
import ColorThief from 'colorthief'
import App from './App.vue'
import './assets/app.css'

import { initLegacyApp } from './legacy/app-core'
import { PROMO_RELEASE_ID, SHOW_NEW_RELEASE_PROMO, SUPABASE_ANON_KEY, SUPABASE_URL, releases } from './config'
import { DEFAULT_COLOR, runtimeCaches, runtimeState } from './runtime/sharedState'
import { buildAssetUrl, debounce, escapeHtml, formatTime, normalizeSearchText, throttle } from './utils/helpers'
import { getAllTrackRefs, isSameTrackRef, parseLRC, parseTrackKey, pickRandomTrackRef } from './utils/lyrics'

const app = createApp(App)
app.mount('#app')

// Supabase-клиент нужен только чарту и счётчику прослушиваний, а весит
// заметно больше остального кода. Поэтому он не входит в основной бандл:
// чанк подтягивается при первом реальном обращении к статистике.
const createSupabaseClient = async (url: string, key: string) => {
    const { createClient } = await import('@supabase/supabase-js')
    return createClient(url, key)
}

// Инициализируем ColorThief из npm и кладём в runtimeState,
// чтобы legacy-код мог использовать его без зависимости от window.ColorThief.
runtimeState.colorThief = new ColorThief()

const legacyDeps = {
    config: {
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        createSupabaseClient,
        PROMO_RELEASE_ID,
        SHOW_NEW_RELEASE_PROMO,
        LYRICS_INDEX_URL: `${import.meta.env.BASE_URL}lyrics-index.json`,
        releases
    },
    shared: {
        DEFAULT_COLOR,
        runtimeState,
        runtimeCaches
    },
    utils: {
        buildAssetUrl,
        debounce,
        escapeHtml,
        formatTime,
        getAllTrackRefs,
        isSameTrackRef,
        normalizeSearchText,
        parseLRC,
        parseTrackKey,
        pickRandomTrackRef,
        throttle
    }
}

if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(() => initLegacyApp(legacyDeps), { timeout: 600 })
} else {
    setTimeout(() => initLegacyApp(legacyDeps), 0)
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const swUrl = `${import.meta.env.BASE_URL}sw.js`
        navigator.serviceWorker.register(swUrl).catch(() => {
            // Ошибку регистрации игнорируем: в private mode/PWA-ограничениях это допустимо.
        })
    })
}
