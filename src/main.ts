import { createApp } from 'vue'
import App from './App.vue'
import './assets/app.css'

import { initLegacyApp } from './legacy/app-core'
import { normalizeInitialHash, router } from './site/router'

normalizeInitialHash()
const app = createApp(App)
app.use(router)
app.mount('#app')

// Сразу после монтирования: страницы рисует Vue, и кнопки на них должны
// работать с первого клика.
initLegacyApp()

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const swUrl = `${import.meta.env.BASE_URL}sw.js`
        navigator.serviceWorker.register(swUrl).catch(() => {
            // Ошибку регистрации игнорируем: в private mode/PWA-ограничениях это допустимо.
        })
    })
}
