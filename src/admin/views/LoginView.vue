<template>
    <main class="adm-center">
        <div class="adm-login">
            <span class="adm-brand">frnk ness<small>админка</small></span>
            <p class="adm-sub">Вход тем же ником и паролем, что на сайте. Админка открыта только админам и владельцу.</p>
            <div v-if="auth.state.notice" class="adm-alert adm-alert-warn" style="margin-top: 1rem" role="status">
                {{ auth.state.notice }}
            </div>
            <form @submit.prevent="submit" novalidate>
                <label class="adm-field">
                    <span class="adm-label">Ник</span>
                    <input v-model="nick" class="adm-input" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="40" required />
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
            <p class="adm-small adm-faint" style="margin-top: 1rem"><a href="./#/forgot">Забыли пароль?</a></p>
        </div>
    </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth'

const auth = useAuth()
const nick = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
    error.value = ''
    if (!nick.value.trim() || !password.value) {
        error.value = 'Введи ник и пароль'
        return
    }
    busy.value = true
    try {
        const message = await auth.signIn(nick.value, password.value)
        if (message) error.value = message
        else password.value = ''
    } finally {
        busy.value = false
    }
}
</script>
