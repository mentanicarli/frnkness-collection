<template>
    <main class="adm-center">
        <div class="adm-login">
            <span class="adm-brand">frnk ness<small>админка</small></span>
            <p class="adm-sub">Вход только для администратора.</p>
            <div v-if="auth.state.notice" class="adm-alert adm-alert-warn" style="margin-top: 1rem" role="status">
                {{ auth.state.notice }}
            </div>
            <form @submit.prevent="submit" novalidate>
                <label class="adm-field">
                    <span class="adm-label">Email</span>
                    <input v-model.trim="email" class="adm-input" type="email" name="email" autocomplete="username" required />
                </label>
                <label class="adm-field">
                    <span class="adm-label">Пароль</span>
                    <input v-model="password" class="adm-input" type="password" name="password" autocomplete="current-password" required />
                </label>
                <div v-if="error" class="adm-alert adm-alert-error" role="alert">{{ error }}</div>
                <button class="adm-btn adm-btn-primary" type="submit" :disabled="busy">
                    <span v-if="busy" class="adm-spinner"></span>
                    Войти
                </button>
            </form>
        </div>
    </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth'

const auth = useAuth()
const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
    error.value = ''
    if (!email.value || !password.value) {
        error.value = 'Введи email и пароль'
        return
    }
    busy.value = true
    try {
        const message = await auth.signIn(email.value, password.value)
        if (message) error.value = message
        else password.value = ''
    } finally {
        busy.value = false
    }
}
</script>
