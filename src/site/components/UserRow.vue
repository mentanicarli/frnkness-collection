<template>
  <li class="user-row" data-testid="user-row">
    <RouterLink class="user-row-main" :to="{ name: 'user', params: { nick: user.nick } }">
      <UserAvatar :avatar="user.avatar" :nick="user.nick" :user-id="user.id" :size="2.5" :cover-of="coverOf" />
      <span class="min-w-0">
        <span class="user-row-nick">{{ user.nick }}</span>
        <span v-if="sub" class="user-row-sub">{{ sub }}</span>
      </span>
    </RouterLink>
    <span class="user-row-actions"><slot /></span>
  </li>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { releases } from '@/config'
import type { Profile } from '../social/api'
import UserAvatar from './UserAvatar.vue'

defineProps<{ user: Profile; sub?: string }>()
const coverOf = (id: string) => releases[id]?.cover ?? null
</script>
