import { reactive } from 'vue'
import { deployStatus, type DeployState } from '../api/content'

/**
 * Статус публикации после коммита: опрашивает последний запуск workflow
 * деплоя для коммита, пока он не завершится.
 */
export type PublishState = DeployState | 'unknown'

export interface PublishItem {
    sha: string
    message: string
    state: PublishState
    url: string | null
    dismissed: boolean
}

const POLL_MS = 8000
const GIVE_UP_MS = 15 * 60 * 1000

const state = reactive({ items: [] as PublishItem[] })

async function poll(item: PublishItem, startedAt: number) {
    try {
        const res = await deployStatus(item.sha)
        item.state = res.state
        item.url = res.url
    } catch {
        // Временная ошибка сети — попробуем на следующем круге.
    }
    if (item.state !== 'pending') return
    if (Date.now() - startedAt > GIVE_UP_MS) {
        item.state = 'unknown'
        return
    }
    setTimeout(() => poll(item, startedAt), POLL_MS)
}

function track(sha: string, message: string) {
    state.items.forEach((i) => (i.dismissed = true))
    const item = reactive<PublishItem>({ sha, message, state: 'pending', url: null, dismissed: false })
    state.items.push(item)
    setTimeout(() => poll(item, Date.now()), 3000)
}

export function usePublish() {
    return { state, track }
}
