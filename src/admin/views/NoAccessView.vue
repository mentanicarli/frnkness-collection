<template>
    <main class="adm-center">
        <div class="adm-login adm-empty" data-testid="no-access">
            <h2>Нет доступа</h2>
            <p>Аккаунт <b>{{ auth.state.nick || 'без ника' }}</b> не администратор. Админка открыта только админам и владельцу сайта.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap">
                <a class="adm-btn adm-btn-primary" href="./">На сайт</a>
                <LogoutButton button-class="adm-btn" />
            </div>
        </div>
    </main>
</template>

<script setup lang="ts">
import { useAuth } from '../composables/useAuth'
import LogoutButton from '../components/LogoutButton.vue'

const auth = useAuth()
</script>
