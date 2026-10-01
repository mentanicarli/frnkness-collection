<template>
    <div v-if="item" class="adm-toast" role="status" data-testid="publish-status">
        <span class="adm-dot" :class="dotClass"></span>
        <div style="flex: 1; min-width: 0">
            <div>{{ label }}</div>
            <div class="adm-faint adm-small" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ item.message }}</div>
            <a v-if="item.url && (item.state === 'failed' || item.state === 'unknown')" :href="item.url" target="_blank" rel="noopener">
                Открыть запуск в GitHub Actions
            </a>
        </div>
        <button v-if="item.state !== 'pending'" class="adm-btn adm-btn-ghost adm-btn-sm" type="button" aria-label="Скрыть" @click="item.dismissed = true">×</button>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePublish } from '../composables/usePublish'

const publish = usePublish()
const item = computed(() => [...publish.state.items].reverse().find((i) => !i.dismissed) ?? null)

const LABELS = {
    pending: 'Публикуется… (1–2 минуты)',
    published: 'Опубликовано — изменения на сайте',
    failed: 'Ошибка сборки — сайт остался прежним',
    cancelled: 'Сборка отменена: опубликуется следующая версия',
    unknown: 'Не дождались статуса сборки — проверь GitHub Actions'
}

const label = computed(() => (item.value ? LABELS[item.value.state] : ''))
const dotClass = computed(() => {
    const s = item.value?.state
    return {
        'adm-dot-ok': s === 'published',
        'adm-dot-err': s === 'failed',
        'adm-dot-warn': s === 'cancelled' || s === 'unknown',
        'adm-dot-pulse': s === 'pending'
    }
})
</script>
