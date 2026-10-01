/** Склонение «прослушивание» по числу. */
export function pluralPlays(count: number): string {
    const n = Math.abs(count)
    const mod10 = n % 10
    const mod100 = n % 100
    if (mod10 === 1 && mod100 !== 11) return 'прослушивание'
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'прослушивания'
    return 'прослушиваний'
}

/** 12345 → «12 345». */
export function formatNumber(value: number): string {
    return new Intl.NumberFormat('ru-RU').format(value).replace(/ /g, ' ')
}
