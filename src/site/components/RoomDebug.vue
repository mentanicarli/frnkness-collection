<template>
  <section class="settings-section room-debug" aria-labelledby="room-debug" data-testid="room-debug">
    <h2 id="room-debug">Синхронизация</h2>
    <dl class="room-debug-grid">
      <dt>Сдвиг часов</dt>
      <dd data-testid="debug-offset">{{ signed(debug.offsetMs) }} мс</dd>
      <dt>Задержка сети (туда-обратно)</dt>
      <dd data-testid="debug-rtt">{{ Math.round(debug.rttMs) }} мс</dd>
      <template v-if="!host">
        <dt>Расхождение с хозяином</dt>
        <dd data-testid="debug-drift">{{ debug.driftMs === null ? '—' : signed(debug.driftMs) + ' мс' }}</dd>
        <dt>Скорость звука</dt>
        <dd data-testid="debug-rate">{{ debug.rate.toFixed(2) }}×</dd>
        <dt>Доставка команды</dt>
        <dd data-testid="debug-net">{{ debug.netMs === null ? '—' : signed(debug.netMs) + ' мс' }}</dd>
        <dt>Опоздание старта</dt>
        <dd data-testid="debug-late">{{ debug.startLateMs === null ? '—' : debug.startLateMs + ' мс' }}</dd>
      </template>
      <dt>Номер команды</dt>
      <dd data-testid="debug-seq">{{ debug.seq }}</dd>
    </dl>
    <p class="acc-hint">«+» — гость впереди хозяина, «−» — позади. Видно только владельцу сайта и по ссылке с ?debug.</p>
  </section>
</template>

<script setup lang="ts">
// Отладочная панель комнаты: цифры синхронизации (см. SyncDebug в rooms/store.ts).
import type { SyncDebug } from '../rooms/store'

defineProps<{ debug: SyncDebug; host: boolean }>()

const signed = (n: number): string => `${n > 0 ? '+' : ''}${Math.round(n)}`
</script>
