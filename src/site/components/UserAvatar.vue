<template>
  <span
    class="avatar"
    :style="{ width: `${size}rem`, height: `${size}rem`, fontSize: `${size * 0.42}rem`, background: view.kind === 'img' ? undefined : view.bg }"
    role="img"
    :aria-label="nick ? `Аватар ${nick}` : 'Аватар'"
  >
    <img v-if="view.kind === 'img' && !broken" :src="view.src" alt="" loading="lazy" decoding="async" @error="broken = true">
    <template v-else-if="view.kind === 'emoji'">{{ view.text }}</template>
    <template v-else>{{ initials }}</template>
  </span>
</template>

<script setup lang="ts">
// Аватар пользователя. Ник выводится только текстом (экранирование Vue).
import { computed, ref, watch } from 'vue'
import { avatarView, initialsOf } from '@/site/auth/avatars'

const props = withDefaults(
  defineProps<{
    avatar?: string | null
    nick?: string
    userId?: string
    size?: number
    coverOf?: (releaseId: string) => string | null
  }>(),
  { avatar: null, nick: '', userId: '', size: 2.25, coverOf: undefined }
)

const broken = ref(false)
const view = computed(() => avatarView(props.avatar, props.nick, props.userId, props.coverOf))
const initials = computed(() => initialsOf(props.nick))
watch(() => props.avatar, () => { broken.value = false })
</script>
