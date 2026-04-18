import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/app.css'

// Import legacy app initialization (will be phased out)
import { initLegacyApp } from './legacy/app-core'
import { NEW_RELEASE_PROMO_ID, SHOW_NEW_RELEASE_PROMO, SUPABASE_ANON_KEY, SUPABASE_URL, releases } from './config'
import { DEFAULT_COLOR, runtimeCaches, runtimeState } from './runtime/sharedState'
import { debounce, formatTime, throttle } from './utils/helpers'
import { parseLRC, parseTrackKey } from './utils/lyrics'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')

const legacyDeps = {
    config: {
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        SHOW_NEW_RELEASE_PROMO,
        NEW_RELEASE_PROMO_ID,
        releases
    },
    shared: {
        DEFAULT_COLOR,
        runtimeState,
        runtimeCaches
    },
    utils: {
        debounce,
        formatTime,
        throttle,
        parseLRC,
        parseTrackKey
    }
}

// Initialize legacy app systems
// This will be gradually replaced by Pinia stores and Vue components
if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(() => initLegacyApp(legacyDeps), { timeout: 600 })
} else {
    setTimeout(() => initLegacyApp(legacyDeps), 0)
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const swUrl = `${import.meta.env.BASE_URL}sw.js`
        navigator.serviceWorker.register(swUrl).catch(() => {
            // Ignore registration failures in unsupported/private browsing contexts.
        })
    })
}

