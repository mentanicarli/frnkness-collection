/**
 * Модель git и GitHub API в памяти — для тестов параллельных коммитов
 * функции admin-content. Коммиты хранят снимки файлов; дерево, коммит и
 * перенос ветки работают как в GitHub: PATCH ref без force отклоняется,
 * если новый коммит не продолжает текущую вершину. Сеть не используется.
 */

export interface Snapshot {
    sha: string
    parent: string | null
    message: string
    files: Record<string, string>
}

export const FAKE_REPO = 'mentanicarli/frnkness-collection'

export function blobSha(content: string): string {
    let h = 2166136261
    for (let i = 0; i < content.length; i++) h = Math.imul(h ^ content.charCodeAt(i), 16777619) >>> 0
    return h.toString(16).padStart(40, 'b')
}

export function createFakeGit(initial: Record<string, string>) {
    let seq = 0
    const nextSha = (prefix: string) => (++seq).toString(16).padStart(40, prefix)
    const commits = new Map<string, Snapshot>()
    const trees = new Map<string, Record<string, string>>()
    const blobs = new Map<string, string>()
    const root: Snapshot = { sha: nextSha('c'), parent: null, message: 'init', files: { ...initial } }
    commits.set(root.sha, root)

    const git = {
        head: root.sha,
        writes: [] as { method: string; path: string; body: any }[],
        /** Перед PATCH ветки — вклинить чужой коммит (гонка между чтением и записью). */
        beforePatch: null as null | (() => void),
        /** Сколько раз подряд отдавать устаревшую вершину ветки (как реплика GitHub после коммита). */
        staleHeadReads: 0,
        staleHead: null as string | null,
        snap: (sha: string) => commits.get(sha)!,
        files: () => commits.get(git.head)!.files,
        /** Коммит «от другого человека» прямо в main. */
        commit(message: string, change: (files: Record<string, string>) => void): string {
            const prev = commits.get(git.head)!
            const files = { ...prev.files }
            change(files)
            const snap = { sha: nextSha('c'), parent: prev.sha, message, files }
            commits.set(snap.sha, snap)
            git.head = snap.sha
            return snap.sha
        }
    }

    function ancestors(sha: string): string[] {
        const out: string[] = []
        for (let c = commits.get(sha); c; c = c.parent ? commits.get(c.parent) : undefined) out.push(c.sha)
        return out
    }

    function diff(a: Record<string, string>, b: Record<string, string>) {
        const out: { filename: string; status: string }[] = []
        for (const p of Object.keys(b)) {
            if (!(p in a)) out.push({ filename: p, status: 'added' })
            else if (a[p] !== b[p]) out.push({ filename: p, status: 'modified' })
        }
        for (const p of Object.keys(a)) if (!(p in b)) out.push({ filename: p, status: 'removed' })
        return out
    }

    const ghCommit = (c: Snapshot) => ({
        sha: c.sha,
        commit: { message: c.message, author: { name: 'bot', date: '2026-10-05T10:00:00Z' }, committer: { date: '2026-10-05T10:00:00Z' } },
        parents: c.parent ? [{ sha: c.parent }] : [],
        files: diff(c.parent ? commits.get(c.parent)!.files : {}, c.files)
    })

    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        const method = init?.method || 'GET'
        const path = decodeURIComponent(url.pathname)
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
        const r = `/repos/${FAKE_REPO}`
        if (method !== 'GET') git.writes.push({ method, path, body })

        if (path === r) return json({ full_name: FAKE_REPO, default_branch: 'main' })
        if (path === `${r}/git/ref/heads/main`) {
            if (git.staleHeadReads > 0 && git.staleHead) {
                git.staleHeadReads--
                return json({ object: { sha: git.staleHead } })
            }
            return json({ object: { sha: git.head } })
        }
        if (method === 'GET' && path === `${r}/commits`) {
            const p = url.searchParams.get('path')
            const from = url.searchParams.get('sha')
            let list = ancestors(!from || from === 'main' ? git.head : from).map((s) => commits.get(s)!)
            if (p) list = list.filter((c) => (c.parent ? commits.get(c.parent)!.files[p] : undefined) !== c.files[p])
            return json(list.slice(0, Number(url.searchParams.get('per_page') || 30)).map(ghCommit))
        }
        if (method === 'GET' && path.startsWith(`${r}/commits/`)) return json(ghCommit(commits.get(path.split('/').pop()!)!))
        if (method === 'GET' && path.startsWith(`${r}/compare/`)) {
            const [base, to] = path.slice(`${r}/compare/`.length).split('...')
            const toAnc = ancestors(to)
            const baseAnc = ancestors(base)
            let status = 'diverged'
            if (base === to) status = 'identical'
            else if (toAnc.includes(base)) status = 'ahead'
            else if (baseAnc.includes(to)) status = 'behind'
            const between = status === 'ahead' ? toAnc.slice(0, toAnc.indexOf(base)).reverse() : []
            return json({
                status,
                commits: between.map((s) => ghCommit(commits.get(s)!)),
                files: status === 'ahead' ? diff(commits.get(base)!.files, commits.get(to)!.files) : []
            })
        }
        if (method === 'GET' && path.startsWith(`${r}/git/commits/`)) return json({ tree: { sha: 'tree-' + path.split('/').pop() } })
        if (method === 'GET' && path.startsWith(`${r}/git/trees/`)) {
            const id = path.split('/').pop()!
            const files = id.startsWith('tree-') ? commits.get(id.slice(5))!.files : trees.get(id)!
            return json({ truncated: false, tree: Object.entries(files).map(([p, c]) => ({ path: p, type: 'blob', mode: '100644', sha: blobSha(c), size: c.length })) })
        }
        if (method === 'GET' && path.startsWith(`${r}/contents/`)) {
            const file = path.slice(`${r}/contents/`.length)
            const files = commits.get(url.searchParams.get('ref')!)!.files
            return file in files ? new Response(files[file]) : json({ message: 'Not Found' }, 404)
        }
        if (method === 'POST' && path === `${r}/git/blobs`) {
            const s = nextSha('b')
            blobs.set(s, 'blob')
            return json({ sha: s })
        }
        if (method === 'POST' && path === `${r}/git/trees`) {
            const baseId: string = body.base_tree
            const files = { ...(baseId.startsWith('tree-') ? commits.get(baseId.slice(5))!.files : trees.get(baseId)!) }
            for (const e of body.tree) {
                if (e.sha === null) delete files[e.path]
                else files[e.path] = e.content ?? blobs.get(e.sha) ?? `blob:${e.sha}`
            }
            const id = nextSha('d')
            trees.set(id, files)
            return json({ sha: id })
        }
        if (method === 'POST' && path === `${r}/git/commits`) {
            const s = nextSha('e')
            commits.set(s, { sha: s, parent: body.parents[0], message: body.message, files: trees.get(body.tree)! })
            return json({ sha: s, html_url: `https://github.com/${FAKE_REPO}/commit/${s}` })
        }
        if (method === 'PATCH' && path === `${r}/git/refs/heads/main`) {
            git.beforePatch?.()
            git.beforePatch = null
            const next = commits.get(body.sha)!
            if (!body.force && next.parent !== git.head) return json({ message: 'Update is not a fast forward' }, 422)
            git.head = body.sha
            return json({ object: { sha: body.sha } })
        }
        return json({ message: 'unexpected ' + method + ' ' + path }, 500)
    }) as typeof globalThis.fetch

    return { git, fetch }
}
