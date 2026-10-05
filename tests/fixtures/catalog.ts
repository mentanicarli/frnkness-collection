import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Releases, SiteSettings } from '../../src/types'

/**
 * Фикстурный каталог для тестов: копия структуры репозитория в
 * tests/fixtures/catalog (реестр, site.json, тексты, разборы, .lrc, mp3 с
 * тишиной, обложки, PDF-заглушки). Тесты проверяют поведение кода на нём,
 * а не содержимое настоящего каталога — тот меняется из админки, и
 * корректность реального контента проверяет npm run check:content.
 *
 * Состав фикстуры (заморожен, менять только вместе с тестами):
 *   most-venture-poopsicks — альбом, 3 трека, PDF, у всех треков .lrc
 *   disinvolto             — сингл с PDF и видео
 *   six-senses-pupsiks     — альбом, 2 трека, без PDF
 *   boxik, faaa            — синглы без PDF, faaa — single6 (следующий single7)
 *   born-to-be-deluxe      — альбом в «audio/album 3/», mp3 с пробелами,
 *                            у ZAL нет .lrc, у COMЁ N TEAM нет разборов
 *   zlaya-nostalgia        — альбом 4 (следующий album5), 7 треков, промо
 */
export const FIXTURE_ROOT = path.resolve(__dirname, 'catalog')
export const FIXTURE_UPLOADS = path.resolve(__dirname, 'uploads')

/** Текст файла фикстуры (переводы строк — \n) или null, если файла нет. */
export function fixtureText(rel: string): string | null {
    const full = path.join(FIXTURE_ROOT, rel)
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8').replace(/\r\n?/g, '\n') : null
}

/** Свежая копия реестра: тесты могут её менять. */
export function fixtureReleases(): Releases {
    return JSON.parse(fixtureText('src/content/releases.json')!) as Releases
}

export function fixtureSite(): SiteSettings {
    return JSON.parse(fixtureText('src/content/site.json')!) as SiteSettings
}

/** Дерево фикстуры с размерами — как его отдаёт GitHub (пути через «/»). */
export function fixtureTree(): { path: string; size: number }[] {
    const out: { path: string; size: number }[] = []
    const walk = (rel: string) => {
        for (const e of fs.readdirSync(path.join(FIXTURE_ROOT, rel), { withFileTypes: true })) {
            const child = rel ? `${rel}/${e.name}` : e.name
            if (e.isDirectory()) walk(child)
            else out.push({ path: child, size: fs.statSync(path.join(FIXTURE_ROOT, child)).size })
        }
    }
    walk('')
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** Копия фикстуры во временной папке — для тестов, которые меняют файлы. */
export function copyFixture(): string {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'frnk-catalog-'))
    fs.cpSync(FIXTURE_ROOT, dir, { recursive: true })
    return dir
}
