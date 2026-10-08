<template>
    <button :class="buttonClass" type="button" data-testid="admin-logout" @click="open = true">Выйти</button>
    <div v-if="open" class="adm-modal-backdrop" @click.self="open = false">
        <div class="adm-modal adm-modal-sm" role="alertdialog" aria-modal="true" aria-labelledby="adm-logout-title" data-testid="logout-confirm" @keydown.esc="open = false">
            <h2 id="adm-logout-title">Выйти из аккаунта?</h2>
            <div class="adm-row" style="justify-content: flex-end; margin-top: 1rem">
                <button ref="cancelBtn" class="adm-btn adm-btn-sm" type="button" data-testid="logout-cancel" @click="open = false">Отмена</button>
                <button class="adm-btn adm-btn-danger adm-btn-sm" type="button" data-testid="logout-confirm-btn" @click="confirm">Выйти</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
// «Выйти» с подтверждением: случайное нажатие не разлогинивает.
import { nextTick, ref, watch } from 'vue'
import { useAuth } from '../composables/useAuth'

defineProps<{ buttonClass?: string }>()

const auth = useAuth()
const open = ref(false)
const cancelBtn = ref<HTMLButtonElement | null>(null)

watch(open, (value) => {
    if (value) void nextTick(() => cancelBtn.value?.focus())
})

function confirm() {
    open.value = false
    void auth.signOut()
}
</script>
