import { shallowReactive } from 'vue'
import type { LyricLine, Release } from '@/types'
import type { Queue } from './queue'

/**
 * Состояние плеера сайта. shallowReactive: шаблоны читают поля напрямую, а
 * массивы строк караоке не оборачиваются в прокси.
 *
 * Играющий релиз и трек принадлежат плееру: открытие страниц их не меняет
 * (открытый на экране релиз — view.viewedReleaseId).
 */
export const player = shallowReactive({
    /**
     * Очередь (./queue.ts): источник, порядок, позиция. Играющий релиз и
     * индекс ниже — производные от её текущего трека.
     */
    queue: null as Queue | null,
    /** Перемешивание — выбор слушателя, действует на следующие списки. */
    shuffle: false,
    /** id играющего трека. */
    currentTrackId: null as string | null,
    currentRelease: null as Release | null,
    currentReleaseId: null as string | null,
    currentTrackIndex: -1,
    // Растёт при каждом запуске трека: по нему ответ на засчёт прослушивания
    // отличает «свой» запуск от следующего (в том числе повтор того же трека).
    playSession: 0,
    isPlaying: false,
    // Мини-плеер показан (после первого запуска, до нажатия «закрыть»).
    visible: false,
    /**
     * Роль в комнате (этап 4). Гость слушает то, что включил хозяин: движок
     * не выполняет его команды (кроме громкости). У хозяина плеер обычный.
     */
    roomRole: null as 'host' | 'guest' | null,
    /** Играет Поток по всему каталогу (кнопка на главной). */
    flowModeActive: false,
    trackCounted: false,
    trackCountPending: false,
    /** Позиция в процентах, с шагом 0,2 — чтобы не перерисовывать на каждом timeupdate. */
    progress: 0,
    /** Текущая секунда (целая) и длительность трека. */
    currentSecond: 0,
    duration: NaN,
    /** Значение ползунков громкости (при выключенном звуке — 0). */
    sliderValue: 1,
    muted: false,
    /**
     * Последний запуск трека: обложка и направление (next/prev — сдвиг
     * обложки в полноэкранном плеере, fade — без сдвига, null — без анимации).
     */
    trackStart: null as { n: number; cover: string; direction: 'next' | 'prev' | 'fade' | null } | null
})

/**
 * Текст и караоке играющего трека, полноэкранный плеер.
 */
export const karaoke = shallowReactive({
    /** Синхротекст (.lrc); пустой — караоке у трека нет. */
    lines: [] as LyricLine[],
    /** Обычный текст (.txt) или заглушка; null — ещё не загружали ни разу. */
    plainText: null as string | null,
    mode: 'karaoke' as 'text' | 'karaoke',
    currentIndex: -1,
    /**
     * Соседние строки приглушены по расстоянию (d1–d3). На «жёстком старте»
     * подсвечена только первая строка, без градиента, — пока строка не сменится.
     */
    gradient: false,
    /** Первые ~1,2 с трека подсвечивается первая строка, даже если её время позже. */
    hardStart: false,
    /** Сразу после смены текста плавная прокрутка не нужна. */
    justOpened: false,
    /** Растёт при каждой перерисовке текста: панель прокручивается в начало. */
    renderVersion: 0,
    /** Запрос прокрутки к строке (обрабатывает полноэкранный плеер). */
    scrollRequest: null as { index: number; behavior: ScrollBehavior; n: number } | null,

    fsOpen: false,
    fsLyricsOpen: false
})

/** Строку треклиста подсвечиваем, только если открыт именно играющий релиз. */
export function isTrackHighlighted(viewedReleaseId: string | null, trackIndex: number): boolean {
    return Boolean(
        viewedReleaseId &&
        viewedReleaseId === player.currentReleaseId &&
        player.visible &&
        trackIndex === player.currentTrackIndex
    )
}
