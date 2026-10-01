import { COVER_MAX_BYTES, COVER_MIN_SIDE } from './newRelease'

export interface ImageInfo {
    width: number
    height: number
    /** object URL для превью; освободить через URL.revokeObjectURL. */
    url: string
}

/** Размеры картинки из файла (через <img>, без загрузки на сервер). */
export function readImage(file: File): Promise<ImageInfo> {
    const url = URL.createObjectURL(file)
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, url })
        img.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('Файл не открывается как изображение'))
        }
        img.src = url
    })
}

/** Ошибки обложки: jpg/png, квадрат (±1%), от 600px, до 5 МБ. */
export function coverErrors(file: File, info: { width: number; height: number }, allowPng = false): string[] {
    const errors: string[] = []
    const okType = /\.jpe?g$/i.test(file.name) || file.type === 'image/jpeg' || (allowPng && (/\.png$/i.test(file.name) || file.type === 'image/png'))
    if (!okType) errors.push(allowPng ? 'Нужен jpg или png' : 'Нужен jpg')
    if (Math.abs(info.width - info.height) > Math.max(info.width, info.height) * 0.01) {
        errors.push(`Обложка должна быть квадратной (сейчас ${info.width}×${info.height})`)
    }
    if (Math.min(info.width, info.height) < COVER_MIN_SIDE) errors.push(`Обложка слишком маленькая: нужно от ${COVER_MIN_SIDE}×${COVER_MIN_SIDE}`)
    if (file.size > COVER_MAX_BYTES) errors.push('Обложка больше 5 МБ')
    return errors
}

export function imageExt(file: File): 'jpg' | 'png' {
    return /\.png$/i.test(file.name) || file.type === 'image/png' ? 'png' : 'jpg'
}
