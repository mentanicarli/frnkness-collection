/**
 * Имя PDF с текстами при скачивании: «frnk ness — <Название релиза> (тексты).pdf».
 *
 * Сам файл лежит под латинским именем (lyrics-books/<releaseId>.pdf), а
 * пользователю отдаём понятное. Символы, запрещённые в именах файлов
 * Windows/macOS, убираем сами, чтобы браузер не заменял их на «_»:
 * «/» становится « - », остальные просто выпадают.
 */
export function lyricsBookFilename(releaseTitle: string): string {
    const title = releaseTitle
        .replace(/\s*[/\\]\s*/g, ' - ')
        .replace(/[:*?"<>|]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    return `frnk ness — ${title} (тексты).pdf`
}
