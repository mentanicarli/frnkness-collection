<template>
    <div class="adm-top">
        <div class="adm-top-inner">
            <a class="adm-brand" href="#/">frnk ness<small>админка</small></a>
            <nav class="adm-nav" aria-label="Разделы">
                <a v-for="item in nav" :key="item.id" :href="item.id === 'home' ? '#/' : '#/' + item.id"
                   :class="{ active: route.section.value === item.id }">{{ item.label }}</a>
            </nav>
            <div class="adm-user">
                <a class="adm-small adm-faint" href="./">На сайт</a>
                <span class="adm-user-email" data-testid="admin-nick">{{ auth.name.value }}</span>
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
    { id: 'users', label: 'Пользователи' },
    { id: 'recovery', label: 'Заявки', ownerOnly: true },
    { id: 'stats', label: 'Статистика' },
    { id: 'lyrics', label: 'Тексты' },
    { id: 'lrc', label: 'Караоке' },
    { id: 'promo', label: 'Промо' },
    { id: 'catalog', label: 'Каталог' },
    { id: 'releases', label: 'Релизы' },
    { id: 'history', label: 'История' },
    { id: 'new-release', label: 'Новый релиз' }
] as { id: string; label: string; ownerOnly?: boolean }[]

// «Заявки на восстановление» — только владельцу (база тоже не отдаст их админу).
const nav = computed(() => NAV.filter((item) => !item.ownerOnly || auth.isOwner.value))

const placeholder = defineAsyncComponent(() => import('./views/PlaceholderView.vue'))

// Разделы грузятся по требованию: каждый — отдельный чанк admin-*.
const VIEWS: Record<string, Component> = {
    home: HomeView,
    users: defineAsyncComponent(() => import('./views/UsersView.vue')),
    recovery: defineAsyncComponent(() => import('./views/RecoveryView.vue')),
    stats: defineAsyncComponent(() => import('./views/StatsView.vue')),
    lyrics: defineAsyncComponent(() => import('./views/LyricsView.vue')),
    lrc: defineAsyncComponent(() => import('./views/LrcView.vue')),
    promo: defineAsyncComponent(() => import('./views/PromoView.vue')),
    catalog: defineAsyncComponent(() => import('./views/CatalogView.vue')),
    releases: defineAsyncComponent(() => import('./views/ReleasesView.vue')),
    history: defineAsyncComponent(() => import('./views/HistoryView.vue')),
    'new-release': defineAsyncComponent(() => import('./views/NewReleaseView.vue'))
}

const current = computed(() => VIEWS[route.section.value] || placeholder)
</script>
