<template>
    <div class="adm-top">
        <div class="adm-top-inner">
            <button
                class="adm-menu-btn"
                type="button"
                aria-controls="adm-sidebar"
                :aria-expanded="menuOpen ? 'true' : 'false'"
                :aria-label="menuOpen ? 'Закрыть меню разделов' : 'Открыть меню разделов'"
                data-testid="admin-menu-btn"
                @click="menuOpen = !menuOpen"
            >☰</button>
            <a class="adm-brand" href="#/">frnk ness<small>админка</small></a>
            <div class="adm-user">
                <a class="adm-small adm-faint" href="./">На сайт</a>
                <span class="adm-user-email" data-testid="admin-nick">{{ auth.name.value }}</span>
                <button class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click="auth.signOut()">Выйти</button>
            </div>
        </div>
    </div>
    <div class="adm-layout">
        <div v-if="menuOpen" class="adm-backdrop" data-testid="admin-backdrop" @click="menuOpen = false"></div>
        <aside id="adm-sidebar" class="adm-side" :class="{ open: menuOpen }" data-testid="admin-sidebar">
            <nav aria-label="Разделы">
                <div v-for="group in groups" :key="group.id" class="adm-nav-group" role="group" :aria-label="group.title || undefined">
                    <p v-if="group.title" class="adm-nav-title" aria-hidden="true">{{ group.title }}</p>
                    <a
                        v-for="item in group.items"
                        :key="item.id"
                        class="adm-nav-link"
                        :href="item.id === 'home' ? '#/' : '#/' + item.id"
                        :class="{ active: isActive(route.section.value, item.id) }"
                        :aria-current="isActive(route.section.value, item.id) ? 'page' : undefined"
                        :data-testid="`nav-${item.id}`"
                    >{{ item.label }}<span v-if="item.id === 'feedback' && feedbackNewCount > 0" class="adm-count" data-testid="nav-badge-feedback" :aria-label="`новых: ${feedbackNewCount}`">{{ feedbackNewCount > 99 ? '99+' : feedbackNewCount }}</span></a>
                </div>
            </nav>
        </aside>
        <main class="adm-shell">
            <component :is="current" :key="route.section.value" />
        </main>
    </div>
    <PublishToast />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { useAuth } from './composables/useAuth'
import { useRoute } from './composables/useRoute'
import { isActive, visibleGroups } from './lib/nav'
import HomeView from './views/HomeView.vue'
import PublishToast from './components/PublishToast.vue'
import { feedbackNewCount, startFeedbackBadge, stopFeedbackBadge } from './composables/useFeedbackBadge'

const auth = useAuth()
const route = useRoute()

// «Заявки на восстановление» — только владельцу (база тоже не отдаст их админу).
const groups = computed(() => visibleGroups(auth.isOwner.value))

// На телефоне панель прячется за кнопкой ☰: закрывается выбором раздела,
// нажатием мимо и клавишей Esc.
const menuOpen = ref(false)
watch(() => route.segments.value.join('/'), () => {
    menuOpen.value = false
})
const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') menuOpen.value = false
}
onMounted(() => {
    document.addEventListener('keydown', onKey)
    startFeedbackBadge()
})
onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKey)
    stopFeedbackBadge()
})

const placeholder = defineAsyncComponent(() => import('./views/PlaceholderView.vue'))

// Разделы грузятся по требованию: каждый — отдельный чанк admin-*.
const VIEWS: Record<string, Component> = {
    home: HomeView,
    users: defineAsyncComponent(() => import('./views/UsersView.vue')),
    recovery: defineAsyncComponent(() => import('./views/RecoveryView.vue')),
    stats: defineAsyncComponent(() => import('./views/StatsView.vue')),
    recap: defineAsyncComponent(() => import('./views/RecapView.vue')),
    errors: defineAsyncComponent(() => import('./views/ErrorsView.vue')),
    feedback: defineAsyncComponent(() => import('./views/FeedbackView.vue')),
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
