<template>
  <div
    ref="root"
    class="rs"
    :class="{ 'rs-embedded': embedded }"
    role="dialog"
    aria-modal="true"
    :aria-label="`Итоги ${recap.year}`"
    tabindex="-1"
    data-testid="recap-story"
    @keydown="onRootKey"
  >
    <div class="rs-progress" aria-hidden="true">
      <span v-for="(c, i) in cards" :key="i" class="rs-seg" :class="{ done: i < index, now: i === index }"><i></i></span>
    </div>
    <button class="rs-close" type="button" aria-label="Закрыть" data-no-nav data-testid="recap-close" @click="emit('close')">×</button>

    <div
      class="rs-stage"
      @pointerdown="onDown"
      @pointerup="onUp"
      @pointercancel="start = null"
    >
      <Transition :name="dir > 0 ? 'rs-next' : 'rs-prev'" mode="out-in">
        <section :key="index" class="rs-card" :class="`rs-card-${card.kind}`" :data-testid="`recap-card-${card.kind}`">
          <template v-if="card.kind === 'intro'">
            <p class="rs-eyebrow" style="--i: 0">frnk ness · итоги</p>
            <h2 class="rs-year" style="--i: 1">{{ card.year }}</h2>
            <p class="rs-lead" style="--i: 2">{{ card.nick ? `${card.nick}, твой` : 'Твой' }} год в музыке</p>
            <p class="rs-note" style="--i: 3">{{ card.final ? 'Год закончился — итоги окончательные' : 'Год ещё идёт — итоги обновляются при каждом просмотре' }}</p>
            <p class="rs-hint" style="--i: 4">Листай: нажми, проведи пальцем или используй стрелки</p>
          </template>

          <template v-else-if="card.kind === 'empty'">
            <p class="rs-eyebrow" style="--i: 0">Пока тишина</p>
            <h2 class="rs-title" style="--i: 1">В этом году мы ещё не успели узнать твой вкус</h2>
            <p class="rs-lead" style="--i: 2">Слушай треки, добавляй любимые в избранное, заходи в комнаты к друзьям — и здесь появятся цифры.</p>
          </template>

          <template v-else-if="card.kind === 'sparse'">
            <p class="rs-eyebrow" style="--i: 0">Пока немного данных</p>
            <h2 class="rs-title" style="--i: 1">Ты только начинаешь</h2>
            <p class="rs-lead" style="--i: 2">Прослушиваний пока мало, поэтому покажем только то, что уже есть. Чем больше слушаешь, тем интереснее итоги.</p>
          </template>

          <template v-else-if="card.kind === 'minutes'">
            <p class="rs-eyebrow" style="--i: 0">Время с музыкой</p>
            <p class="rs-big" style="--i: 1">{{ formatCount(card.minutes) }}</p>
            <p class="rs-lead" style="--i: 2">{{ plural(card.minutes, 'минута', 'минуты', 'минут') }}<template v-if="card.minutes >= 60"> — это {{ formatDuration(card.minutes) }}</template></p>
            <p v-if="card.plays > 0" class="rs-note" style="--i: 3">{{ formatCount(card.plays) }} {{ plural(card.plays, 'прослушивание', 'прослушивания', 'прослушиваний') }}</p>
          </template>

          <template v-else-if="card.kind === 'top'">
            <p class="rs-eyebrow" style="--i: 0">Топ треков года</p>
            <ol class="rs-list">
              <li v-for="(t, n) in card.tracks" :key="t.trackKey" class="rs-row" :style="{ '--i': n + 1 }" data-testid="recap-top-track">
                <span class="rs-rank">{{ n + 1 }}</span>
                <span class="rs-cover"><img v-if="t.cover" :src="t.cover" alt="" decoding="async"></span>
                <span class="rs-row-text">
                  <b>{{ t.title }}</b>
                  <small>{{ t.releaseTitle }}</small>
                </span>
                <span class="rs-row-n">{{ formatCount(t.plays) }}×</span>
              </li>
            </ol>
          </template>

          <template v-else-if="card.kind === 'release'">
            <p class="rs-eyebrow" style="--i: 0">Любимый релиз</p>
            <span class="rs-art" style="--i: 1"><img v-if="card.release.cover" :src="card.release.cover" alt="" decoding="async"></span>
            <h2 class="rs-title" style="--i: 2">{{ card.release.title }}</h2>
            <p class="rs-note" style="--i: 3">{{ formatCount(card.plays) }} {{ plural(card.plays, 'прослушивание', 'прослушивания', 'прослушиваний') }}<template v-if="card.minutes > 0"> · {{ formatDuration(card.minutes) }}</template></p>
          </template>

          <template v-else-if="card.kind === 'first'">
            <p class="rs-eyebrow" style="--i: 0">Первый трек года</p>
            <span class="rs-art" style="--i: 1"><img v-if="card.track.cover" :src="card.track.cover" alt="" decoding="async"></span>
            <h2 class="rs-title" style="--i: 2">{{ card.track.title }}</h2>
            <p class="rs-note" style="--i: 3">{{ card.track.releaseTitle }}<template v-if="firstWhen"> · {{ firstWhen }}</template></p>
          </template>

          <template v-else-if="card.kind === 'day'">
            <p class="rs-eyebrow" style="--i: 0">Самый активный день</p>
            <p class="rs-big" style="--i: 1">{{ formatRecapDay(card.date) }}</p>
            <p class="rs-lead" style="--i: 2">{{ formatCount(card.minutes) }} {{ plural(card.minutes, 'минута', 'минуты', 'минут') }} музыки за один день</p>
          </template>

          <template v-else-if="card.kind === 'daypart'">
            <p class="rs-eyebrow" style="--i: 0">Любимое время суток</p>
            <p class="rs-big" style="--i: 1">{{ DAY_PART_LABEL[card.part] }}</p>
            <p class="rs-lead" style="--i: 2">{{ card.share }}% прослушиваний — с {{ DAY_PART_HOURS[card.part].replace('–', ' до ') }} по Москве</p>
          </template>

          <template v-else-if="card.kind === 'rooms'">
            <p class="rs-eyebrow" style="--i: 0">Слушали вместе</p>
            <p class="rs-big" style="--i: 1">{{ formatCount(card.count) }}</p>
            <p class="rs-lead" style="--i: 2">{{ plural(card.count, 'комната', 'комнаты', 'комнат') }}</p>
            <ul v-if="card.with.length" class="rs-people" style="--i: 3">
              <li v-for="p in card.with" :key="p.user_id" data-testid="recap-companion">
                <UserAvatar :avatar="p.avatar" :nick="p.nick" :user-id="p.user_id" :size="2.5" :cover-of="coverOf" />
                <span><b>{{ p.nick }}</b><small>{{ formatDuration(p.minutes) }} · {{ p.rooms }} {{ plural(p.rooms, 'комната', 'комнаты', 'комнат') }}</small></span>
              </li>
            </ul>
          </template>

          <template v-else-if="card.kind === 'favorites'">
            <p class="rs-eyebrow" style="--i: 0">Избранное</p>
            <p class="rs-big" style="--i: 1">{{ formatCount(card.count) }}</p>
            <p class="rs-lead" style="--i: 2">{{ plural(card.count, 'трек добавлен', 'трека добавлено', 'треков добавлено') }} в избранное за год</p>
          </template>

          <template v-else-if="card.kind === 'summary'">
            <div class="rs-me" style="--i: 0">
              <UserAvatar v-if="recap.user" :avatar="recap.user.avatar" :nick="recap.user.nick" :user-id="recap.user.id" :size="3.25" :cover-of="coverOf" />
              <span><b>{{ recap.user?.nick }}</b><small>итоги {{ recap.year }}</small></span>
            </div>
            <p class="rs-big rs-big-sm" style="--i: 1">{{ formatCount(recap.minutes) }}<small> мин</small></p>
            <p class="rs-note" style="--i: 2">{{ formatCount(recap.plays) }} {{ plural(recap.plays, 'прослушивание', 'прослушивания', 'прослушиваний') }}<template v-if="recap.favorites_added"> · {{ formatCount(recap.favorites_added) }} в избранное</template><template v-if="recap.rooms.count"> · {{ formatCount(recap.rooms.count) }} {{ plural(recap.rooms.count, 'комната', 'комнаты', 'комнат') }}</template></p>
            <ol v-if="summaryTop.length" class="rs-list rs-list-sm" style="--i: 3">
              <li v-for="(t, n) in summaryTop" :key="t.trackKey" class="rs-row">
                <span class="rs-rank">{{ n + 1 }}</span>
                <span class="rs-cover"><img v-if="t.cover" :src="t.cover" alt="" decoding="async"></span>
                <span class="rs-row-text"><b>{{ t.title }}</b><small>{{ t.releaseTitle }}</small></span>
              </li>
            </ol>
            <div class="rs-actions" data-no-nav style="--i: 4">
              <button class="rs-btn rs-btn-primary" type="button" :disabled="image.busy.value" data-testid="recap-save" @click="image.save()">
                {{ image.busy.value ? 'Рисуем…' : 'Сохранить картинку' }}
              </button>
              <p v-if="image.message.value" class="rs-status" :class="{ err: image.failed.value }" role="status" data-testid="recap-save-status">{{ image.message.value }}</p>
            </div>
            <p class="rs-site" style="--i: 5">frnkness.ru</p>
          </template>
        </section>
      </Transition>
    </div>

    <button v-if="index > 0" class="rs-arrow rs-prev" type="button" aria-label="Назад" data-no-nav data-testid="recap-prev" @click="go(-1)">‹</button>
    <button v-if="index < cards.length - 1" class="rs-arrow rs-next" type="button" aria-label="Дальше" data-no-nav data-testid="recap-next" @click="go(1)">›</button>
  </div>
</template>

<script setup lang="ts">
// Полноэкранные карточки итогов: листание свайпом, стрелками, клавишами и
// нажатием (левая треть — назад, остальное — вперёд), прогресс сверху.
// Все тексты — через {{ }} (экранирование Vue). embedded — внутри страницы
// админки (рамка 9:16), иначе на весь экран.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import UserAvatar from '@/site/components/UserAvatar.vue'
import { plural } from '@/site/social/format'
import { buildCards } from './cards'
import { DAY_PART_HOURS, DAY_PART_LABEL, formatCount, formatDuration, formatRecapDay } from './format'
import { useRecapImage } from './useRecapImage'
import type { Recap, RecapCatalog } from './types'

const props = withDefaults(defineProps<{ recap: Recap; catalog: RecapCatalog; embedded?: boolean }>(), { embedded: false })
const emit = defineEmits<{ close: [] }>()

const cards = computed(() => buildCards(props.recap, props.catalog))
const index = ref(0)
const dir = ref(1)
const root = ref<HTMLElement | null>(null)
const card = computed(() => cards.value[Math.min(index.value, cards.value.length - 1)])
const coverOf = (id: string) => props.catalog.release(id)?.cover ?? null
const summaryTop = computed(() => {
  const c = cards.value.find((x) => x.kind === 'top')
  return c && c.kind === 'top' ? c.tracks.slice(0, 3) : []
})
const firstWhen = computed(() => {
  const c = card.value
  if (c.kind !== 'first') return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(new Date(c.at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' }))
  return m ? formatRecapDay(`${m[1]}-${m[2]}-${m[3]}`) : ''
})

const image = useRecapImage(() => props.recap, () => props.catalog)

// Другие данные (админ выбрал другого человека) — с первой карточки.
watch(() => props.recap, () => {
  index.value = 0
  dir.value = 1
})
// Сводка открыта — рисуем картинку заранее.
watch(card, (c) => { if (c.kind === 'summary') image.prepare() }, { immediate: true })

function go(step: number): void {
  const next = Math.max(0, Math.min(cards.value.length - 1, index.value + step))
  if (next === index.value) return
  dir.value = step
  index.value = next
}

// ── Нажатие и свайп ──
let start: { x: number; y: number; t: number; target: EventTarget | null } | null = null
const SWIPE_MIN = 45
function onDown(e: PointerEvent): void {
  start = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target }
}
function onUp(e: PointerEvent): void {
  const s = start
  start = null
  if (!s) return
  if ((s.target as HTMLElement | null)?.closest?.('[data-no-nav]')) return
  const dx = e.clientX - s.x
  const dy = e.clientY - s.y
  if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.2) {
    go(dx < 0 ? 1 : -1)
    return
  }
  if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    go(e.clientX - rect.left < rect.width / 3 ? -1 : 1)
  }
}

// ── Клавиши ──
function handleKey(e: KeyboardEvent): boolean {
  if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1)
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1)
  else if (e.key === ' ' && !(e.target as HTMLElement | null)?.closest?.('button, a')) go(1)
  else if (e.key === 'Escape' && !props.embedded) emit('close')
  else return false
  e.preventDefault()
  return true
}
const onWindowKey = (e: KeyboardEvent) => { handleKey(e) }
const onRootKey = (e: KeyboardEvent) => { if (props.embedded) handleKey(e) }

onMounted(() => {
  if (!props.embedded) {
    window.addEventListener('keydown', onWindowKey)
    document.body.classList.add('rs-lock')
  }
  void nextTick(() => root.value?.focus({ preventScroll: true }))
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKey)
  document.body.classList.remove('rs-lock')
})
</script>

<style>
body.rs-lock { overflow: hidden; }
</style>

<style scoped>
.rs {
  --rs-fg: #fff;
  --rs-muted: #a7a7ad;
  --rs-faint: #6f6f76;
  position: fixed; inset: 0; z-index: 200;
  display: flex; flex-direction: column;
  background: radial-gradient(120% 70% at 85% 0%, rgba(230, 230, 232, 0.16), transparent 60%), radial-gradient(90% 60% at 0% 100%, rgba(230, 230, 232, 0.09), transparent 60%), #000;
  color: var(--rs-fg);
  font-family: 'Golos Text', system-ui, sans-serif;
  outline: none;
  user-select: none; -webkit-user-select: none;
  padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px);
}
.rs-embedded {
  position: relative; inset: auto; z-index: 0;
  width: min(100%, 24rem); aspect-ratio: 9 / 16; max-height: 78vh; margin: 0 auto;
  border-radius: 1.25rem; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.13);
}
.rs-progress { display: flex; gap: 0.25rem; padding: 0.75rem 3rem 0 0.75rem; flex: none; }
.rs-seg { flex: 1; height: 0.1875rem; border-radius: 1rem; background: rgba(255, 255, 255, 0.22); overflow: hidden; }
.rs-seg i { display: block; height: 100%; width: 0; background: #fff; }
.rs-seg.done i, .rs-seg.now i { width: 100%; }
.rs-seg.now i { animation: rs-fill 0.5s var(--ease, ease) both; }
@keyframes rs-fill { from { width: 0; } to { width: 100%; } }
.rs-close {
  position: absolute; top: calc(0.25rem + env(safe-area-inset-top, 0px)); right: 0.5rem; z-index: 3;
  width: 2.5rem; height: 2.5rem; border: 0; background: transparent; color: #fff; font-size: 1.75rem; line-height: 1; cursor: pointer;
}
.rs-stage { position: relative; flex: 1; min-height: 0; display: flex; touch-action: pan-y; cursor: pointer; }
.rs-card {
  flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 0.875rem;
  padding: 1.5rem clamp(1.25rem, 6vw, 3rem) 2rem; max-width: 40rem; margin: 0 auto; width: 100%; overflow: hidden;
}
.rs-card > * { animation: rs-up 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) both; animation-delay: calc(var(--i, 0) * 90ms + 80ms); }
@keyframes rs-up { from { opacity: 0; transform: translateY(1.25rem); } to { opacity: 1; transform: none; } }

.rs-next-enter-active, .rs-next-leave-active, .rs-prev-enter-active, .rs-prev-leave-active { transition: opacity 0.22s ease, transform 0.22s ease; }
.rs-next-enter-from, .rs-prev-leave-to { opacity: 0; transform: translateX(2rem); }
.rs-next-leave-to, .rs-prev-enter-from { opacity: 0; transform: translateX(-2rem); }

.rs-eyebrow { font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--rs-muted); }
.rs-year { font-family: 'Unbounded', sans-serif; font-weight: 800; font-size: clamp(4.5rem, 24vw, 8rem); letter-spacing: -0.04em; line-height: 0.95; }
.rs-big { font-family: 'Unbounded', sans-serif; font-weight: 800; font-size: clamp(3rem, 17vw, 6.5rem); letter-spacing: -0.04em; line-height: 1; overflow-wrap: anywhere; }
.rs-big small { font-size: 0.35em; font-weight: 600; color: var(--rs-muted); letter-spacing: 0; }
.rs-big-sm { font-size: clamp(2.5rem, 12vw, 4.5rem); }
.rs-title { font-family: 'Unbounded', sans-serif; font-weight: 700; font-size: clamp(1.5rem, 6.5vw, 2.5rem); letter-spacing: -0.02em; line-height: 1.12; overflow-wrap: anywhere; }
.rs-lead { font-size: clamp(1.0625rem, 4.4vw, 1.5rem); line-height: 1.35; font-weight: 600; overflow-wrap: anywhere; }
.rs-note { color: var(--rs-muted); font-size: 1rem; line-height: 1.45; }
.rs-hint { color: var(--rs-faint); font-size: 0.8125rem; margin-top: 1rem; }

.rs-art { width: min(58vw, 15rem, 30vh); aspect-ratio: 1; border-radius: 1rem; overflow: hidden; background: #1b1b1f; box-shadow: 0 1.5rem 3.75rem -1.75rem rgba(0, 0, 0, 0.9); }
.rs-art img, .rs-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }

.rs-list { list-style: none; display: flex; flex-direction: column; gap: 0.625rem; margin: 0; padding: 0; }
.rs-row { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.rs-rank { font-family: 'Unbounded', sans-serif; font-weight: 700; width: 1.25rem; text-align: center; color: var(--rs-muted); flex: none; }
.rs-cover { width: 3.5rem; height: 3.5rem; border-radius: 0.5rem; overflow: hidden; background: #1b1b1f; flex: none; }
.rs-list-sm .rs-cover { width: 2.75rem; height: 2.75rem; }
.rs-row-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.rs-row-text b, .rs-row-text small, .rs-me b, .rs-me small, .rs-people b, .rs-people small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.rs-row-text b { font-weight: 700; }
.rs-row-text small, .rs-me small, .rs-people small { color: var(--rs-muted); font-size: 0.8125rem; }
.rs-row-n { color: var(--rs-muted); font-weight: 600; flex: none; }

.rs-people { list-style: none; display: flex; flex-direction: column; gap: 0.625rem; margin: 0.5rem 0 0; padding: 0; }
.rs-people li { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.rs-people span { min-width: 0; }

.rs-me { display: flex; align-items: center; gap: 0.875rem; min-width: 0; }
.rs-me > span { min-width: 0; }
.rs-me b { font-family: 'Unbounded', sans-serif; font-size: 1.125rem; }
.rs-actions { display: flex; flex-direction: column; gap: 0.5rem; align-items: stretch; margin-top: 0.5rem; cursor: default; }
.rs-btn { height: 3rem; border-radius: 0.5rem; border: 1px solid rgba(255, 255, 255, 0.2); background: transparent; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
.rs-btn-primary { background: #fff; color: #0a0a0a; border-color: #fff; }
.rs-btn:disabled { opacity: 0.6; cursor: progress; }
.rs-status { font-size: 0.875rem; color: var(--rs-muted); line-height: 1.4; }
.rs-status.err { color: #ff8a8e; }
.rs-site { font-family: 'Unbounded', sans-serif; font-weight: 600; font-size: 0.875rem; color: var(--rs-faint); text-align: center; }

.rs-arrow {
  position: absolute; top: 50%; z-index: 2; transform: translateY(-50%);
  width: 2.75rem; height: 2.75rem; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.45); color: #fff; font-size: 1.5rem; line-height: 1; cursor: pointer; display: none;
}
.rs-prev { left: 0.75rem; }
.rs-next { right: 0.75rem; }
@media (hover: hover) and (min-width: 48rem) { .rs-arrow { display: block; } .rs-embedded .rs-arrow { display: none; } }
.rs-arrow:hover { background: rgba(255, 255, 255, 0.14); }

@media (prefers-reduced-motion: reduce) {
  .rs-card > *, .rs-seg.now i { animation: none; }
  .rs-next-enter-active, .rs-next-leave-active, .rs-prev-enter-active, .rs-prev-leave-active { transition: none; }
}
</style>
