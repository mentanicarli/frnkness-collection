// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { deployScope } from '../src/content-check/ciScope'

// Страницы превью создаёт сборка (vite.config.ts → scripts/previews.ts), поэтому
// «упрощённый» деплой, когда в main меняется только контент, обязан её запускать:
// иначе новый релиз из админки остался бы без превью.
const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/deploy-pages.yml'), 'utf8')

function step(name: string): string {
    const parts = workflow.split(/\n\s+- name: /)
    const found = parts.find((p) => p.startsWith(name))
    if (!found) throw new Error(`нет шага «${name}» в deploy-pages.yml`)
    return found
}

describe('деплой только с контентом тоже собирает превью', () => {
    it('коммит из админки (релизы, обложки, тексты) — режим content: без typecheck и тестов, но со сборкой', () => {
        const commit = [{ modified: ['src/content/releases.json'], added: ['images/new-cover.jpg', 'lyrics/new/01-x.txt'] }]
        expect(deployScope('push', commit)).toBe('content')
        // Шаг сборки не зависит от режима: нет условия `if`.
        expect(step('Build project')).not.toMatch(/\bif:/)
        expect(step('Build project')).toContain('npm run build')
        expect(step('Upload Pages artifact')).toContain('path: dist')
    })

    it('изменения генератора превью — полный режим со всеми проверками', () => {
        for (const file of ['scripts/previews.ts', 'vite.config.ts', 'index.html', 'public/og-default.png']) {
            expect(deployScope('push', [{ modified: [file] }]), file).toBe('full')
        }
    })
})
