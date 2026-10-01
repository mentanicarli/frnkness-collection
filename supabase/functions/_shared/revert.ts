/**
 * Откат правки из админки — чистая логика (без GitHub и базы).
 *
 * Откат = новый коммит, который возвращает затронутые правкой файлы к
 * состоянию родительского коммита: изменённые и удалённые — по sha blob из
 * дерева родителя (mp3 не загружаются заново), добавленные — удаляются.
 */
import { checkPath, checkRegistryChange, validateSiteSettings } from './rules.ts'

export interface CommitFileChange {
    filename: string
    status: 'added' | 'modified' | 'removed' | 'renamed' | 'changed' | 'copied' | 'unchanged'
    previous_filename?: string
}

export interface TreeItem {
    sha: string
    mode: string
}

export interface RevertFile {
    path: string
    action: 'restore' | 'recreate' | 'delete'
}

export interface RevertConflict {
    path: string
    commits: { sha: string; message: string }[]
}

export interface RevertPlan {
    ok: boolean
    files: RevertFile[]
    conflicts: RevertConflict[]
    blocked: string[]
    entries: { path: string; mode: string; type: 'blob'; sha: string | null }[]
}

export const RELEASES_PATH = 'src/content/releases.json'
export const SITE_PATH = 'src/content/site.json'

export function isAdminCommit(message: string): boolean {
    return message.startsWith('admin: ')
}

export function revertMessage(message: string): string {
    const first = message.split('\n')[0].replace(/^admin: /, '')
    const short = first.length > 150 ? first.slice(0, 149) + '…' : first
    return `admin: откат «${short}»`
}

/** Релизы, которые исчезнут из реестра после отката. */
export function removedReleaseIds(head: unknown, parent: unknown): string[] {
    if (!head || typeof head !== 'object' || Array.isArray(head)) return []
    const p = parent && typeof parent === 'object' && !Array.isArray(parent) ? (parent as Record<string, unknown>) : {}
    return Object.keys(head).filter((id) => !(id in p))
}

/** Сумма прослушиваний релиза по строкам play_counts (оба формата ключа). */
export function playsForRelease(id: string, rows: { track_key: string; plays: number | null }[]): number {
    const re = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}--?\\d+$`)
    return rows.filter((r) => re.test(r.track_key)).reduce((s, r) => s + (Number(r.plays) || 0), 0)
}

export interface RevertInput {
    message: string
    parentCount: number
    files: CommitFileChange[]
    /** Дерево родительского коммита: путь → blob. */
    parentTree: Map<string, TreeItem>
    /** Какие более поздние коммиты меняли какие файлы. */
    laterChanges: Map<string, { sha: string; message: string }[]>
    /** releases.json сейчас и в родителе (если откат его затрагивает). */
    releases?: { head: unknown; parent: unknown }
    /** site.json сейчас и в родителе (если откат его затрагивает). */
    site?: { head: unknown; parent: unknown }
    /** Прослушивания релизов, которые откат уберёт. */
    plays?: Record<string, number>
    /** Реестр после отката — для проверки site.json. */
    registryAfter?: unknown
}

export function planRevert(input: RevertInput): RevertPlan {
    const blocked: string[] = []
    const files: RevertFile[] = []
    const entries: RevertPlan['entries'] = []

    if (!isAdminCommit(input.message)) blocked.push('Откатить можно только правку из админки')
    if (input.parentCount !== 1) blocked.push('Это коммит слияния — откат из админки не поддерживается')

    const touch = (path: string, action: RevertFile['action']) => {
        const check = checkPath(path)
        if (!check.ok) {
            blocked.push(`Файл вне разрешённых папок: ${path}`)
            return
        }
        if (action === 'delete') {
            // Без src/content/*.json сайт не соберётся.
            if (path.startsWith('src/content/')) {
                blocked.push(`Откат удалил бы ${path} — так нельзя`)
                return
            }
            files.push({ path, action })
            entries.push({ path, mode: '100644', type: 'blob', sha: null })
            return
        }
        const item = input.parentTree.get(path)
        if (!item) {
            blocked.push(`В предыдущей версии нет файла ${path}`)
            return
        }
        files.push({ path, action })
        entries.push({ path, mode: item.mode, type: 'blob', sha: item.sha })
    }

    for (const f of input.files) {
        if (f.status === 'added' || f.status === 'copied') touch(f.filename, 'delete')
        else if (f.status === 'removed') touch(f.filename, 'recreate')
        else if (f.status === 'renamed') {
            touch(f.filename, 'delete')
            if (f.previous_filename) touch(f.previous_filename, 'recreate')
        } else if (f.status === 'modified' || f.status === 'changed') touch(f.filename, 'restore')
    }

    // Файлы, которые потом меняли другие коммиты, — откат их затёр бы.
    const conflicts: RevertConflict[] = []
    for (const f of files) {
        const later = input.laterChanges.get(f.path)
        if (later && later.length) conflicts.push({ path: f.path, commits: later })
    }

    // Защита статистики: откат реестра проверяется теми же правилами.
    if (input.releases) {
        const removed = removedReleaseIds(input.releases.head, input.releases.parent)
        const allowedRemoval = removed.filter((id) => (input.plays?.[id] ?? 0) === 0)
        for (const id of removed) {
            const plays = input.plays?.[id] ?? 0
            if (plays > 0) {
                blocked.push(`Откат удалил бы релиз «${id}», у которого уже ${plays} прослушиваний — статистика перепуталась бы. Такой откат невозможен.`)
            }
        }
        const errors = checkRegistryChange(input.releases.head, input.releases.parent).filter(
            (e) => !allowedRemoval.some((id) => e.startsWith(`релиз «${id}» нельзя удалить`))
        )
        blocked.push(...errors.map((e) => `Откат нарушил бы защиту релизов: ${e}`))
    }
    if (input.site) {
        const errors = validateSiteSettings(input.site.parent, input.registryAfter)
        blocked.push(...errors.map((e) => `После отката site.json был бы некорректен: ${e}`))
    }

    return { ok: blocked.length === 0 && conflicts.length === 0 && entries.length > 0, files, conflicts, blocked, entries }
}
