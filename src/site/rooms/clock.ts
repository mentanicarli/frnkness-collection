import { CLOCK_SAMPLES, type ClockSample, estimateOffset, serverNowFrom } from './sync'

/**
 * Часы сервера на устройстве: сдвиг оценивается несколькими запросами
 * server_now() (расчёт — estimateOffset в ./sync.ts). До первой оценки
 * часы устройства считаются верными.
 */
export interface ServerClockDeps {
    serverNow(): Promise<number>
    /** Часы устройства, мс (Date.now). */
    deviceNow(): number
    sleep(ms: number): Promise<void>
}

export interface ServerClock {
    /** Серверное время сейчас, мс. */
    now(): number
    /** Сдвиг: serverNow = deviceNow + offsetMs. */
    offsetMs(): number
    /** Задержка запрос-ответ лучшей пробы; полпути — поправка к позиции хозяина. */
    rttMs(): number
    /** Перемерить сдвиг (CLOCK_SAMPLES запросов подряд). Ошибка сети — остаётся прежняя оценка. */
    sync(): Promise<boolean>
}

export const SAMPLE_GAP_MS = 120

export function createServerClock(deps: ServerClockDeps): ServerClock {
    let offset = 0
    let rtt = 0
    let syncing: Promise<boolean> | null = null

    async function measure(): Promise<boolean> {
        const samples: ClockSample[] = []
        for (let i = 0; i < CLOCK_SAMPLES; i++) {
            const sentAt = deps.deviceNow()
            try {
                const serverMs = await deps.serverNow()
                samples.push({ sentAt, receivedAt: deps.deviceNow(), serverMs })
            } catch {
                // Одна проба не удалась — остальные всё равно полезны.
            }
            if (i < CLOCK_SAMPLES - 1) await deps.sleep(SAMPLE_GAP_MS)
        }
        const estimate = estimateOffset(samples)
        if (!estimate) return false
        offset = estimate.offsetMs
        rtt = estimate.rttMs
        return true
    }

    return {
        now: () => serverNowFrom(deps.deviceNow(), offset),
        offsetMs: () => offset,
        rttMs: () => rtt,
        sync() {
            // Одновременные вызовы делят одно измерение.
            syncing ??= measure().finally(() => {
                syncing = null
            })
            return syncing
        }
    }
}
