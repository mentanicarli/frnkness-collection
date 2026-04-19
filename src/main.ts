import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createClient } from '@supabase/supabase-js'
import App from './App.vue'
import './assets/app.css'

// Точка входа приложения.
// Сейчас проект работает в гибридном режиме: Vue + legacy runtime.
import { initLegacyApp } from './legacy/app-core'
import { NEW_RELEASE_PROMO_ID, SHOW_NEW_RELEASE_PROMO, SUPABASE_ANON_KEY, SUPABASE_URL, releases } from './config'
import { DEFAULT_COLOR, runtimeCaches, runtimeState } from './runtime/sharedState'
import { debounce, formatTime, throttle } from './utils/helpers'
import { parseLRC, parseTrackKey } from './utils/lyrics'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')

// Явно передаем зависимости в legacy-слой,
// чтобы уменьшить скрытые связи через глобальную область.
const legacyDeps = {
    config: {
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        createSupabaseClient: createClient,
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

// Инициализируем legacy-рантайм после маунта Vue.
// Это позволяет сохранить текущее поведение во время поэтапной миграции.
if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(() => initLegacyApp(legacyDeps), { timeout: 600 })
} else {
    setTimeout(() => initLegacyApp(legacyDeps), 0)
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // BASE_URL обязателен для корректной работы на GitHub Pages project path.
        const swUrl = `${import.meta.env.BASE_URL}sw.js`
        navigator.serviceWorker.register(swUrl).catch(() => {
            // Ошибку регистрации игнорируем: в private mode/PWA-ограничениях это допустимо.
        })
    })
}

