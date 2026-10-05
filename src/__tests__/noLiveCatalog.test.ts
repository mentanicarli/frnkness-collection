import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Тесты не читают настоящий каталог: src/content/*.json, lyrics/, audio/,
 * images/, lyrics-books/ и дерево git меняются из админки, и тест,
 * завязанный на их содержимое, роняет деплой после обычной правки.
 * Для тестов есть фикстура tests/fixtures/catalog, а корректность
 * настоящего контента проверяет npm run check:content.
 */

const ROOT = path.resolve(__dirname, '../..')

const FORBIDDEN: [RegExp, string][] = [
    [/from\s+['"][^'"]*content\/(releases|site)\.json['"]/, 'импорт src/content/*.json'],
    [/import\(\s*['"][^'"]*content\/(releases|site)\.json['"]/, 'импорт src/content/*.json'],
    [/['"]git['"]\s*,\s*\[/, 'вызов git'],
    [/\bgit\s+(ls-tree|cat-file|show|log)\b/, 'вызов git'],
    [/(resolve|join)\([^)]*__dirname[^)]*['"](\.\.\/)*(lyrics|audio|images|lyrics-books|src\/content|content)['"]/, 'путь к настоящему каталогу'],
    [/(resolve|join)\(\s*ROOT\s*,\s*['"](lyrics|audio|images|lyrics-books|src\/content)\b/, 'путь к настоящему каталогу']
]

function testFiles(): string[] {
    const out: string[] = []
    const walk = (rel: string) => {
        for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
            const child = `${rel}/${e.name}`
            if (e.isDirectory()) {
                if (e.name !== 'node_modules') walk(child)
            } else if (/\.(test|spec)\.ts$/.test(e.name) || child === 'e2e/mocks.ts') out.push(child)
        }
    }
    walk('src')
    walk('e2e')
    return out
}

describe('тесты не зависят от настоящего каталога', () => {
    it('ни один тест не читает src/content, lyrics/, audio/, images/ и git', () => {
        const files = testFiles()
        expect(files.length).toBeGreaterThan(20)
        const violations: string[] = []
        for (const rel of files) {
            if (rel === 'src/__tests__/noLiveCatalog.test.ts') continue
            const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n')
            lines.forEach((line, i) => {
                for (const [re, what] of FORBIDDEN) if (re.test(line)) violations.push(`${rel}:${i + 1}: ${what}`)
            })
        }
        expect(violations).toEqual([])
    })

    it('сторож ловит типичные нарушения', () => {
        const bad = [
            "import releasesJson from '@/content/releases.json'",
            "const r = await import('../../content/site.json')",
            "execFileSync('git', ['ls-tree', '-r', 'HEAD'])",
            "fs.readFileSync(path.resolve(__dirname, '../../../../lyrics'))",
            "fs.readFileSync(path.join(ROOT, 'images/album4-cover.jpg'))"
        ]
        for (const line of bad) expect(FORBIDDEN.some(([re]) => re.test(line)), line).toBe(true)
        expect(FORBIDDEN.some(([re]) => re.test("{ path: 'src/content/releases.json', content: '{}' }"))).toBe(false)
    })
})
