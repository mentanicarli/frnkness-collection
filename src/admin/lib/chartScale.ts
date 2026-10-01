/**
 * Шкала столбчатого графика: «круглый» максимум, деления и прореживание
 * подписей по оси X.
 */

/** Ближайшее сверху «круглое» число вида 1/2/5 × 10^k (минимум 1). */
export function niceCeil(value: number): number {
    if (!(value > 0)) return 1
    const exp = Math.floor(Math.log10(value))
    const base = 10 ** exp
    for (const m of [1, 2, 5, 10]) {
        if (value <= m * base) return m * base
    }
    return 10 * base
}

/** Деления оси Y: от 0 до круглого максимума, не больше maxTicks+1 штук, целые. */
export function yTicks(maxValue: number, maxTicks = 4): number[] {
    const top = niceCeil(maxValue)
    let step = niceCeil(top / maxTicks)
    if (step < 1) step = 1
    const ticks: number[] = []
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v))
    if (ticks[ticks.length - 1] < maxValue) ticks.push(ticks[ticks.length - 1] + step)
    return ticks
}

/** Каждая какая подпись по X помещается, если на подпись нужно minGap пикселей. */
export function labelEvery(bandWidth: number, minGap = 48): number {
    if (bandWidth <= 0) return 1
    return Math.max(1, Math.ceil(minGap / bandWidth))
}

/** Путь столбца со скруглённым верхом и прямым основанием. */
export function barPath(x: number, y: number, width: number, height: number, radius = 4): string {
    if (height <= 0 || width <= 0) return ''
    const r = Math.min(radius, width / 2, height)
    const bottom = y + height
    return [
        `M${x},${bottom}`,
        `V${y + r}`,
        `Q${x},${y} ${x + r},${y}`,
        `H${x + width - r}`,
        `Q${x + width},${y} ${x + width},${y + r}`,
        `V${bottom}`,
        'Z'
    ].join('')
}
