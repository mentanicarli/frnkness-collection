<template>
    <div v-if="draft" class="adm-alert adm-alert-warn adm-draft" role="status" data-testid="draft-offer">
        <div>
            Есть несохранённый черновик{{ draft.user ? ` (${draft.user})` : '' }} от {{ draftAge(draft.savedAt) }}.
            <template v-if="stale">
                <br /><b>С тех пор файл в main изменился</b> — если восстановишь и сохранишь, чужие правки этого файла заменятся твоими.
            </template>
            <template v-else> Пока не выберешь, новые правки черновиком не сохраняются.</template>
        </div>
        <div class="adm-row" style="gap: 0.5rem; margin-top: 0.5rem">
            <button class="adm-btn adm-btn-primary adm-btn-sm" type="button" @click="emit('restore')">Восстановить черновик</button>
            <button class="adm-btn adm-btn-ghost adm-btn-sm" type="button" @click="emit('discard')">Удалить черновик</button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { draftAge, type Draft } from '../lib/drafts'

defineProps<{ draft: Draft<unknown> | null; stale: boolean }>()
const emit = defineEmits<{ restore: []; discard: [] }>()
</script>
