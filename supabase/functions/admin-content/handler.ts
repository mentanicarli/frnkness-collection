/**
 * Логика Edge Function `admin-content` без привязки к Deno.
 *
 * Все внешние зависимости (GitHub через fetch, проверка JWT, staging-бакет)
 * приходят снаружи: index.ts подставляет настоящие, юнит-тесты — фейковые.
 *
 * Действия (POST, JSON { action, ... }):
 *   ping           — проверка входа и доступа к репозиторию
 *   head           — sha ветки и дерево файлов репозитория
 *   read           — текстовые файлы на заданном sha
 *   stage-blob     — файл из staging-бакета → GitHub blob (staging удаляется всегда)
 *   commit         — один атомарный коммит поверх baseSha
 *   deploy-status  — последний запуск workflow деплоя для коммита
 */
import { corsHeaders, isAllowedOrigin } from '../_shared/cors.ts'
import {
    checkPath,
    checkDeletions,
    checkRegistryChange,
    validateSiteSettings,
    validateTrackNotes
} from '../_shared/rules.ts'
import { parseTokenExpiration } from '../_shared/tokenExpiry.ts'
import {
    RELEASES_PATH,
    SITE_PATH,
    isAdminCommit,
    planRevert,
    removedReleaseIds,
    revertMessage,
    type CommitFileChange,
    type TreeItem
} from '../_shared/revert.ts'

interface GhCommit {
    sha: string
    commit: { message: string; author?: { name?: string; date?: string }; committer?: { date?: string } }
    parents: { sha: string }[]
    files?: CommitFileChange[]
}

const HISTORY_SIZE = 30
const firstLine = (message: string) => message.split('\n')[0]

/** Параллельно, но не больше limit запросов сразу. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length)
    let next = 0
    const worker = async () => {
        while (next < items.length) {
            const i = next++
            out[i] = await fn(items[i])
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
    return out
}

export interface AuthUser {
    id: string
    email?: string
    app_metadata?: Record<string, unknown>
}

export interface StagingObject {
    name: string
    created_at: string | null
}

export interface HandlerDeps {
    env: {
        githubToken?: string
        repo: string
        branch: string
        workflow: string
        signingKey: string
    }
    fetch: typeof fetch
    getUser(jwt: string): Promise<AuthUser | null>
    staging: {
        download(path: string): Promise<Uint8Array | null>
        remove(paths: string[]): Promise<void>
        list(): Promise<StagingObject[]>
    }
    toBase64(bytes: Uint8Array): string
    now(): number
    /** Прослушивания релизов (из play_counts) — для защиты статистики при откате. */
    playsFor(releaseIds: string[]): Promise<Record<string, number>>
}

class HttpError extends Error {
    constructor(
        public status: number,
        public code: string,
        message: string,
        public details?: string[]
    ) {
        super(message)
    }
}

const SHA_RE = /^[0-9a-f]{40}$/

/** Запись дерева коммита; sha: null — удалить файл. */
interface TreeEntry {
    path: string
    /** Обычно 100644; при откате — режим из дерева родителя. */
    mode: string
    type: 'blob'
    sha?: string | null
    content?: string
}
const STAGING_NAME_RE = /^[0-9a-f-]{36}\.(mp3|jpg|jpeg|png|pdf)$/
const STAGING_TTL_MS = 24 * 60 * 60 * 1000
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
const MAX_FILES_PER_COMMIT = 80
const MAX_READ_PATHS = 60

const encoder = new TextEncoder()

function byteLength(text: string): number {
    return encoder.encode(text).length
}

function encodePath(path: string): string {
    return path.split('/').map(encodeURIComponent).join('/')
}

// Сигнатуры форматов: расширение должно совпадать с содержимым.
function matchesMagic(path: string, bytes: Uint8Array): boolean {
    const ext = path.toLowerCase().split('.').pop()
    const b = bytes
    if (ext === 'mp3') return (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)
    if (ext === 'jpg' || ext === 'jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    if (ext === 'png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)
    if (ext === 'pdf') return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46
    return false
}

async function hmacHex(key: string, data: string): Promise<string> {
    const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)))
    return Array.from(sig, (v) => v.toString(16).padStart(2, '0')).join('')
}

function parseJson(text: string, label: string): unknown {
    try {
        return JSON.parse(text)
    } catch (e) {
        throw new HttpError(422, 'validation', `${label}: некорректный JSON`, [(e as Error).message])
    }
}

export function createHandler(deps: HandlerDeps) {
    const { env } = deps
    let lastCleanup = 0

    async function gh(path: string, init: RequestInit & { accept?: string; allow404?: boolean } = {}): Promise<Response> {
        if (!env.githubToken) {
            throw new HttpError(502, 'github_token_invalid', 'Токен GitHub не задан — добавь секрет GITHUB_TOKEN функции')
        }
        const res = await deps.fetch(`https://api.github.com${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${env.githubToken}`,
                Accept: init.accept || 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'frnkness-admin',
                ...(init.body ? { 'Content-Type': 'application/json' } : {})
            }
        })
        if (res.ok) return res
        if (res.status === 404 && init.allow404) return res
        if (res.status === 401) {
            throw new HttpError(502, 'github_token_invalid', 'Токен GitHub недействителен — обнови его в секретах функции')
        }
        if (res.status === 403 || res.status === 429) {
            if (res.headers.get('x-ratelimit-remaining') === '0') {
                throw new HttpError(502, 'github_rate_limit', 'GitHub временно ограничил запросы — попробуй через несколько минут')
            }
            throw new HttpError(502, 'github_forbidden', 'У токена GitHub не хватает прав (нужны Contents: read/write и Actions: read)')
        }
        if (res.status === 404) {
            throw new HttpError(502, 'github_forbidden', 'Репозиторий не найден или у токена GitHub нет к нему доступа')
        }
        const text = await res.text().catch(() => '')
        throw new HttpError(502, 'github_error', `GitHub ответил ошибкой ${res.status}`, text ? [text.slice(0, 300)] : undefined)
    }

    async function ghJson<T>(path: string, init: RequestInit = {}): Promise<T> {
        const res = await gh(path, init)
        return (await res.json()) as T
    }

    const repoPath = () => `/repos/${env.repo}`

    async function headSha(): Promise<string> {
        const ref = await ghJson<{ object: { sha: string } }>(`${repoPath()}/git/ref/heads/${encodeURIComponent(env.branch)}`)
        return ref.object.sha
    }

    async function readFile(path: string, ref: string): Promise<string | null> {
        const res = await gh(`${repoPath()}/contents/${encodePath(path)}?ref=${ref}`, {
            accept: 'application/vnd.github.raw+json',
            allow404: true
        })
        if (res.status === 404) return null
        return await res.text()
    }

    async function cleanupStaging() {
        const now = deps.now()
        if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
        lastCleanup = now
        try {
            const stale = (await deps.staging.list())
                .filter((o) => o.created_at && now - Date.parse(o.created_at) > STAGING_TTL_MS)
                .map((o) => o.name)
            if (stale.length) await deps.staging.remove(stale)
        } catch {
            // Уборка — фоновая забота, ошибка не должна ломать запрос.
        }
    }

    function signBlob(sha: string, path: string, size: number) {
        return hmacHex(env.signingKey, `${sha}:${path}:${size}`)
    }

    // ── Действия ───────────────────────────────────────────────────────

    async function ping(user: AuthUser) {
        const res = await gh(repoPath())
        const repo = (await res.json()) as { full_name: string; default_branch: string }
        return {
            user: { email: user.email ?? null },
            repo: repo.full_name,
            branch: env.branch,
            // Срок fine-grained токена; null — токен без срока.
            tokenExpiresAt: parseTokenExpiration(res.headers.get('github-authentication-token-expiration'))
        }
    }

    async function head() {
        const sha = await headSha()
        const commit = await ghJson<{ tree: { sha: string } }>(`${repoPath()}/git/commits/${sha}`)
        const tree = await ghJson<{ truncated: boolean; tree: { path: string; type: string; size?: number }[] }>(
            `${repoPath()}/git/trees/${commit.tree.sha}?recursive=1`
        )
        return {
            sha,
            truncated: tree.truncated,
            files: tree.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, size: e.size ?? 0 }))
        }
    }

    async function read(body: Record<string, unknown>) {
        const ref = body.ref
        const paths = body.paths
        if (typeof ref !== 'string' || !SHA_RE.test(ref)) throw new HttpError(400, 'bad_request', 'Нужен sha коммита')
        if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_READ_PATHS) {
            throw new HttpError(400, 'bad_request', `Нужно от 1 до ${MAX_READ_PATHS} путей`)
        }
        for (const p of paths) {
            const check = checkPath(p)
            if (!check.ok) throw new HttpError(400, 'path_rejected', check.error)
            if (check.rule.kind !== 'text') throw new HttpError(400, 'path_rejected', `Читать можно только текстовые файлы: ${p}`)
        }
        const entries = await Promise.all((paths as string[]).map(async (p) => [p, await readFile(p, ref)] as const))
        return { files: Object.fromEntries(entries) }
    }

    async function stageBlob(body: Record<string, unknown>) {
        const stagingPath = body.stagingPath
        const path = body.path
        if (typeof stagingPath !== 'string' || !STAGING_NAME_RE.test(stagingPath)) {
            throw new HttpError(400, 'bad_request', 'Некорректное имя staging-файла')
        }
        try {
            const check = checkPath(path)
            if (!check.ok) throw new HttpError(400, 'path_rejected', check.error)
            if (check.rule.kind !== 'binary') throw new HttpError(400, 'path_rejected', `Через staging загружаются только медиафайлы: ${path}`)
            const bytes = await deps.staging.download(stagingPath)
            if (!bytes) throw new HttpError(404, 'staging_missing', 'Загруженный файл не найден — загрузи его ещё раз')
            if (bytes.length === 0) throw new HttpError(422, 'validation', `Файл пустой: ${path}`)
            if (bytes.length > check.rule.maxBytes) {
                throw new HttpError(422, 'validation', `Файл больше ${Math.round(check.rule.maxBytes / 1024 / 1024)} МБ: ${path}`)
            }
            if (!matchesMagic(path as string, bytes)) {
                throw new HttpError(422, 'validation', `Содержимое не похоже на ${String(path).split('.').pop()}: ${path}`)
            }
            const blob = await ghJson<{ sha: string }>(`${repoPath()}/git/blobs`, {
                method: 'POST',
                body: JSON.stringify({ content: deps.toBase64(bytes), encoding: 'base64' })
            })
            return { sha: blob.sha, path, size: bytes.length, token: await signBlob(blob.sha, path as string, bytes.length) }
        } finally {
            // Staging-файл больше не нужен ни при успехе, ни при ошибке.
            await deps.staging.remove([stagingPath]).catch(() => undefined)
        }
    }

    async function commit(body: Record<string, unknown>) {
        const baseSha = body.baseSha
        const rawMessage = body.message
        const files = body.files
        if (typeof baseSha !== 'string' || !SHA_RE.test(baseSha)) throw new HttpError(400, 'bad_request', 'Нужен baseSha')
        if (typeof rawMessage !== 'string' || !rawMessage.trim() || rawMessage.length > 200 || /[\r\n]/.test(rawMessage)) {
            throw new HttpError(400, 'bad_request', 'Сообщение коммита — одна строка до 200 символов')
        }
        if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES_PER_COMMIT) {
            throw new HttpError(400, 'bad_request', `В коммите должно быть от 1 до ${MAX_FILES_PER_COMMIT} файлов`)
        }
        const message = rawMessage.startsWith('admin: ') ? rawMessage : `admin: ${rawMessage.trim()}`

        const errors: string[] = []
        const seen = new Set<string>()
        const treeEntries: TreeEntry[] = []
        const textByPath = new Map<string, string>()
        const deletes: string[] = []

        for (const raw of files as Record<string, unknown>[]) {
            const path = raw && raw.path
            const check = checkPath(path)
            if (!check.ok) {
                errors.push(check.error)
                continue
            }
            const p = path as string
            if (seen.has(p)) {
                errors.push(`файл указан дважды: ${p}`)
                continue
            }
            seen.add(p)
            if (raw.delete === true) {
                // Что именно можно удалять, проверяется ниже по реестру.
                deletes.push(p)
                continue
            }
            if (check.rule.kind === 'text') {
                if (typeof raw.content !== 'string') {
                    errors.push(`нет содержимого: ${p}`)
                    continue
                }
                const content = raw.content.replace(/\r\n?/g, '\n')
                if (byteLength(content) > check.rule.maxBytes) {
                    errors.push(`файл слишком большой: ${p}`)
                    continue
                }
                textByPath.set(p, content)
                treeEntries.push({ path: p, mode: '100644', type: 'blob', content })
            } else {
                const blob = raw.blob as Record<string, unknown> | undefined
                if (!blob || typeof blob.sha !== 'string' || !SHA_RE.test(blob.sha) || typeof blob.size !== 'number' || typeof blob.token !== 'string') {
                    errors.push(`медиафайл нужно сначала загрузить: ${p}`)
                    continue
                }
                const expected = await signBlob(blob.sha, p, blob.size)
                if (expected !== blob.token) {
                    errors.push(`подпись загрузки не совпадает: ${p}`)
                    continue
                }
                if (blob.size > check.rule.maxBytes) {
                    errors.push(`файл слишком большой: ${p}`)
                    continue
                }
                treeEntries.push({ path: p, mode: '100644', type: 'blob', sha: blob.sha })
            }
        }
        if (errors.length) throw new HttpError(422, 'validation', 'Коммит отклонён', errors)

        // Содержательные проверки JSON.
        for (const [p, content] of textByPath) {
            if (p.toLowerCase().endsWith('.notes.json')) {
                const problems = validateTrackNotes(parseJson(content, p))
                errors.push(...problems.map((e) => `${p}: ${e}`))
            } else if (p.startsWith('src/content/')) {
                parseJson(content, p)
            }
        }
        const RELEASES = 'src/content/releases.json'
        const SITE = 'src/content/site.json'
        let registry: unknown = null
        if (textByPath.has(RELEASES)) {
            const before = await readFile(RELEASES, baseSha)
            registry = parseJson(textByPath.get(RELEASES)!, RELEASES)
            errors.push(...checkRegistryChange(before === null ? {} : parseJson(before, RELEASES), registry))
        }
        if (textByPath.has(SITE)) {
            if (registry === null) {
                const current = await readFile(RELEASES, baseSha)
                registry = current === null ? {} : parseJson(current, RELEASES)
            }
            const site = parseJson(textByPath.get(SITE)!, SITE)
            errors.push(...validateSiteSettings(site, registry))
            // Обложка анонса должна быть в этом коммите или уже в репозитории.
            const cover = (site as { announce?: { cover?: unknown } })?.announce?.cover
            if (typeof cover === 'string' && !(seen.has(cover) && !deletes.includes(cover)) && !(await fileExists(cover, baseSha))) {
                errors.push(`обложка анонса не найдена: ${cover}`)
            }
        }
        if (deletes.length) {
            // Удалять можно только заменяемую обложку/PDF, на которую новая
            // версия реестра (или site.json) больше не ссылается.
            const baseReleases = await readFile(RELEASES, baseSha)
            const baseSite = await readFile(SITE, baseSha)
            const before = {
                registry: baseReleases === null ? {} : parseJson(baseReleases, RELEASES),
                site: baseSite === null ? {} : parseJson(baseSite, SITE)
            }
            const after = {
                registry: textByPath.has(RELEASES) ? parseJson(textByPath.get(RELEASES)!, RELEASES) : before.registry,
                site: textByPath.has(SITE) ? parseJson(textByPath.get(SITE)!, SITE) : before.site
            }
            errors.push(...checkDeletions(deletes, before, after))
        }
        if (errors.length) throw new HttpError(422, 'validation', 'Коммит отклонён', errors)

        // Удаляем только то, что действительно есть в базовой версии.
        for (const p of deletes) {
            if (await fileExists(p, baseSha)) treeEntries.push({ path: p, mode: '100644', type: 'blob', sha: null })
        }

        return writeCommit(baseSha, message, treeEntries)
    }

    async function fileExists(path: string, ref: string): Promise<boolean> {
        const res = await gh(`${repoPath()}/contents/${encodePath(path)}?ref=${ref}`, { allow404: true })
        return res.status !== 404
    }

    /**
     * Один коммит поверх baseSha: дерево → коммит → перенос ветки без force.
     * Если ветка ушла вперёд — 409, ничего не перезаписывается.
     */
    async function writeCommit(baseSha: string, message: string, treeEntries: TreeEntry[]) {
        const conflict = () => new HttpError(409, 'conflict', 'Данные на сайте изменились, пока ты редактировал. Обнови страницу и повтори правку.')
        if ((await headSha()) !== baseSha) throw conflict()

        const baseCommit = await ghJson<{ tree: { sha: string } }>(`${repoPath()}/git/commits/${baseSha}`)
        const tree = await ghJson<{ sha: string }>(`${repoPath()}/git/trees`, {
            method: 'POST',
            body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries })
        })
        const created = await ghJson<{ sha: string; html_url: string }>(`${repoPath()}/git/commits`, {
            method: 'POST',
            body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] })
        })
        const res = await deps.fetch(`https://api.github.com${repoPath()}/git/refs/heads/${encodeURIComponent(env.branch)}`, {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${env.githubToken}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'frnkness-admin',
                'Content-Type': 'application/json'
            },
            // force: false — GitHub сам откажет, если ветка успела уйти вперёд.
            body: JSON.stringify({ sha: created.sha, force: false })
        })
        if (res.status === 422 || res.status === 409) {
            const text = await res.text().catch(() => '')
            // 422 бывает и у защищённой ветки — это не конфликт правок.
            if (/protected branch/i.test(text)) {
                throw new HttpError(502, 'github_branch_protected', 'Ветка main защищена правилами GitHub — коммит из админки невозможен')
            }
            throw conflict()
        }
        if (res.status === 401) throw new HttpError(502, 'github_token_invalid', 'Токен GitHub недействителен — обнови его в секретах функции')
        if (res.status === 403) throw new HttpError(502, 'github_forbidden', 'У токена GitHub не хватает прав (нужны Contents: read/write и Actions: read)')
        if (!res.ok) throw new HttpError(502, 'github_error', `GitHub ответил ошибкой ${res.status}`)
        return { sha: created.sha, url: created.html_url, message }
    }

    // ── История и откат ────────────────────────────────────────────────

    const loadCommit = (sha: string) => ghJson<GhCommit>(`${repoPath()}/commits/${sha}`)

    async function history() {
        const list = await ghJson<GhCommit[]>(`${repoPath()}/commits?sha=${encodeURIComponent(env.branch)}&per_page=${HISTORY_SIZE}`)
        const details = await mapLimit(list, 6, (c) => loadCommit(c.sha))
        return {
            head: list[0]?.sha ?? null,
            commits: details.map((c) => ({
                sha: c.sha,
                message: firstLine(c.commit.message),
                date: c.commit.committer?.date ?? c.commit.author?.date ?? null,
                author: c.commit.author?.name ?? null,
                source: isAdminCommit(c.commit.message) ? 'admin' : 'code',
                files: (c.files ?? []).map((f) => ({ path: f.filename, status: f.status, previous: f.previous_filename ?? null }))
            }))
        }
    }

    async function readJsonAt(path: string, ref: string): Promise<unknown> {
        const text = await readFile(path, ref)
        return text === null ? null : parseJson(text, path)
    }

    async function buildRevert(body: Record<string, unknown>) {
        const sha = body.sha
        if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new HttpError(400, 'bad_request', 'Нужен sha коммита')
        const head = await headSha()
        const commit = await loadCommit(sha)
        const files = commit.files ?? []
        const parentSha = commit.parents[0]?.sha

        // Какие из затронутых файлов потом меняли более поздние коммиты.
        const touched = new Set(files.flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]))
        const laterChanges = new Map<string, { sha: string; message: string }[]>()
        if (sha !== head) {
            const cmp = await ghJson<{ commits: GhCommit[]; files?: CommitFileChange[] }>(`${repoPath()}/compare/${sha}...${head}`)
            const changed = new Set((cmp.files ?? []).flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]))
            if ([...touched].some((p) => changed.has(p))) {
                const later = await mapLimit(cmp.commits.slice(-100), 6, (c) => loadCommit(c.sha))
                for (const c of later) {
                    for (const f of c.files ?? []) {
                        for (const p of [f.filename, f.previous_filename]) {
                            if (!p || !touched.has(p)) continue
                            const list = laterChanges.get(p) ?? []
                            if (!list.some((x) => x.sha === c.sha)) list.push({ sha: c.sha, message: firstLine(c.commit.message) })
                            laterChanges.set(p, list)
                        }
                    }
                }
            }
        }

        // Дерево родителя: из него берутся sha blob — без повторной загрузки файлов.
        const parentTree = new Map<string, TreeItem>()
        if (parentSha) {
            const parent = await ghJson<{ tree: { sha: string } }>(`${repoPath()}/git/commits/${parentSha}`)
            const tree = await ghJson<{ tree: { path: string; type: string; sha: string; mode: string }[] }>(
                `${repoPath()}/git/trees/${parent.tree.sha}?recursive=1`
            )
            for (const e of tree.tree) if (e.type === 'blob') parentTree.set(e.path, { sha: e.sha, mode: e.mode })
        }

        const touchesReleases = files.some((f) => f.filename === RELEASES_PATH)
        const touchesSite = files.some((f) => f.filename === SITE_PATH)
        let releases: { head: unknown; parent: unknown } | undefined
        let site: { head: unknown; parent: unknown } | undefined
        let plays: Record<string, number> = {}
        let registryAfter: unknown
        if ((touchesReleases || touchesSite) && parentSha) {
            const headReleases = await readJsonAt(RELEASES_PATH, head)
            const headSite = await readJsonAt(SITE_PATH, head)
            if (touchesReleases) {
                releases = { head: headReleases, parent: await readJsonAt(RELEASES_PATH, parentSha) }
                const removed = removedReleaseIds(releases.head, releases.parent)
                if (removed.length) plays = await deps.playsFor(removed)
            }
            registryAfter = releases ? releases.parent : headReleases
            // site.json проверяется всегда, когда меняется реестр: промо может
            // указывать на релиз, который откат уберёт.
            site = { head: headSite, parent: touchesSite ? await readJsonAt(SITE_PATH, parentSha) : headSite }
        }

        const plan = planRevert({
            message: commit.commit.message,
            parentCount: commit.parents.length,
            files,
            parentTree,
            laterChanges,
            releases,
            site,
            plays,
            registryAfter
        })
        return { head, commit, plan }
    }

    async function revertPreview(body: Record<string, unknown>) {
        const { head, commit, plan } = await buildRevert(body)
        return {
            head,
            message: firstLine(commit.commit.message),
            revertMessage: revertMessage(commit.commit.message),
            ok: plan.ok,
            files: plan.files,
            conflicts: plan.conflicts,
            blocked: plan.blocked
        }
    }

    async function revert(body: Record<string, unknown>) {
        const baseSha = body.baseSha
        if (typeof baseSha !== 'string' || !SHA_RE.test(baseSha)) throw new HttpError(400, 'bad_request', 'Нужен baseSha')
        const { head, commit, plan } = await buildRevert(body)
        if (head !== baseSha) throw new HttpError(409, 'conflict', 'Данные на сайте изменились, пока ты смотрел историю. Обнови страницу и повтори откат.')
        if (!plan.ok) {
            const details = [
                ...plan.blocked,
                ...plan.conflicts.map((c) => `${c.path} позже менялся: ${c.commits.map((x) => `«${x.message}»`).join(', ')}`)
            ]
            throw new HttpError(422, 'revert_blocked', 'Откат невозможен', details.length ? details : ['Откатывать нечего'])
        }
        return writeCommit(head, revertMessage(commit.commit.message), plan.entries as TreeEntry[])
    }

    async function deployStatus(body: Record<string, unknown>) {
        const sha = body.sha
        if (typeof sha !== 'string' || !SHA_RE.test(sha)) throw new HttpError(400, 'bad_request', 'Нужен sha коммита')
        const data = await ghJson<{ workflow_runs: { status: string; conclusion: string | null; html_url: string }[] }>(
            `${repoPath()}/actions/workflows/${encodeURIComponent(env.workflow)}/runs?head_sha=${sha}&per_page=5`
        )
        const run = data.workflow_runs[0]
        if (!run) return { state: 'pending', url: null }
        if (run.status !== 'completed') return { state: 'pending', url: run.html_url }
        if (run.conclusion === 'success') return { state: 'published', url: run.html_url }
        // Деплой отменяется, когда следом пришёл новый коммит (concurrency
        // в workflow): опубликуется уже следующая версия.
        if (run.conclusion === 'cancelled') return { state: 'cancelled', url: run.html_url }
        return { state: 'failed', url: run.html_url }
    }

    // ── HTTP ───────────────────────────────────────────────────────────

    return async function handle(req: Request): Promise<Response> {
        const origin = req.headers.get('Origin')
        const cors = corsHeaders(origin)
        const json = (status: number, data: unknown) =>
            new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } })

        if (origin && !isAllowedOrigin(origin)) return json(403, { error: 'origin_forbidden', message: 'Запрос с чужого сайта' })
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
        if (req.method !== 'POST') return json(405, { error: 'method_not_allowed', message: 'Только POST' })

        try {
            const auth = req.headers.get('Authorization') || ''
            const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
            if (!jwt) throw new HttpError(401, 'unauthorized', 'Нужно войти')
            const user = await deps.getUser(jwt).catch(() => null)
            if (!user) throw new HttpError(401, 'unauthorized', 'Сессия истекла — войди заново')
            if (user.app_metadata?.role !== 'admin') throw new HttpError(403, 'forbidden', 'Нет доступа')

            let body: Record<string, unknown>
            try {
                body = (await req.json()) as Record<string, unknown>
            } catch {
                throw new HttpError(400, 'bad_request', 'Ожидается JSON')
            }
            if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_request', 'Ожидается JSON-объект')

            await cleanupStaging()

            switch (body.action) {
                case 'ping':
                    return json(200, await ping(user))
                case 'head':
                    return json(200, await head())
                case 'read':
                    return json(200, await read(body))
                case 'stage-blob':
                    return json(200, await stageBlob(body))
                case 'commit':
                    return json(200, await commit(body))
                case 'deploy-status':
                    return json(200, await deployStatus(body))
                case 'history':
                    return json(200, await history())
                case 'revert-preview':
                    return json(200, await revertPreview(body))
                case 'revert':
                    return json(200, await revert(body))
                default:
                    throw new HttpError(400, 'bad_request', 'Неизвестное действие')
            }
        } catch (e) {
            if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message, details: e.details })
            console.error(e)
            return json(500, { error: 'internal', message: 'Внутренняя ошибка функции' })
        }
    }
}
