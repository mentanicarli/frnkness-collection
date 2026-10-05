<template>
    <div class="adm-card adm-player" :class="{ 'is-sticky': sticky }" :style="sticky ? { top: `${stickyTop}px` } : undefined" data-testid="player">
        <audio
            :ref="(el) => (player.audio.value = el as HTMLAudioElement | null)"
            :src="src"
            preload="auto"
            data-testid="audio"
            @loadedmetadata="player.on.loadedmetadata"
            @play="player.on.play"
            @pause="player.on.pause"
            @ended="player.on.ended"
            @error="player.on.error"
            @timeupdate="player.on.timeupdate"
            @seeked="player.on.timeupdate"
        ></audio>
        <div v-if="player.error.value" class="adm-alert adm-alert-error">Не удалось загрузить аудио {{ path }}</div>
        <div class="adm-row adm-player-controls">
            <button
                class="adm-btn adm-btn-primary adm-player-play"
                type="button"
                :aria-label="player.playing.value ? 'Пауза' : 'Играть'"
                @click="player.togglePlay"
            >
                {{ player.playing.value ? 'Пауза' : 'Играть' }}
            </button>
            <button class="adm-btn" type="button" aria-label="Назад 3 секунды" @click="player.seekBy(-3)">−3 с</button>
            <button class="adm-btn" type="button" aria-label="Вперёд 3 секунды" @click="player.seekBy(3)">+3 с</button>
            <span class="adm-spacer"></span>
            <div class="adm-segmented adm-segmented-sm" role="group" aria-label="Скорость">
                <button
                    v-for="r in [0.75, 1]"
                    :key="r"
                    type="button"
                    :class="{ active: player.rate.value === r }"
                    :aria-pressed="player.rate.value === r"
                    @click="player.setRate(r)"
                >{{ r }}×</button>
            </div>
        </div>
        <div class="adm-player-seekrow">
            <input
                class="adm-lrc-seek"
                type="range"
                min="0"
                :max="player.duration.value || 0"
                step="0.01"
                :value="player.currentTime.value"
                aria-label="Позиция"
                @input="player.seekTo(Number(($event.target as HTMLInputElement).value))"
            />
            <span class="adm-mono adm-lrc-time" data-testid="time">{{ formatLrcTime(player.currentTime.value) }} / {{ formatLrcTime(player.duration.value) }}</span>
        </div>
        <slot></slot>
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AudioPlayer } from '../composables/useAudioPlayer'
import { formatLrcTime } from '../lib/lrc'

const props = defineProps<{
    player: AudioPlayer
    /** URL аудио — тот же путь, что на сайте. */
    src: string
    /** Путь в репозитории — для сообщения об ошибке. */
    path: string
    /** Закрепить под шапкой админки при прокрутке. */
    sticky?: boolean
}>()

// Сменился трек — плеер останавливается и переключается на новый.
watch(
    () => props.src,
    () => props.player.reset()
)

// Закреплённый плеер встаёт под шапку; её высота на телефоне меняется
// (навигация переносится на вторую строку), поэтому меряем.
const stickyTop = ref(0)
let observer: ResizeObserver | null = null
onMounted(() => {
    if (!props.sticky) return
    const top = document.querySelector<HTMLElement>('.adm-top')
    if (!top) return
    const measure = () => (stickyTop.value = Math.round(top.getBoundingClientRect().height))
    measure()
    observer = new ResizeObserver(measure)
    observer.observe(top)
})
onBeforeUnmount(() => {
    observer?.disconnect()
    props.player.reset()
})
</script>
