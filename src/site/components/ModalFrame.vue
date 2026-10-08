<template>
  <!-- В body: внутри страницы окно оказалось бы под мини-плеером. -->
  <Teleport to="body">
    <Transition name="sheet">
      <div v-if="open" :class="sheet ? 'sheet-backdrop' : 'cropper-backdrop'" data-testid="modal-backdrop" @click.self="emit('close')">
        <div
          ref="panel"
          :class="[sheet ? 'sheet' : 'cropper-box', 'modal-panel', { 'sheet-wide': wide }, boxClass]"
          :role="alert ? 'alertdialog' : 'dialog'"
          aria-modal="true"
          :aria-label="label"
          :data-testid="testid"
          tabindex="-1"
          @touchstart.passive="onTouchStart"
          @touchmove="onTouchMove"
          @touchend="onTouchEnd"
          @touchcancel="onTouchEnd"
        >
          <div v-if="sheet" class="sheet-grip" aria-hidden="true"></div>
          <button v-if="closeButton" class="modal-x" type="button" aria-label="Закрыть окно" data-testid="modal-x" @click="emit('close')">✕</button>
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// Окно или нижняя панель. Родитель держит `open` и слушает `close`: все окна сайта
// закрываются одинаково (фон, крестик, Esc, свайп вниз у нижней панели).
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { isBottomSheetLayout, pushDismiss, swipeBlocked, swipeShouldClose, SWIPE_START_PX } from '../composables/dismiss'

const props = withDefaults(defineProps<{ open: boolean; label: string; sheet?: boolean; wide?: boolean; alert?: boolean; closeButton?: boolean; testid?: string; boxClass?: string }>(), { closeButton: true })
const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)
let release: (() => void) | null = null
let opener: HTMLElement | null = null

watch(
  () => props.open,
  (open) => {
    release?.()
    release = null
    if (open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      release = pushDismiss(() => emit('close'))
      // Поле внутри окна могло взять фокус само; иначе фокус — на окно.
      void nextTick(() => {
        if (panel.value && !panel.value.contains(document.activeElement)) panel.value.focus({ preventScroll: true })
      })
    } else {
      opener?.focus?.({ preventScroll: true })
      opener = null
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => release?.())

// ── Свайп вниз (только нижняя панель на телефоне) ──
let startY = 0
let startAt = 0
let dragging = false
let tracking = false

function onTouchStart(e: TouchEvent) {
  tracking = false
  dragging = false
  if (!props.sheet || !panel.value || e.touches.length !== 1 || !isBottomSheetLayout()) return
  if (swipeBlocked(e.target, panel.value)) return
  startY = e.touches[0].clientY
  startAt = Date.now()
  tracking = true
}

function onTouchMove(e: TouchEvent) {
  if (!tracking || !panel.value) return
  const dy = e.touches[0].clientY - startY
  if (!dragging) {
    if (dy < -SWIPE_START_PX) tracking = false
    else if (dy > SWIPE_START_PX) dragging = true
    else return
  }
  if (e.cancelable) e.preventDefault()
  panel.value.style.transition = 'none'
  panel.value.style.transform = `translateY(${Math.max(0, dy)}px)`
}

function onTouchEnd(e: TouchEvent) {
  const el = panel.value
  const wasDragging = dragging
  tracking = false
  dragging = false
  if (!el || !wasDragging) return
  const dy = (e.changedTouches[0]?.clientY ?? startY) - startY
  const close = e.type !== 'touchcancel' && swipeShouldClose(dy, Date.now() - startAt)
  el.style.transition = ''
  if (close) emit('close')
  // Не закрылось — возвращаем на место; закрылось — уезжает вниз по CSS.
  el.style.transform = ''
}
</script>
