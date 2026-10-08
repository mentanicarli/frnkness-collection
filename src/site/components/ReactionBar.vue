<template>
  <section class="rx" aria-labelledby="room-react" data-testid="room-reactions">
    <h2 id="room-react" class="sr-only">Реакции</h2>
    <div class="rx-wrap">
      <!-- Летящие эмодзи: украшение, скринридеру не читаем (иначе поток реакций превратится в шум). -->
      <div class="rx-layer" aria-hidden="true" data-testid="rx-layer">
        <span v-for="r in room.reactions" :key="r.id" class="rx-item" :style="{ left: `${6 + r.lane * 80}%` }" data-testid="rx-item">
          <span class="rx-emoji">{{ r.emoji }}</span>
          <span class="rx-nick">{{ r.nick }}</span>
        </span>
      </div>
      <div class="rx-bar" role="group" aria-label="Реакции">
        <button
          v-for="emoji in REACTION_EMOJIS"
          :key="emoji"
          class="rx-btn"
          type="button"
          :disabled="!room.reactionsReady"
          :aria-label="`Реакция ${emoji}`"
          data-testid="rx-btn"
          @click="rooms.react(emoji)"
        >{{ emoji }}</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// Ряд реакций под плеером комнаты. Нажимает любой участник; эмодзи всплывает
// у всех с ником отправителя. Ничего не сохраняется. Лишние нажатия
// (больше 2 в секунду, больше 15 на экране) молча игнорирует контроллер.
import { room, rooms } from '../rooms'
import { REACTION_EMOJIS } from '../rooms/reactions'
</script>
