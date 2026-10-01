<template>
    <div class="adm-chart" :class="{ 'is-busy': busy }">
        <div ref="wrap" class="adm-chart-plot" :style="{ height: HEIGHT + 'px' }" @mouseleave="active = -1">
            <svg
                v-if="width > 0"
                :width="width"
                :height="HEIGHT"
                :viewBox="`0 0 ${width} ${HEIGHT}`"
                role="img"
                :aria-label="ariaLabel"
                tabindex="0"
                @keydown="onKey"
                @blur="active = -1"
            >
                <g class="adm-chart-grid">
                    <template v-for="t in ticks" :key="t">
                        <line :x1="PAD_L" :x2="width - PAD_R" :y1="yOf(t)" :y2="yOf(t)" />
                        <text :x="PAD_L - 6" :y="yOf(t)" text-anchor="end" dominant-baseline="middle">{{ t }}</text>
                    </template>
                </g>
                <g>
                    <path
                        v-for="(p, i) in points"
                        :key="p.key"
                        :d="barPath(barX(i), yOf(p.value), barW, plotBottom - yOf(p.value))"
                        class="adm-chart-bar"
                        :class="{ 'is-active': i === active, 'is-dim': active >= 0 && i !== active }"
                    />
                </g>
                <g class="adm-chart-x">
                    <text
                        v-for="(p, i) in points"
                        v-show="i % every === 0"
                        :key="p.key"
                        :x="PAD_L + band * i + band / 2"
                        :y="HEIGHT - 6"
                        text-anchor="middle"
                        :class="{ 'is-active': i === active }"
                    >{{ p.label }}</text>
                </g>
                <!-- Зоны наведения шире столбцов: на всю полосу и высоту. -->
                <g>
                    <rect
                        v-for="(p, i) in points"
                        :key="p.key"
                        :x="PAD_L + band * i"
                        :y="PAD_T"
                        :width="band"
                        :height="plotBottom - PAD_T"
                        fill="transparent"
                        @mouseenter="active = i"
                        @click="active = i"
                    />
                </g>
            </svg>
            <div v-if="allZero && !busy" class="adm-chart-empty">{{ emptyText }}</div>
            <div
                v-if="active >= 0 && points[active]"
                class="adm-chart-tip"
                role="status"
                :style="tipStyle"
            >
                <div class="adm-chart-tip-title">{{ points[active].title }}</div>
                <div><b>{{ points[active].value }}</b> {{ unit(points[active].value) }}</div>
            </div>
        </div>
        <details class="adm-chart-table">
            <summary>Таблица</summary>
            <table class="adm-table">
                <thead><tr><th>{{ columnLabel }}</th><th class="num">Прослушивания</th></tr></thead>
                <tbody>
                    <tr v-for="p in points" :key="p.key"><td>{{ p.title }}</td><td class="num">{{ p.value }}</td></tr>
                </tbody>
            </table>
        </details>
    </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { barPath, labelEvery, yTicks } from '../lib/chartScale'
import { pluralPlays } from '../lib/format'

export interface BarPoint {
    key: string
    /** Подпись под столбцом. */
    label: string
    /** Заголовок подсказки и строка таблицы. */
    title: string
    value: number
}

const props = withDefaults(
    defineProps<{
        points: BarPoint[]
        ariaLabel: string
        columnLabel?: string
        emptyText?: string
        busy?: boolean
    }>(),
    { columnLabel: 'День', emptyText: 'Нет прослушиваний за этот период', busy: false }
)

const HEIGHT = 208
const PAD_L = 36
const PAD_R = 8
const PAD_T = 10
const AXIS_H = 24
const MAX_BAR = 24
const GAP = 2

const wrap = ref<HTMLElement | null>(null)
const width = ref(0)
const active = ref(-1)
let observer: ResizeObserver | null = null

onMounted(() => {
    const el = wrap.value
    if (!el) return
    width.value = el.clientWidth
    observer = new ResizeObserver(() => {
        width.value = el.clientWidth
    })
    observer.observe(el)
})
onBeforeUnmount(() => observer?.disconnect())

const plotBottom = HEIGHT - AXIS_H
const maxValue = computed(() => Math.max(0, ...props.points.map((p) => p.value)))
const ticks = computed(() => yTicks(maxValue.value))
const top = computed(() => ticks.value[ticks.value.length - 1] || 1)
const band = computed(() => (props.points.length ? (width.value - PAD_L - PAD_R) / props.points.length : 0))
// Столбец не толще 24px и с зазором 2px до соседа.
const barW = computed(() => Math.max(1, Math.min(MAX_BAR, band.value - GAP)))
const every = computed(() => labelEvery(band.value))
const allZero = computed(() => maxValue.value === 0)

function yOf(value: number) {
    return plotBottom - (value / top.value) * (plotBottom - PAD_T)
}
function barX(i: number) {
    return PAD_L + band.value * i + (band.value - barW.value) / 2
}

const tipStyle = computed(() => {
    const p = props.points[active.value]
    if (!p) return {}
    const x = PAD_L + band.value * active.value + band.value / 2
    const y = Math.min(yOf(p.value), plotBottom - 8)
    // Подсказка не вылезает за края графика.
    const left = Math.min(Math.max(x, 70), width.value - 70)
    return { left: `${left}px`, top: `${y}px` }
})

function onKey(e: KeyboardEvent) {
    const n = props.points.length
    if (!n) return
    if (e.key === 'ArrowRight') active.value = active.value < 0 ? 0 : Math.min(n - 1, active.value + 1)
    else if (e.key === 'ArrowLeft') active.value = active.value < 0 ? n - 1 : Math.max(0, active.value - 1)
    else if (e.key === 'Home') active.value = 0
    else if (e.key === 'End') active.value = n - 1
    else if (e.key === 'Escape') active.value = -1
    else return
    e.preventDefault()
}

const unit = pluralPlays
</script>
