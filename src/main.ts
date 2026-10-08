import { createApp } from 'vue'
import App from './App.vue'
import './assets/app.css'
import './assets/account.css'
import './assets/social.css'

import { normalizeInitialHash, router } from './site/router'
import { initSession } from './site/session'
import { describeError, installErrorLogging } from './site/errorLog'

installErrorLogging()
normalizeInitialHash()
// Проверка входа начинается сразу; роутер ждёт её перед первым экраном.
void initSession()
const app = createApp(App)
// В продакшене Vue гасит ошибки компонентов в консоль и до window.onerror они не доходят.
app.config.errorHandler = (err) => {
    installErrorLogging().report(describeError(err))
    console.error(err)
}
app.use(router).mount('#app')

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const swUrl = `${import.meta.env.BASE_URL}sw.js`
        navigator.serviceWorker.register(swUrl).catch(() => {
            // Ошибку регистрации игнорируем: в private mode/PWA-ограничениях это допустимо.
        })
    })
}
