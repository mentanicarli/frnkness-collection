import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { Releases, SiteSettings } from '@/types'
import { findDanglingAnnotations } from '@/utils/trackNotes'
import { checkContent } from '../checkContent'
import { serializeReleases, serializeSite } from '@/admin/lib/content'
import { appendRelease, nextNumber, planRelease, validateDraft, type ReleaseDraft } from '@/admin/lib/newRelease'
import { formFromRelease, planEdit } from '@/admin/lib/editRelease'
import { parseNotes, removeNote, serializeNotes, setNote } from '@/admin/lib/notesEdit'
import { buildLrc, linesFromTxt } from '@/admin/lib/lrc'
import { copyFixture } from '../../../tests/fixtures/catalog'

/**
 * Регрессия «деплой упал после правки в админке»: на копии каталога
 * повторяем то, что делает админка (теми же функциями, что и она), и
 * проверяем, что контент остаётся корректным для npm run check:content.
 * Ни один тест не должен зависеть от того, что именно лежит в каталоге, —
 * это отдельно сторожит noLiveCatalog.test.ts.
 */

const root = copyFixture()
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

const full = (rel: string) => path.join(root, rel)
const read = (rel: string) => (fs.existsSync(full(rel)) ? fs.readFileSync(full(rel), 'utf8').replace(/\r\n?/g, '\n') : null)
const write = (rel: string, data: string | Buffer) => {
    fs.mkdirSync(path.dirname(full(rel)), { recursive: true })
    fs.writeFileSync(full(rel), data)
}
const remove = (rel: string) => fs.rmSync(full(rel))
const tree = () => {
    const out: { path: string }[] = []
    const walk = (rel: string) => {
        for (const e of fs.readdirSync(full(rel), { withFileTypes: true })) {
            const child = rel ? `${rel}/${e.name}` : e.name
            if (e.isDirectory()) walk(child)
            else out.push({ path: child })
        }
    }
    walk('')
    return out
}
const releases = () => JSON.parse(read('src/content/releases.json')!) as Releases
const site = () => JSON.parse(read('src/content/site.json')!) as SiteSettings
// Байты медиа в каталоге не проверяются — только наличие и непустота.
const MP3 = fs.readFileSync(full('audio/singles/faaa.mp3'))
const JPG = fs.readFileSync(full('images/album4-cover.jpg'))
const PDF = '%PDF-1.4 test\n'
const TODAY = '2026-10-03'

/** «Опубликовать» новый релиз: реестр, промо, пустые тексты, медиа. */
function publishRelease(draft: ReleaseDraft, promo: boolean) {
    expect(validateDraft(draft, releases(), tree())).toEqual([])
    const plan = planRelease(draft, releases(), tree())
    write('src/content/releases.json', serializeReleases(appendRelease(releases(), plan)))
    if (promo) write('src/content/site.json', serializeSite({ ...site(), promo: { enabled: true, releaseId: plan.id } }))
    write(plan.paths.cover, JPG)
    if (plan.paths.pdf) write(plan.paths.pdf, PDF)
    for (const t of plan.paths.tracks) {
        write(t.audio, MP3)
        write(t.txt, '')
    }
    return plan
}

const track = (title: string, slug: string) => ({ title, slug, audio: { name: `${slug}.mp3`, size: MP3.length } })
const cover = { name: 'c.jpg', size: JPG.length, width: 1254, height: 1254 }

describe('действия админки сохраняют каталог корректным', () => {
    it('новый альбом с промо и PDF', () => {
        const n = nextNumber('album', releases(), tree())
        const plan = publishRelease(
            { type: 'album', title: 'Тестовый альбом', id: 'testovy-albom', date: '2026-10-15', cover, youtube: '', pdf: { name: 'b.pdf', size: 20 }, tracks: [track('Первый', 'pervy'), track('Второй', 'vtoroy')] },
            true
        )
        expect(plan.release.audioPath).toBe(`audio/album${n}/`)
        expect(nextNumber('album', releases(), tree())).toBe(n + 1)
        expect(checkContent(root).errors).toEqual([])
    })

    it('новый сингл с видео', () => {
        const n = nextNumber('single', releases(), tree())
        const plan = publishRelease(
            { type: 'single', title: 'Тестовый сингл', id: 'testovy-singl', date: '2026-10-20', cover, youtube: 'https://youtu.be/vI_8FLsAn50', pdf: null, tracks: [track('Тестовый сингл', 'testovy-singl')] },
            false
        )
        expect(plan.release.cover).toBe(`images/single${n}-cover.jpg`)
        expect(checkContent(root).errors).toEqual([])
    })

    it('текст нового трека и разбор строки', () => {
        const r = releases()['testovy-albom']
        const txt = `${r.lyricsPath}${r.tracks[0].lyricsFile}`
        write(txt, '[Куплет 1]\nПервая строка\nВторая строка\n')
        const notesPath = txt.replace(/\.txt$/, '.notes.json')
        const { notes } = parseNotes(read(notesPath))
        write(notesPath, serializeNotes({ about: 'О треке', annotations: setNote(notes.annotations ?? [], 'Первая строка', 'Разбор') }))
        expect(checkContent(root).errors).toEqual([])
    })

    it('караоке: .lrc из строк текста', () => {
        const r = releases()['testovy-albom']
        const txt = `${r.lyricsPath}${r.tracks[0].lyricsFile}`
        const lines = linesFromTxt(read(txt)!).map((text, i) => ({ text, time: 1.5 + i * 2 }))
        write(txt.replace(/\.txt$/, '.lrc'), buildLrc(lines))
        expect(checkContent(root).errors).toEqual([])
    })

    it('правка текста: висящий разбор удаляется тем же сохранением', () => {
        const r = releases()['testovy-albom']
        const txt = `${r.lyricsPath}${r.tracks[0].lyricsFile}`
        const notesPath = txt.replace(/\.txt$/, '.notes.json')
        const nextText = '[Куплет 1]\nНовая первая строка\nВторая строка\n'
        let { notes } = parseNotes(read(notesPath))
        // Админка не даёт сохранить текст, пока висящие разборы не убраны.
        for (const a of findDanglingAnnotations(nextText, notes)) notes = { ...notes, annotations: removeNote(notes.annotations ?? [], a.line) }
        write(txt, nextText)
        write(notesPath, serializeNotes(notes))
        // .lrc не совпадает с новым текстом — это не ошибка контента, а повод пересинхронизировать.
        expect(checkContent(root).errors).toEqual([])
    })

    it('анонс в site.json со своей обложкой', () => {
        write('images/announce-skoro-20261003.jpg', JPG)
        write(
            'src/content/site.json',
            serializeSite({ ...site(), announce: { enabled: true, title: 'Скоро', cover: 'images/announce-skoro-20261003.jpg', releaseAt: '2026-11-01T18:00:00+03:00', text: 'Пресейв' } })
        )
        expect(checkContent(root).errors).toEqual([])
    })

    it('правка релиза: новая обложка и PDF, старые файлы удаляются', () => {
        for (const id of ['zlaya-nostalgia', 'faaa']) {
            const before = releases()
            const form = { ...formFromRelease(before[id]), newCover: { ext: 'jpg' as const }, pdf: 'replace' as const }
            const plan = planEdit(before, id, form, tree(), TODAY)
            expect(plan.errors).toEqual([])
            write('src/content/releases.json', serializeReleases(plan.next))
            for (const u of plan.uploads) write(u.path, u.kind === 'pdf' ? PDF : JPG)
            plan.deletes.forEach(remove)
        }
        expect(checkContent(root).errors).toEqual([])
    })

    it('итог: в каталоге оба новых релиза, промо на альбоме', () => {
        expect(Object.keys(releases()).slice(-2)).toEqual(['testovy-albom', 'testovy-singl'])
        expect(site().promo.releaseId).toBe('testovy-albom')
        expect(checkContent(root).errors).toEqual([])
    })
})
