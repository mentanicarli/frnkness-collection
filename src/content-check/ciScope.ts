/**
 * Что проверять при деплое (.github/workflows/deploy-pages.yml).
 *
 * Пуш, в котором поменялся только контент (то, что правит админка), не может
 * сломать типы и юнит-тесты: они не читают настоящий каталог. Для него
 * хватает check:content и сборки. Всё остальное — полный набор проверок.
 *
 * Если список файлов неизвестен (ручной запуск, новая ветка, слишком
 * большой пуш — GitHub отдаёт в событии не больше 20 коммитов), считаем,
 * что поменялся код.
 */

export const CONTENT_PATH_RE = /^(lyrics|audio|images|lyrics-books)\/|^src\/content\/[^/]+\.json$/

export interface PushCommit {
    added?: string[]
    modified?: string[]
    removed?: string[]
}

export type Scope = 'content' | 'full'

/** GitHub обрезает commits в событии push до 20 — дальше список неполный. */
const PUSH_COMMITS_LIMIT = 20

export function changedPaths(commits: PushCommit[]): string[] {
    const out = new Set<string>()
    for (const c of commits) for (const p of [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])]) out.add(p)
    return [...out]
}

export function deployScope(event: string, commits: unknown): Scope {
    if (event !== 'push' || !Array.isArray(commits) || commits.length === 0 || commits.length >= PUSH_COMMITS_LIMIT) return 'full'
    const paths = changedPaths(commits as PushCommit[])
    if (paths.length === 0) return 'full'
    return paths.every((p) => CONTENT_PATH_RE.test(p)) ? 'content' : 'full'
}
