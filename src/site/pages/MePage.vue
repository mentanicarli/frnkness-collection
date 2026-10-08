<template>
  <div class="shell profile-page" v-if="me">
    <div class="profile-head">
      <UserAvatar :avatar="me.avatar" :nick="me.nick" :user-id="me.id" :size="5.5" :cover-of="coverOf" />
      <div class="min-w-0">
        <h1 class="profile-nick">{{ me.nick || 'Без ника' }}</h1>
        <p class="profile-meta">С нами с {{ formatDate(me.createdAt) }}<template v-if="friendsCount !== null"> · {{ friendsCount }} {{ plural(friendsCount, 'друг', 'друга', 'друзей') }}</template><template v-if="me.role !== 'user'"> · {{ me.role === 'owner' ? 'владелец' : 'админ' }}</template></p>
        <RouterLink v-if="me.nick" class="acc-link" :to="{ name: 'user', params: { nick: me.nick } }">Мой профиль — как его видят другие</RouterLink>
        <p v-if="me.bio" class="profile-bio">{{ me.bio }}</p>
      </div>
    </div>

    <!-- Аватар -->
    <section class="settings-section" aria-labelledby="s-avatar">
      <h2 id="s-avatar">Аватар</h2>
      <p class="acc-label" style="margin-bottom: 0.5rem;">Инициалы</p>
      <div class="avatar-grid">
        <button v-for="(_, i) in INITIALS_COLORS" :key="`i${i}`" class="avatar-option" type="button" :aria-pressed="me.avatar === `initials:${i}`" :aria-label="`Инициалы, цвет ${i + 1}`" @click="pick(`initials:${i}`)">
          <UserAvatar :avatar="`initials:${i}`" :nick="me.nick" :size="2.5" />
        </button>
      </div>
      <p class="acc-label" style="margin-bottom: 0.5rem;">Эмодзи</p>
      <div class="avatar-grid">
        <button v-for="(e, i) in EMOJIS" :key="`e${i}`" class="avatar-option" type="button" :aria-pressed="me.avatar === `emoji:${i}`" :aria-label="`Эмодзи ${e}`" @click="pick(`emoji:${i}`)">
          <UserAvatar :avatar="`emoji:${i}`" :nick="me.nick" :size="2.5" />
        </button>
      </div>
      <p class="acc-label" style="margin-bottom: 0.5rem;">Обложки релизов</p>
      <div class="avatar-grid">
        <button v-for="c in covers" :key="c.id" class="avatar-option" type="button" :aria-pressed="me.avatar === `cover:${c.id}`" :aria-label="`Обложка «${c.title}»`" @click="pick(`cover:${c.id}`)">
          <UserAvatar :avatar="`cover:${c.id}`" :nick="me.nick" :size="2.5" :cover-of="coverOf" />
        </button>
      </div>
      <div class="acc-actions" style="margin-top: 0.5rem;">
        <label class="acc-btn acc-btn-sm" style="cursor: pointer;">
          Своя картинка…
          <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" data-testid="avatar-file" @change="onFile">
        </label>
      </div>
      <p class="acc-hint" style="margin-top: 0.5rem;">jpg, png или webp до 5 МБ. Картинку можно обрезать, на сайт она уходит уменьшенной до 256×256.</p>
      <p v-if="avatarMsg" class="acc-alert" :class="avatarMsgOk ? 'acc-alert-ok' : 'acc-alert-error'" style="margin-top: 0.75rem;" role="status">{{ avatarMsg }}</p>
    </section>

    <!-- О себе -->
    <section class="settings-section" aria-labelledby="s-bio">
      <h2 id="s-bio">О себе</h2>
      <form class="acc-form" @submit.prevent="saveBio">
        <textarea v-model="bio" class="acc-textarea" maxlength="200" name="bio" aria-labelledby="s-bio"></textarea>
        <div class="flex items-center justify-between gap-3">
          <span class="acc-hint">{{ [...bio].length }} / {{ BIO_MAX }}</span>
          <button class="acc-btn acc-btn-sm" type="submit" :disabled="bioBusy || bio === me.bio">Сохранить</button>
        </div>
        <p v-if="bioMsg" class="acc-alert" :class="bioMsgOk ? 'acc-alert-ok' : 'acc-alert-error'" role="status">{{ bioMsg }}</p>
      </form>
    </section>

    <!-- Ник -->
    <section class="settings-section" aria-labelledby="s-nick">
      <h2 id="s-nick">Ник</h2>
      <p v-if="nickLockedUntil" class="acc-hint" style="margin-bottom: 0.75rem;">Ник можно менять раз в {{ NICK_CHANGE_INTERVAL_DAYS }} дней. Следующий раз — {{ formatDate(nickLockedUntil.toISOString()) }}.</p>
      <form class="acc-form" novalidate @submit.prevent="saveNick">
        <input v-model="nick" class="acc-input" name="nick" maxlength="20" autocapitalize="off" spellcheck="false" :disabled="Boolean(nickLockedUntil)" aria-labelledby="s-nick">
        <p class="acc-hint">Входить нужно будет с новым ником. Менять можно раз в {{ NICK_CHANGE_INTERVAL_DAYS }} дней.</p>
        <div><button class="acc-btn acc-btn-sm" type="submit" :disabled="nickBusy || Boolean(nickLockedUntil) || nick === me.nick">Сменить ник</button></div>
        <p v-if="nickMsg" class="acc-alert" :class="nickMsgOk ? 'acc-alert-ok' : 'acc-alert-error'" role="status">{{ nickMsg }}</p>
      </form>
    </section>

    <!-- Пароль -->
    <section class="settings-section" aria-labelledby="s-pass">
      <h2 id="s-pass">Пароль</h2>
      <form class="acc-form" novalidate @submit.prevent="savePassword">
        <input class="sr-only" type="text" name="username" autocomplete="username" :value="me.nick" readonly tabindex="-1" aria-hidden="true">
        <label class="acc-field">
          <span class="acc-label">Текущий пароль</span>
          <input v-model="pass.current" class="acc-input" type="password" name="current-password" autocomplete="current-password">
        </label>
        <label class="acc-field">
          <span class="acc-label">Новый пароль</span>
          <input v-model="pass.next" class="acc-input" type="password" name="new-password" autocomplete="new-password">
        </label>
        <label class="acc-field">
          <span class="acc-label">Повтор нового пароля</span>
          <input v-model="pass.repeat" class="acc-input" type="password" name="new-password-repeat" autocomplete="new-password">
        </label>
        <div><button class="acc-btn acc-btn-sm" type="submit" :disabled="passBusy">Сменить пароль</button></div>
        <p v-if="passMsg" class="acc-alert" :class="passMsgOk ? 'acc-alert-ok' : 'acc-alert-error'" role="status">{{ passMsg }}</p>
      </form>
    </section>

    <!-- Лента друзей -->
    <section class="settings-section" aria-labelledby="s-feed">
      <h2 id="s-feed">Лента друзей</h2>
      <label class="acc-check">
        <input type="checkbox" name="hide-listens" :checked="hideListens === true" :disabled="hideListens === null || hideBusy" data-testid="feed-hide-listens" @change="toggleHideListens">
        <span>Не показывать мои прослушивания в ленте</span>
      </label>
      <p class="acc-hint" style="margin-top: 0.5rem;">Скрываются только прослушивания. Избранное, новые публичные плейлисты, топ-4 и комнаты друзья по-прежнему увидят.</p>
      <p v-if="feedMsg" class="acc-alert acc-alert-error" style="margin-top: 0.75rem;" role="status" data-testid="feed-pref-error">{{ feedMsg }}</p>
    </section>

    <!-- Выход и удаление -->
    <section class="settings-section" aria-labelledby="s-exit">
      <h2 id="s-exit">Аккаунт</h2>
      <div class="acc-actions" style="margin-bottom: 1.25rem;">
        <button class="acc-btn acc-btn-sm" type="button" @click="logout">Выйти на этом устройстве</button>
        <RouterLink class="acc-btn acc-btn-sm" :to="{ name: 'privacy' }">Какие данные мы храним</RouterLink>
      </div>
      <template v-if="me.role !== 'owner'">
        <button v-if="!deleteOpen" class="acc-btn acc-btn-danger acc-btn-sm" type="button" @click="deleteOpen = true">Удалить аккаунт…</button>
        <form v-else class="acc-form" novalidate @submit.prevent="deleteAccount">
          <p class="acc-alert acc-alert-error">Удалятся профиль, аватар и всё личное. Прослушивания останутся в общих цифрах, но без привязки к тебе. Отменить нельзя.</p>
          <label class="acc-field">
            <span class="acc-label">Пароль для подтверждения</span>
            <input v-model="deletePassword" class="acc-input" type="password" name="delete-password" autocomplete="current-password">
          </label>
          <div class="acc-actions">
            <button class="acc-btn acc-btn-sm" type="button" @click="deleteOpen = false">Отмена</button>
            <button class="acc-btn acc-btn-danger acc-btn-sm" type="submit" :disabled="deleteBusy">Удалить навсегда</button>
          </div>
          <p v-if="deleteMsg" class="acc-alert acc-alert-error" role="alert">{{ deleteMsg }}</p>
        </form>
      </template>
      <p v-else class="acc-hint">Аккаунт владельца удалить нельзя.</p>
    </section>

    <AvatarCropper v-if="cropImage" :image="cropImage" :busy="avatarBusy" :error="avatarMsgOk ? '' : avatarMsg" @cancel="closeCropper" @save="uploadAvatar" />
  </div>
</template>

<script setup lang="ts">
// Настройки профиля (раздел 5 плана). Избранное, плейлисты, топ и
// друзья — на странице пользователя (#/u/<ник>) и своих страницах.
import { computed, reactive, ref, watch } from 'vue'
import { api, errorText } from '@/site/social/api'
import { plural } from '@/site/social/format'
import { RouterLink, useRouter } from 'vue-router'
import { releases } from '@/config'
import { supabase } from '@/supabaseClient'
import { callFunction, refreshAccount, session, signOut, updateOwnProfile } from '@/site/session'
import { EMOJIS, INITIALS_COLORS, checkAvatarSource } from '@/site/auth/avatars'
import UserAvatar from '@/site/components/UserAvatar.vue'
import AvatarCropper from '@/site/components/AvatarCropper.vue'
import { BIO_MAX, NICK_CHANGE_INTERVAL_DAYS, cleanBio, nextNickChangeAt, validateBio, validateNick, validatePassword } from '../../../supabase/functions/_shared/accounts.ts'

const router = useRouter()
const me = computed(() => session.user)

// Число друзей — то же, что видят все вошедшие на странице профиля.
const friendsCount = ref<number | null>(null)
watch(
  () => me.value?.nick,
  (nick) => {
    if (!nick) return
    void api.profileByNick(nick).then((p) => { friendsCount.value = p ? p.friends_count : null }).catch(() => undefined)
  },
  { immediate: true }
)

// Лента друзей: «Не показывать мои прослушивания» (по умолчанию выключено).
// null — настройка ещё грузится. Переключатель меняется сразу; не сохранилось — возвращаем.
const hideListens = ref<boolean | null>(null)
const hideBusy = ref(false)
const feedMsg = ref('')
void api.feedPrefsGet().then((p) => { hideListens.value = Boolean(p?.hide_listens) }).catch(() => { hideListens.value = false })

async function toggleHideListens(e: Event) {
  const input = e.target as HTMLInputElement
  const want = input.checked
  const before = hideListens.value
  hideListens.value = want
  hideBusy.value = true
  feedMsg.value = ''
  try {
    const saved = await api.feedPrefsSet(want)
    hideListens.value = Boolean(saved?.hide_listens)
  } catch (err) {
    hideListens.value = before
    input.checked = before === true
    feedMsg.value = errorText(err)
  } finally {
    hideBusy.value = false
  }
}

const coverOf = (id: string) => releases[id]?.cover ?? null
const covers = Object.entries(releases)
  .filter(([, r]) => !r.upcoming)
  .map(([id, r]) => ({ id, title: r.title }))

const formatDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── Аватар ──
const avatarMsg = ref('')
const avatarMsgOk = ref(false)
const avatarBusy = ref(false)
const cropImage = ref<HTMLImageElement | null>(null)
let cropUrl = ''

function say(ok: boolean, text: string) {
  avatarMsgOk.value = ok
  avatarMsg.value = text
}

async function pick(value: string) {
  if (!me.value || me.value.avatar === value) return
  const hadUpload = me.value.avatar.startsWith('upload:')
  const error = await updateOwnProfile({ avatar: value })
  if (error) return say(false, error)
  say(true, 'Аватар обновлён')
  // Своя картинка больше не нужна — удаляем из хранилища.
  if (hadUpload) await supabase.storage.from('avatars').remove([`${me.value.id}/avatar`]).catch(() => undefined)
}

function closeCropper() {
  cropImage.value = null
  if (cropUrl) URL.revokeObjectURL(cropUrl)
  cropUrl = ''
}

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const problem = checkAvatarSource(file)
  if (problem) return say(false, problem)
  say(true, '')
  cropUrl = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    cropImage.value = img
  }
  img.onerror = () => {
    closeCropper()
    say(false, 'Не получилось открыть картинку')
  }
  img.src = cropUrl
}

async function uploadAvatar(blob: Blob) {
  if (!me.value) return
  avatarBusy.value = true
  try {
    // Один файл на пользователя: замена перезаписывает старую картинку.
    const { error } = await supabase.storage.from('avatars').upload(`${me.value.id}/avatar`, blob, {
      upsert: true,
      contentType: blob.type,
      cacheControl: '3600'
    })
    if (error) return say(false, 'Не удалось загрузить картинку — попробуй ещё раз')
    const profileError = await updateOwnProfile({ avatar: `upload:${Date.now()}` })
    if (profileError) return say(false, profileError)
    closeCropper()
    say(true, 'Аватар обновлён')
  } finally {
    avatarBusy.value = false
  }
}

// ── О себе ──
const bio = ref(me.value?.bio ?? '')
const bioBusy = ref(false)
const bioMsg = ref('')
const bioMsgOk = ref(false)
watch(() => me.value?.bio, (v) => { if (v !== undefined && !bioBusy.value) bio.value = v })

async function saveBio() {
  const value = cleanBio(bio.value)
  const problem = validateBio(value)
  bioMsgOk.value = !problem
  bioMsg.value = problem ?? ''
  if (problem) return
  bioBusy.value = true
  try {
    const error = await updateOwnProfile({ bio: value })
    bioMsgOk.value = !error
    bioMsg.value = error ?? 'Сохранено'
    if (!error) bio.value = value
  } finally {
    bioBusy.value = false
  }
}

// ── Ник ──
const nick = ref(me.value?.nick ?? '')
const nickBusy = ref(false)
const nickMsg = ref('')
const nickMsgOk = ref(false)
watch(() => me.value?.nick, (v) => { if (v !== undefined) nick.value = v })
const nickLockedUntil = computed(() => {
  const next = nextNickChangeAt(session.nickChangedAt)
  return next && next.getTime() > Date.now() ? next : null
})

async function saveNick() {
  const problem = validateNick(nick.value)
  nickMsgOk.value = false
  nickMsg.value = problem ?? ''
  if (problem) return
  nickBusy.value = true
  try {
    const res = await callFunction<{ nick: string }>('account', { action: 'change-nick', nick: nick.value })
    if (!res.ok) {
      nickMsg.value = res.error ?? 'Не удалось сменить ник'
      return
    }
    await refreshAccount()
    nickMsgOk.value = true
    nickMsg.value = `Готово. Теперь входи с ником «${res.data?.nick ?? nick.value}».`
  } finally {
    nickBusy.value = false
  }
}

// ── Пароль ──
const pass = reactive({ current: '', next: '', repeat: '' })
const passBusy = ref(false)
const passMsg = ref('')
const passMsgOk = ref(false)

async function savePassword() {
  passMsgOk.value = false
  passMsg.value = !pass.current
    ? 'Введи текущий пароль'
    : validatePassword(pass.next, me.value?.nick ?? '') ?? (pass.next !== pass.repeat ? 'Пароли не совпадают' : '')
  if (passMsg.value) return
  passBusy.value = true
  try {
    const res = await callFunction('account', { action: 'change-password', current: pass.current, password: pass.next })
    if (!res.ok) {
      passMsg.value = res.error ?? 'Не удалось сменить пароль'
      return
    }
    pass.current = pass.next = pass.repeat = ''
    passMsgOk.value = true
    passMsg.value = 'Пароль изменён'
  } finally {
    passBusy.value = false
  }
}

// ── Выход и удаление ──
async function logout() {
  await signOut()
  void router.replace({ name: 'welcome' })
}

const deleteOpen = ref(false)
const deletePassword = ref('')
const deleteBusy = ref(false)
const deleteMsg = ref('')

async function deleteAccount() {
  deleteMsg.value = deletePassword.value ? '' : 'Введи пароль'
  if (deleteMsg.value) return
  deleteBusy.value = true
  try {
    const res = await callFunction('account', { action: 'delete-account', password: deletePassword.value })
    if (!res.ok) {
      deleteMsg.value = res.error ?? 'Не удалось удалить аккаунт'
      return
    }
    await signOut()
    void router.replace({ name: 'welcome' })
  } finally {
    deleteBusy.value = false
  }
}
</script>
