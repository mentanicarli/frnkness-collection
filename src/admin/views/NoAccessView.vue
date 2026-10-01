<template>
    <main class="adm-center">
        <div class="adm-login adm-empty">
            <h2>Нет доступа</h2>
            <p>Аккаунт {{ auth.email.value }} не является администратором.</p>
            <button class="adm-btn" type="button" @click="auth.signOut()">Выйти</button>
        </div>
    </main>
</template>

<script setup lang="ts">
import { useAuth } from '../composables/useAuth'

const auth = useAuth()
</script>
