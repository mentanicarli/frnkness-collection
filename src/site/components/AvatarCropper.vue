<template>
  <!-- В body: внутри страницы окно оказалось бы под мини-плеером. -->
  <Teleport to="body">
  <div class="cropper-backdrop" role="dialog" aria-modal="true" :aria-label="round ? 'Обрезка аватара' : 'Обрезка обложки'" @keydown.esc="$emit('cancel')">
    <div class="cropper-box">
      <p class="acc-title" style="font-size: 1.125rem;">{{ title }}</p>
      <p class="acc-sub" style="margin-bottom: 0.875rem;">{{ round ? 'Перетащи картинку и выбери масштаб — в аватар попадёт круг.' : 'Перетащи картинку и выбери масштаб — попадёт квадрат.' }}</p>
      <div
        class="cropper-view"
        :class="{ square: !round }"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @wheel.prevent="onWheel"
      >
        <canvas ref="canvas" :width="PREVIEW" :height="PREVIEW"></canvas>
      </div>
      <input v-model.number="zoom" class="cropper-zoom" type="range" min="1" max="4" step="0.01" aria-label="Масштаб">
      <div v-if="error" class="acc-alert acc-alert-error" role="alert" style="margin-bottom: 0.75rem;">{{ error }}</div>
      <div class="acc-actions" style="justify-content: flex-end;">
        <button class="acc-btn acc-btn-sm" type="button" @click="$emit('cancel')">Отмена</button>
        <button class="acc-btn acc-btn-primary acc-btn-sm" type="button" :disabled="busy" @click="save">
          <span v-if="busy" class="acc-spinner"></span>
          Сохранить
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
// Обрезка в квадрат и сжатие в браузере: на сервер уходит size×size
// (аватар — 256, обложка плейлиста — 512; webp, если браузер умеет,
// иначе jpeg) — десятки килобайт.
import { onMounted, ref, watch } from 'vue'
import { AVATAR_SIZE, cropRect } from '@/site/auth/avatars'

const props = withDefaults(
  defineProps<{ image: HTMLImageElement; busy?: boolean; error?: string; size?: number; title?: string; round?: boolean }>(),
  { busy: false, error: '', size: AVATAR_SIZE, title: 'Аватар', round: true }
)
const emit = defineEmits<{ cancel: []; save: [blob: Blob] }>()

const PREVIEW = 512
const canvas = ref<HTMLCanvasElement | null>(null)
const zoom = ref(1)
const offset = { x: 0, y: 0 }
let drag: { x: number; y: number; ox: number; oy: number } | null = null

function draw(target: HTMLCanvasElement, size: number) {
  const ctx = target.getContext('2d')
  if (!ctx) return
  const { naturalWidth: w, naturalHeight: h } = props.image
  const r = cropRect(w, h, zoom.value, offset.x, offset.y)
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, size, size)
  ctx.drawImage(props.image, r.sx, r.sy, r.side, r.side, 0, 0, size, size)
}

const redraw = () => canvas.value && draw(canvas.value, PREVIEW)
onMounted(redraw)
watch(zoom, redraw)

function onDown(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  drag = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
}
function onMove(e: PointerEvent) {
  if (!drag) return
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const { naturalWidth: w, naturalHeight: h } = props.image
  const side = Math.min(w, h) / zoom.value
  // Пиксель экрана → доля свободного хода картинки.
  const toFraction = (delta: number, full: number) => {
    const free = (full - side) / 2
    return free > 0 ? (-delta * (side / box.width)) / free : 0
  }
  offset.x = Math.max(-1, Math.min(1, drag.ox + toFraction(e.clientX - drag.x, w)))
  offset.y = Math.max(-1, Math.min(1, drag.oy + toFraction(e.clientY - drag.y, h)))
  redraw()
}
function onUp() {
  drag = null
}
function onWheel(e: WheelEvent) {
  zoom.value = Math.max(1, Math.min(4, zoom.value * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))
}

function toBlob(c: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, type, quality))
}

async function save() {
  const out = document.createElement('canvas')
  out.width = props.size
  out.height = props.size
  draw(out, props.size)
  let blob = await toBlob(out, 'image/webp', 0.85)
  // Старый Safari вместо webp отдаёт png — тогда jpeg.
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(out, 'image/jpeg', 0.88)
  if (blob) emit('save', blob)
}
</script>
