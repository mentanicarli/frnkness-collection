<template>
    <div class="adm-top">
        <div class="adm-top-inner">
            <a class="adm-brand" href="#/">frnk ness<small>админка</small></a>
            <nav class="adm-nav" aria-label="Разделы">
                <a v-for="item in NAV" :key="item.id" :href="item.id === 'home' ? '#/' : '#/' + item.id"
                   :class="{ active: route.section.value === item.id }">{{ item.label }}</a>
            </nav>
            <div class="adm-user">
                <span class="adm-user-email">{{ auth.email.value }}</span>
                <button class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click="auth.signOut()">Выйти</button>
            </div>
        </div>
    </div>
    <main class="adm-shell">
        <component :is="current" :key="route.section.value" />
    </main>
    <PublishToast />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, type Component } from 'vue'
import { useAuth } from './composables/useAuth'
import { useRoute } from './composables/useRoute'
import HomeView from './views/HomeView.vue'
import PublishToast from './components/PublishToast.vue'

const auth = useAuth()
const route = useRoute()

const NAV = [
    { id: 'home', label: 'Обзор' },
    { id: 'stats', label: 'Статистика' },
    { id: 'lyrics', label: 'Тексты' },
    { id: 'lrc', label: 'Караоке' },
    { id: 'promo', label: 'Промо' },
    { id: 'catalog', label: 'Каталог' },
    { id: 'new-release', label: 'Новый релиз' }
] as const

const placeholder = defineAsyncComponent(() => import('./views/PlaceholderView.vue'))

// Разделы грузятся по требованию: каждый — отдельный чанк admin-*.
const VIEWS: Record<string, Component> = {
    home: HomeView,
    stats: defineAsyncComponent(() => import('./views/StatsView.vue')),
    lyrics: defineAsyncComponent(() => import('./views/LyricsView.vue')),
    lrc: defineAsyncComponent(() => import('./views/LrcView.vue')),
    promo: defineAsyncComponent(() => import('./views/PromoView.vue')),
    catalog: defineAsyncComponent(() => import('./views/CatalogView.vue'))
}

const current = computed(() => VIEWS[route.section.value] || placeholder)
</script>
