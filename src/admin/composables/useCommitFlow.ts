import { reactive } from 'vue'
import { AdminApiError, commitFiles, type CommitFile, type CommitResult } from '../api/content'
import { useRepo } from './useRepo'
import { usePublish } from './usePublish'

/**
 * Сохранение = подтверждение + один коммит. Диалог показывает, какие файлы
 * и с каким сообщением уйдут в main; медиафайлы (prepare) загружаются уже
 * после нажатия «Опубликовать».
 */
export interface PlannedFile {
    path: string
    kind: 'new' | 'changed'
    /** Размер в байтах (для медиафайлов). */
    size?: number
}

export interface CommitPlan {
    title: string
    message: string
    files: PlannedFile[]
    notes?: string[]
    /** Готовит содержимое файлов (например, загружает медиа). */
    prepare: (progress: (text: string) => void) => Promise<CommitFile[]>
}

export function useCommitFlow() {
    const repo = useRepo()
    const publish = usePublish()
    const state = reactive({
        open: false,
        busy: false,
        progress: '',
        error: '',
        details: [] as string[],
        conflict: false,
        plan: null as CommitPlan | null
    })
    let resolve: ((r: CommitResult | null) => void) | null = null

    function request(plan: CommitPlan): Promise<CommitResult | null> {
        Object.assign(state, { open: true, busy: false, progress: '', error: '', details: [], conflict: false, plan })
        return new Promise((r) => (resolve = r))
    }

    function finish(result: CommitResult | null) {
        state.open = false
        state.plan = null
        resolve?.(result)
        resolve = null
    }

    async function confirm() {
        const plan = state.plan
        if (!plan || state.busy) return
        state.busy = true
        state.error = ''
        state.details = []
        try {
            const baseSha = repo.state.sha
            if (!baseSha) throw new AdminApiError('no_base', 0, 'Нет данных о версии сайта — обнови страницу')
            const files = await plan.prepare((text) => (state.progress = text))
            state.progress = 'Создаём коммит…'
            const result = await commitFiles(baseSha, plan.message, files)
            publish.track(result.sha, result.message)
            repo.afterCommit(result.sha)
            finish(result)
        } catch (e) {
            if (e instanceof AdminApiError) {
                state.error = e.message
                state.details = e.details
                state.conflict = e.code === 'conflict'
            } else state.error = `Не удалось сохранить: ${(e as Error).message}`
        } finally {
            state.busy = false
            state.progress = ''
        }
    }

    return { state, request, confirm, cancel: () => finish(null) }
}

export type CommitFlow = ReturnType<typeof useCommitFlow>
