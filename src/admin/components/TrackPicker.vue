<template>
    <div class="adm-picker">
        <label class="adm-field">
            <span class="adm-label">Релиз</span>
            <select class="adm-select" :value="releaseId" aria-label="Релиз" @change="onRelease(($event.target as HTMLSelectElement).value)">
                <option value="" disabled>Выбери релиз</option>
                <option v-for="(r, id) in releases" :key="id" :value="id">{{ r.title }}</option>
            </select>
        </label>
        <label class="adm-field">
            <span class="adm-label">Трек</span>
            <select
                class="adm-select"
                :value="trackIndex"
                aria-label="Трек"
                :disabled="!release"
                @change="emit('select', releaseId, Number(($event.target as HTMLSelectElement).value))"
            >
                <option :value="-1" disabled>Выбери трек</option>
                <option v-for="(t, i) in release?.tracks ?? []" :key="i" :value="i">
                    {{ String(t.num).padStart(2, '0') }} · {{ t.title }}{{ marker ? marker(release!, i) : '' }}
                </option>
            </select>
        </label>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Release, Releases } from '@/types'

const props = defineProps<{
    releases: Releases
    releaseId: string
    trackIndex: number
    /** Пометка у трека в списке (например, «— нет текста»). */
    marker?: (release: Release, index: number) => string
}>()

const emit = defineEmits<{ select: [releaseId: string, trackIndex: number] }>()

const release = computed(() => props.releases[props.releaseId] || null)

function onRelease(id: string) {
    // У сингла один трек — открываем сразу.
    emit('select', id, props.releases[id]?.tracks.length === 1 ? 0 : -1)
}
</script>
