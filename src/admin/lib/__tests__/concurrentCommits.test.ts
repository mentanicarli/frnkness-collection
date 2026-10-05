import { describe, it, expect, beforeEach } from 'vitest'
import { createHandler, type AuthUser } from '../../../../supabase/functions/admin-content/handler.ts'
import { commitUser, withCommitUser } from '../../../../supabase/functions/_shared/revert.ts'
import { fixtureReleases } from '../../../../tests/fixtures/catalog'
import { createFakeGit, FAKE_REPO } from './fakeGit'

/**
 * Два админа в админке одновременно: конфликт — только если сохраняемый
 * файл изменился в main после того, как его загрузили.
 */
const ANNA: AuthUser = { id: 'a', email: 'anna@example.com', app_metadata: { role: 'admin' } }
const BORIS: AuthUser = { id: 'b', email: 'boris@example.com', app_metadata: { role: 'admin' } }

let fake: ReturnType<typeof createFakeGit>
let handle: (req: Request) => Promise<Response>

beforeEach(() => {
    fake = createFakeGit({
        'src/content/releases.json': JSON.stringify(fixtureReleases(), null, 4),
        'src/content/site.json': JSON.stringify({ promo: { enabled: true, releaseId: 'zlaya-nostalgia' } }),
        'lyrics/singles/faaa.txt': 'Строка\n',
        'lyrics/album1/01-poopsicks.txt': 'Пупсики\n'
    })
    handle = createHandler({
        env: { githubToken: 't', repo: FAKE_REPO, branch: 'main', workflow: 'deploy-pages.yml', signingKey: 'k' },
        fetch: fake.fetch,
        getUser: async (jwt) => (jwt === 'anna' ? ANNA : BORIS),
        staging: { download: async () => null, remove: async () => undefined, list: async () => [] },
        toBase64: () => '',
        now: () => 0,
        sleep: async () => undefined,
        playsFor: async () => ({})
    })
})

async function save(who: 'anna' | 'boris', baseSha: string, files: { path: string; content: string }[], message = 'караоке') {
    const res = await handle(
        new Request('https://x/functions/v1/admin-content', {
            method: 'POST',
            headers: { Authorization: `Bearer ${who}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'commit', baseSha, message, files })
        })
    )
    return { status: res.status, data: await res.json() }
}

const FAAA = 'lyrics/singles/faaa.lrc'
const POOP = 'lyrics/album1/01-poopsicks.lrc'

describe('параллельные сохранения', () => {
    it('два .lrc разных треков с одной базы — проходят оба, второй ложится поверх первого', async () => {
        const base = fake.git.head
        const a = await save('anna', base, [{ path: FAAA, content: '[00:01.00]Строка\n' }], 'караоке «FAAA»')
        const b = await save('boris', base, [{ path: POOP, content: '[00:02.00]Пупсики\n' }], 'караоке «Пупсики»')
        expect(a.status).toBe(200)
        expect(b.status).toBe(200)
        expect(fake.git.head).toBe(b.data.sha)
        expect(fake.git.snap(b.data.sha).parent).toBe(a.data.sha)
        expect(fake.git.files()[FAAA]).toBe('[00:01.00]Строка\n')
        expect(fake.git.files()[POOP]).toBe('[00:02.00]Пупсики\n')
    })

    it('один и тот же файл — второе сохранение получает конфликт с тем, кто и что изменил', async () => {
        const base = fake.git.head
        expect((await save('anna', base, [{ path: FAAA, content: '[00:01.00]Строка\n' }], 'караоке «FAAA»')).status).toBe(200)
        const writesBefore = fake.git.writes.length
        const b = await save('boris', base, [{ path: FAAA, content: '[00:05.00]Строка\n' }])
        expect(b.status).toBe(409)
        expect(b.data.error).toBe('conflict')
        expect(b.data.conflicts).toEqual([
            { path: FAAA, commits: [expect.objectContaining({ message: 'admin: караоке «FAAA»', user: 'anna@example.com' })] }
        ])
        expect(b.data.details).toEqual([`${FAAA} (anna@example.com)`])
        expect(b.data.head).toBe(fake.git.head)
        // Ничего не записано, файл Анны цел.
        expect(fake.git.writes.length).toBe(writesBefore)
        expect(fake.git.files()[FAAA]).toBe('[00:01.00]Строка\n')
    })

    it('конфликт по любому файлу коммита, даже если остальные не менялись', async () => {
        const base = fake.git.head
        fake.git.commit('admin: текст', (f) => (f['lyrics/singles/faaa.txt'] = 'Другая строка\n'))
        const r = await save('boris', base, [
            { path: FAAA, content: '[00:01.00]Строка\n' },
            { path: 'lyrics/singles/faaa.txt', content: 'Строка\n' }
        ])
        expect(r.status).toBe(409)
        expect(r.data.conflicts.map((c: { path: string }) => c.path)).toEqual(['lyrics/singles/faaa.txt'])
    })

    it('гонка между проверкой и записью — повтор поверх новой вершины, без ошибки', async () => {
        const base = fake.git.head
        fake.git.beforePatch = () => fake.git.commit('admin: промо', (f) => (f['src/content/site.json'] = JSON.stringify({ promo: { enabled: false, releaseId: 'faaa' } })))
        const r = await save('anna', base, [{ path: FAAA, content: '[00:01.00]Строка\n' }])
        expect(r.status).toBe(200)
        expect(fake.git.files()[FAAA]).toBe('[00:01.00]Строка\n')
        expect(JSON.parse(fake.git.files()['src/content/site.json']).promo.enabled).toBe(false)
    })

    it('гонка по тому же файлу — конфликт, чужая правка не перезаписана', async () => {
        const base = fake.git.head
        fake.git.beforePatch = () => fake.git.commit('admin: караоке чужое', (f) => (f[FAAA] = '[00:09.00]Чужое\n'))
        const r = await save('anna', base, [{ path: FAAA, content: '[00:01.00]Строка\n' }])
        expect(r.status).toBe(409)
        expect(fake.git.files()[FAAA]).toBe('[00:09.00]Чужое\n')
    })

    it('устаревшая вершина ветки сразу после коммита — не конфликт: ждём и читаем заново', async () => {
        const first = await save('anna', fake.git.head, [{ path: FAAA, content: '[00:01.00]Строка\n' }])
        // Браузер уже знает новый sha, а GitHub ещё пару раз отдаёт прошлый.
        fake.git.staleHead = fake.git.snap(first.data.sha).parent
        fake.git.staleHeadReads = 2
        const second = await save('anna', first.data.sha, [{ path: FAAA, content: '[00:01.50]Строка\n' }])
        expect(second.status).toBe(200)
        expect(fake.git.files()[FAAA]).toBe('[00:01.50]Строка\n')
    })

    it('проверки реестра — на актуальном main: чужой новый релиз не ломает промо', async () => {
        const base = fake.git.head
        fake.git.commit('admin: новый релиз', (f) => {
            const reg = JSON.parse(f['src/content/releases.json'])
            reg['new-one'] = { ...reg.faaa }
            f['src/content/releases.json'] = JSON.stringify(reg, null, 4)
        })
        const r = await save('boris', base, [{ path: 'src/content/site.json', content: JSON.stringify({ promo: { enabled: true, releaseId: 'new-one' } }) }])
        expect(r.status).toBe(200)
    })
})

describe('автор правки', () => {
    it('email вошедшего — строкой Admin-User в сообщении коммита', async () => {
        const r = await save('boris', fake.git.head, [{ path: FAAA, content: '[00:01.00]Строка\n' }], 'караоке «FAAA»')
        expect(r.data.message).toBe('admin: караоке «FAAA»')
        expect(fake.git.snap(r.data.sha).message).toBe('admin: караоке «FAAA»\n\nAdmin-User: boris@example.com')
    })

    it('история показывает, кто сделал правку', async () => {
        await save('anna', fake.git.head, [{ path: FAAA, content: '[00:01.00]Строка\n' }], 'караоке «FAAA»')
        const res = await handle(
            new Request('https://x/functions/v1/admin-content', {
                method: 'POST',
                headers: { Authorization: 'Bearer anna', 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'history' })
            })
        )
        const data = await res.json()
        expect(data.commits[0]).toMatchObject({ message: 'admin: караоке «FAAA»', user: 'anna@example.com' })
        expect(data.commits[1].user).toBeNull()
    })

    it('трейлер: запись и чтение', () => {
        expect(withCommitUser('admin: x', 'a@b.c')).toBe('admin: x\n\nAdmin-User: a@b.c')
        expect(withCommitUser('admin: x', null)).toBe('admin: x')
        expect(withCommitUser('admin: x', 'a@b.c\nAdmin-User: evil')).toBe('admin: x\n\nAdmin-User: a@b.cAdmin-User: evil')
        expect(commitUser('admin: x\n\nAdmin-User: a@b.c')).toBe('a@b.c')
        expect(commitUser('feat: код')).toBeNull()
    })
})
