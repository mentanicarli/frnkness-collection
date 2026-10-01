import { createApp } from 'vue'
import AdminApp from './AdminApp.vue'
import './admin.css'

document.body.classList.add('adm-body')
createApp(AdminApp).mount('#admin')
