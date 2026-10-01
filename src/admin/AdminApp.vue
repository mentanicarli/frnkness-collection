<template>
    <div v-if="!auth.state.ready" class="adm-center"><span class="adm-spinner" aria-label="Загрузка"></span></div>
    <LoginView v-else-if="!auth.state.session" />
    <NoAccessView v-else-if="!auth.isAdmin.value" />
    <AdminLayout v-else />
</template>

<script setup lang="ts">
import { useAuth } from './composables/useAuth'
import LoginView from './views/LoginView.vue'
import NoAccessView from './views/NoAccessView.vue'
import AdminLayout from './AdminLayout.vue'

const auth = useAuth()
</script>
