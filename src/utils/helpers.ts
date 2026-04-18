/**
 * Format seconds to MM:SS
 */
export function formatTime(seconds: number): string {
    if (isNaN(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: any[]) => any>(
    func: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle: boolean
    return function (this: any, ...args: Parameters<T>) {
        if (!inThrottle) {
            func.apply(this, args)
            inThrottle = true
            setTimeout(() => (inThrottle = false), limit)
        }
    }
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout>
    return function (this: any, ...args: Parameters<T>) {
        clearTimeout(timer)
        timer = setTimeout(() => func.apply(this, args), delay)
    }
}

/**
 * Normalize search text
 */
export function normalizeSearchText(value: string): string {
    return (value || '').toString().toLowerCase().trim()
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(value: string): string {
    return (value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
}
