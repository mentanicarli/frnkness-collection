import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './assets/app.css'

// Import legacy app initialization (will be phased out)
import { initLegacyApp } from './legacy/app-core'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')

// Initialize legacy app systems
// This will be gradually replaced by Pinia stores and Vue components
initLegacyApp()
