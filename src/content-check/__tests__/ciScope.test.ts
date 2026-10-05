import { describe, it, expect } from 'vitest'
import { deployScope } from '../ciScope'

const push = (...files: string[][]) => files.map((modified) => ({ added: [], modified, removed: [] }))

describe('deployScope', () => {
    it('правки из админки — только контент', () => {
        expect(deployScope('push', push(['lyrics/singles/faaa.txt', 'lyrics/singles/faaa.notes.json']))).toBe('content')
        expect(deployScope('push', push(['src/content/releases.json', 'src/content/site.json'], ['images/single7-cover.jpg']))).toBe('content')
        expect(
            deployScope('push', [{ added: ['audio/album6/x.mp3', 'lyrics/album6/01-x.txt', 'lyrics-books/x.pdf'], modified: [], removed: ['images/old.jpg'] }])
        ).toBe('content')
    })

    it('код рядом с контентом — полный набор проверок', () => {
        expect(deployScope('push', push(['lyrics/singles/faaa.txt'], ['src/config.ts']))).toBe('full')
        expect(deployScope('push', push(['src/content/releases.ts']))).toBe('full')
        expect(deployScope('push', push(['src/content/sub/x.json']))).toBe('full')
        expect(deployScope('push', push(['.github/workflows/deploy-pages.yml']))).toBe('full')
        expect(deployScope('push', push(['package.json']))).toBe('full')
        expect(deployScope('push', push(['tests/fixtures/catalog/lyrics/singles/faaa.txt']))).toBe('full')
    })

    it('список файлов неизвестен — полный набор', () => {
        expect(deployScope('workflow_dispatch', push(['lyrics/a.txt']))).toBe('full')
        expect(deployScope('push', null)).toBe('full')
        expect(deployScope('push', [])).toBe('full')
        expect(deployScope('push', push([]))).toBe('full')
        expect(deployScope('push', Array.from({ length: 20 }, () => ({ modified: ['lyrics/a.txt'] })))).toBe('full')
    })
})
