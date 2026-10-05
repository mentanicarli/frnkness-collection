// Шаг деплоя: content — пуш меняет только контент, full — всё остальное.
// Событие берётся из переменных окружения, результат — в GITHUB_OUTPUT.
import fs from 'node:fs'
import { changedPaths, deployScope, type PushCommit } from '../src/content-check/ciScope'

const event = process.env.EVENT_NAME ?? ''
let commits: unknown = null
try {
    commits = JSON.parse(process.env.COMMITS || 'null')
} catch {
    commits = null
}

const scope = deployScope(event, commits)
const paths = Array.isArray(commits) ? changedPaths(commits as PushCommit[]) : []
console.log(`scope: ${scope} (событие ${event || '—'}, коммитов ${Array.isArray(commits) ? commits.length : '—'}, файлов ${paths.length})`)
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`)
