// npm run check:content [папка] — проверка контента репозитория (см.
// src/content-check/checkContent.ts). Без аргумента проверяет текущую папку.
import path from 'node:path'
import { checkContent } from '../src/content-check/checkContent'

const root = path.resolve(process.argv[2] ?? '.')
const { errors, stats } = checkContent(root)
const summary = `релизов: ${stats.releases}, треков: ${stats.tracks}, разборов: ${stats.notes}, .lrc: ${stats.lrc}`

if (errors.length) {
    console.error(`check-content: ${errors.length} ошибок (${summary})`)
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
}
console.log(`check-content: ок — ${summary}`)
