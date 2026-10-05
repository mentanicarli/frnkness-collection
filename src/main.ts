import { createApp } from 'vue'
import App from './App.vue'
import './assets/app.css'

import { normalizeInitialHash, router } from './site/router'

normalizeInitialHash()
createApp(App).use(router).mount('#app')

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const swUrl = `${import.meta.env.BASE_URL}sw.js`
        navigator.serviceWorker.register(swUrl).catch(() => {
            // Ошибку регистрации игнорируем: в private mode/PWA-ограничениях это допустимо.
        })
    })
}
