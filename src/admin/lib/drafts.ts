/**
 * Черновики несохранённой работы в браузере (localStorage): караоке и
 * тексты. Ключ — раздел и путь файла, поэтому у каждого трека свой
 * черновик. Хранилище может быть недоступно (приватный режим, квота) —
 * тогда черновик просто не пишется, работа страницы не ломается.
 *
 * original — то, от чего начиналась правка (содержимое файла из main).
 * Если при восстановлении файл в main уже другой, админка предупреждает.
 */
export interface Draft<T> {
    v: 1
    savedAt: number
    /** Версия main, на которой были загружены файлы. */
    baseSha: string
    original: string
    data: T
    /** Кто правил — на случай общего компьютера. */
    user?: string
}

const PREFIX = 'adm-draft:'
/** Черновики старше месяца не предлагаем и убираем. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export const draftKey = (section: 'lrc' | 'lyrics', path: string) => `${PREFIX}${section}:${path}`

function storage(): Storage | null {
    try {
        return window.localStorage
    } catch {
        return null
    }
}

export function readDraft<T>(key: string, now = Date.now()): Draft<T> | null {
    const s = storage()
    if (!s) return null
    try {
        const raw = s.getItem(key)
        if (!raw) return null
        const d = JSON.parse(raw) as Draft<T>
        if (d?.v !== 1 || typeof d.savedAt !== 'number' || d.data === undefined) return null
        if (now - d.savedAt > MAX_AGE_MS) {
            s.removeItem(key)
            return null
        }
        return d
    } catch {
        return null
    }
}

export function writeDraft<T>(key: string, draft: Omit<Draft<T>, 'v'>): boolean {
    const s = storage()
    if (!s) return false
    try {
        s.setItem(key, JSON.stringify({ v: 1, ...draft }))
        return true
    } catch {
        return false
    }
}

export function removeDraft(key: string) {
    try {
        storage()?.removeItem(key)
    } catch {
        // не страшно
    }
}

/** «5 мин назад», «вчера в 18:02» — когда сохранён черновик. */
export function draftAge(savedAt: number, now = Date.now()): string {
    const min = Math.round((now - savedAt) / 60000)
    if (min < 1) return 'только что'
    if (min < 60) return `${min} мин назад`
    const d = new Date(savedAt)
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(savedAt).setHours(0, 0, 0, 0)) / 86400000)
    if (days === 0) return `сегодня в ${time}`
    if (days === 1) return `вчера в ${time}`
    return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} в ${time}`
}
