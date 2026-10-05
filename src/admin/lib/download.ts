/** Отдать текст браузеру как файл — «скачать свой вариант» при конфликте. */
export function downloadText(path: string, content: string) {
    const name = path.split('/').pop() || 'file.txt'
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}
