<template>
  <div v-if="roomUi.createOpen" class="cropper-backdrop" @click.self="close">
    <div class="cropper-box" role="dialog" aria-modal="true" aria-labelledby="create-room-title" data-testid="create-room" @keydown.esc="close">
      <p id="create-room-title" class="acc-title" style="font-size: 1.125rem;">Создать комнату</p>
      <p class="acc-sub" style="margin-bottom: 0.875rem;">Всё, что ты включишь в плеере, будет играть у тех, кто зайдёт по ссылке.</p>
      <form class="acc-form" @submit.prevent="create">
        <label class="acc-label" for="create-room-name">Название</label>
        <input id="create-room-name" ref="input" v-model="title" class="acc-input" :maxlength="ROOM_TITLE_MAX" :placeholder="placeholder" autocomplete="off" data-testid="create-room-name">
        <p class="acc-hint">До {{ ROOM_TITLE_MAX }} символов. Не больше {{ ROOM_CAPACITY }} человек в комнате.</p>
        <p v-if="error" class="acc-alert acc-alert-error" role="alert" data-testid="create-room-error">{{ error }}</p>
        <div class="acc-actions" style="justify-content: flex-end; margin-top: 0.5rem;">
          <button class="acc-btn acc-btn-sm" type="button" @click="close">Отмена</button>
          <button class="acc-btn acc-btn-primary acc-btn-sm" type="submit" :disabled="busy" data-testid="create-room-submit">Создать</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
// «Создать комнату»: название (можно пустым — будет «Комната <ник>»).
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { session } from '../session'
import { errorText } from '../social/api'
import { room, roomUi, rooms } from '../rooms'
import { ROOM_CAPACITY, ROOM_TITLE_MAX } from '../rooms/sync'

const router = useRouter()
const title = ref('')
const busy = ref(false)
const error = ref('')
const input = ref<HTMLInputElement | null>(null)
const placeholder = computed(() => `Комната ${session.user?.nick ?? ''}`.slice(0, ROOM_TITLE_MAX))

function close() {
  roomUi.createOpen = false
}

watch(
  () => roomUi.createOpen,
  (open) => {
    if (!open) return
    title.value = ''
    error.value = ''
    // Уже есть своя комната — вести в неё, а не создавать вторую.
    if (room.roomId && room.isOwner) {
      close()
      void router.push({ name: 'room', params: { id: room.roomId } })
      return
    }
    void nextTick(() => input.value?.focus())
  }
)

async function create() {
  busy.value = true
  error.value = ''
  try {
    const view = await rooms.create(title.value)
    close()
    void router.push({ name: 'room', params: { id: view.id } })
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
</script>
