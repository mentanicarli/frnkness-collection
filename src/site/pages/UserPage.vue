<template>
  <div class="shell profile-page">
    <p v-if="state === 'loading'" class="acc-hint">Загрузка…</p>
    <p v-else-if="state === 'missing'" class="acc-alert acc-alert-info">Такого пользователя нет.</p>
    <div v-else-if="profile" class="profile-head">
      <UserAvatar :avatar="profile.avatar" :nick="profile.nick" :user-id="profile.id" :size="5.5" :cover-of="coverOf" />
      <div class="min-w-0">
        <h1 class="profile-nick">{{ profile.nick }}</h1>
        <p class="profile-meta">С нами с {{ formatDate(profile.created_at) }}</p>
        <p v-if="profile.bio" class="profile-bio">{{ profile.bio }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Профиль другого пользователя: то, что видно всем вошедшим (раздел 5).
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { releases } from '@/config'
import { supabase } from '@/supabaseClient'
import { session } from '@/site/session'
import UserAvatar from '@/site/components/UserAvatar.vue'

interface PublicProfile { id: string; nick: string; avatar: string; bio: string; created_at: string }

const route = useRoute()
const router = useRouter()
const profile = ref<PublicProfile | null>(null)
const state = ref<'loading' | 'ok' | 'missing'>('loading')
const coverOf = (id: string) => releases[id]?.cover ?? null
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

watch(
  () => String(route.params.id ?? ''),
  async (id) => {
    if (id && id === session.user?.id) return void router.replace({ name: 'me' })
    state.value = 'loading'
    profile.value = null
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      state.value = 'missing'
      return
    }
    const { data } = await supabase.from('profiles').select('id, nick, avatar, bio, created_at').eq('id', id).maybeSingle()
    profile.value = (data as PublicProfile | null) ?? null
    state.value = profile.value ? 'ok' : 'missing'
  },
  { immediate: true }
)
</script>
