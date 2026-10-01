import { describe, it, expect } from 'vitest'
import releasesJson from '@/content/releases.json'
import {
    planRevert,
    playsForRelease,
    removedReleaseIds,
    revertMessage,
    type RevertInput,
    type TreeItem
} from '../../../../supabase/functions/_shared/revert.ts'

const sha = (n: number) => n.toString(16).padStart(40, '0')
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const registry = releasesJson as Record<string, unknown>

function input(over: Partial<RevertInput> = {}): RevertInput {
    return {
        message: 'admin: текст «FAAA» (FAAA)',
        parentCount: 1,
        files: [{ filename: 'lyrics/singles/faaa.txt', status: 'modified' }],
        parentTree: new Map<string, TreeItem>([
            ['lyrics/singles/faaa.txt', { sha: sha(1), mode: '100644' }],
            ['images/single6-cover.jpg', { sha: sha(2), mode: '100644' }],
            ['src/content/releases.json', { sha: sha(3), mode: '100644' }],
            ['src/content/site.json', { sha: sha(4), mode: '100644' }]
        ]),
        laterChanges: new Map(),
        ...over
    }
}

describe('planRevert', () => {
    it('изменённый файл возвращается к blob родителя', () => {
        const plan = planRevert(input())
        expect(plan.ok).toBe(true)
        expect(plan.files).toEqual([{ path: 'lyrics/singles/faaa.txt', action: 'restore' }])
        expect(plan.entries).toEqual([{ path: 'lyrics/singles/faaa.txt', mode: '100644', type: 'blob', sha: sha(1) }])
    })

    it('добавленный правкой файл удаляется, удалённый — восстанавливается (без повторной загрузки)', () => {
        const plan = planRevert(
            input({
                files: [
                    { filename: 'images/single6-cover-20261002.jpg', status: 'added' },
                    { filename: 'images/single6-cover.jpg', status: 'removed' }
                ]
            })
        )
        expect(plan.entries).toEqual([
            { path: 'images/single6-cover-20261002.jpg', mode: '100644', type: 'blob', sha: null },
            { path: 'images/single6-cover.jpg', mode: '100644', type: 'blob', sha: sha(2) }
        ])
        expect(plan.files.map((f) => f.action)).toEqual(['delete', 'recreate'])
    })

    it('только правки из админки', () => {
        const plan = planRevert(input({ message: 'feat: что-то из кода' }))
        expect(plan.ok).toBe(false)
        expect(plan.blocked).toEqual(['Откатить можно только правку из админки'])
    })

    it('файлы, изменённые позже, — откат не делается, видно какими коммитами', () => {
        const later = new Map([['lyrics/singles/faaa.txt', [{ sha: sha(9), message: 'admin: текст «FAAA» ещё раз' }]]])
        const plan = planRevert(input({ laterChanges: later }))
        expect(plan.ok).toBe(false)
        expect(plan.conflicts).toEqual([{ path: 'lyrics/singles/faaa.txt', commits: [{ sha: sha(9), message: 'admin: текст «FAAA» ещё раз' }] }])
    })

    it('откат добавления релиза без прослушиваний — можно', () => {
        const head = { ...clone(registry), 'novyy-singl': clone(registry.faaa) }
        const plan = planRevert(
            input({
                message: 'admin: новый сингл «Новый»',
                files: [{ filename: 'src/content/releases.json', status: 'modified' }],
                releases: { head, parent: clone(registry) },
                plays: { 'novyy-singl': 0 }
            })
        )
        expect(plan.blocked).toEqual([])
        expect(plan.ok).toBe(true)
    })

    it('откат добавления релиза с прослушиваниями — отказ с объяснением', () => {
        const head = { ...clone(registry), 'novyy-singl': clone(registry.faaa) }
        const plan = planRevert(
            input({
                files: [{ filename: 'src/content/releases.json', status: 'modified' }],
                releases: { head, parent: clone(registry) },
                plays: { 'novyy-singl': 12 }
            })
        )
        expect(plan.ok).toBe(false)
        expect(plan.blocked[0]).toContain('у которого уже 12 прослушиваний')
    })

    it('откат правки существующего релиза (название, обложка) — можно', () => {
        const head = clone(registry) as Record<string, Record<string, unknown>>
        head.faaa.title = 'FAAA (remaster)'
        head.faaa.cover = 'images/single6-cover-20261002.jpg'
        const plan = planRevert(input({ files: [{ filename: 'src/content/releases.json', status: 'modified' }], releases: { head, parent: clone(registry) } }))
        expect(plan.blocked).toEqual([])
    })

    it('промо, указывающее на убираемый релиз, — откат блокируется', () => {
        const head = { ...clone(registry), 'novyy-singl': clone(registry.faaa) }
        const site = { promo: { enabled: true, releaseId: 'novyy-singl' } }
        const plan = planRevert(
            input({
                files: [{ filename: 'src/content/releases.json', status: 'modified' }],
                releases: { head, parent: clone(registry) },
                plays: { 'novyy-singl': 0 },
                // site.json правкой не менялся, но он ссылается на релиз — проверяем текущий.
                site: { head: site, parent: site },
                registryAfter: clone(registry)
            })
        )
        expect(plan.blocked.join()).toContain('promo.releaseId должен быть id существующего релиза')
    })

    it('src/content/*.json не удаляется', () => {
        const plan = planRevert(input({ files: [{ filename: 'src/content/site.json', status: 'added' }] }))
        expect(plan.blocked).toEqual(['Откат удалил бы src/content/site.json — так нельзя'])
    })

    it('переименование: новое имя удаляется, старое возвращается', () => {
        const plan = planRevert(input({ files: [{ filename: 'images/new.jpg', status: 'renamed', previous_filename: 'images/single6-cover.jpg' }] }))
        expect(plan.entries.map((e) => [e.path, e.sha])).toEqual([
            ['images/new.jpg', null],
            ['images/single6-cover.jpg', sha(2)]
        ])
    })
})

describe('вспомогательное', () => {
    it('сообщение отката', () => {
        expect(revertMessage('admin: текст «FAAA» (FAAA)')).toBe('admin: откат «текст «FAAA» (FAAA)»')
        expect(revertMessage('admin: ' + 'x'.repeat(300)).length).toBeLessThanOrEqual(200)
    })

    it('убираемые релизы и их прослушивания (оба формата ключа)', () => {
        expect(removedReleaseIds({ a: 1, b: 2 }, { a: 1 })).toEqual(['b'])
        const rows = [
            { track_key: 'novyy-0', plays: 3 },
            { track_key: 'novyy--1', plays: 2 },
            { track_key: 'novyy-2-0', plays: 100 },
            { track_key: 'other-0', plays: 7 }
        ]
        expect(playsForRelease('novyy', rows)).toBe(5)
        expect(playsForRelease('novyy-2', rows)).toBe(100)
    })
})
