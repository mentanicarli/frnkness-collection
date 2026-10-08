import { parseLRC } from '@/utils/lyrics'
import { fetchTrackLrc, fetchTrackTxt } from '../services/lyricsFiles'
import { getAudio } from './audio'
import { karaoke, player } from './state'

/**
 * Текст и караоке играющего трека, полноэкранный плеер (без DOM: строки и
 * прокрутку рисует FullscreenPlayer.vue).
 */

const HARD_START_SEC = 1.2

let scrollSeq = 0
function requestScroll(index: number, behavior: ScrollBehavior) {
    karaoke.scrollRequest = { index, behavior, n: ++scrollSeq }
}

// ── Подсветка строки ────────────────────────────────────────────────────

function markLine(index: number) {
    karaoke.currentIndex = index
    karaoke.gradient = true
}

export function updateKaraoke(): void {
    const lines = karaoke.lines
    const audio = getAudio()
    if (!lines.length || !audio) return

    const currentTime = audio.currentTime
    let newIndex: number
    const hardStartActive = karaoke.hardStart && currentTime <= HARD_START_SEC

    if (hardStartActive || currentTime < lines[0].time) {
        newIndex = 0
    } else if (karaoke.currentIndex >= 0) {
        newIndex = karaoke.currentIndex
        while (newIndex + 1 < lines.length && currentTime >= lines[newIndex + 1].time) newIndex += 1
        while (newIndex > 0 && currentTime < lines[newIndex].time) newIndex -= 1
    } else {
        newIndex = lineIndexAt(currentTime)
    }

    if (newIndex !== karaoke.currentIndex) {
        markLine(newIndex)
        if (!karaoke.justOpened) requestScroll(newIndex, 'smooth')
    }

    if (karaoke.hardStart && currentTime > HARD_START_SEC) karaoke.hardStart = false
}

function lineIndexAt(time: number): number {
    for (let i = karaoke.lines.length - 1; i >= 0; i--) {
        if (time >= karaoke.lines[i].time) return i
    }
    return 0
}

// ── Отрисовка текста ────────────────────────────────────────────────────

let justOpenedTimer: ReturnType<typeof setTimeout> | null = null

// Новый текст или режим: панель в начало, при караоке — «жёсткий старт»
// в первые секунды трека, иначе сразу строка по текущему времени.
function renderLyrics() {
    karaoke.renderVersion += 1
    if (karaoke.lines.length) {
        karaoke.justOpened = true
        if (justOpenedTimer !== null) clearTimeout(justOpenedTimer)
        justOpenedTimer = setTimeout(() => { karaoke.justOpened = false }, 3000)

        const time = getAudio()?.currentTime ?? NaN
        const shouldHardStart = !Number.isFinite(time) || time <= HARD_START_SEC
        if (shouldHardStart) {
            karaoke.currentIndex = 0
            karaoke.gradient = false
            karaoke.hardStart = true
        } else {
            karaoke.currentIndex = -1
            karaoke.hardStart = false
            updateKaraoke()
        }
    } else {
        karaoke.currentIndex = -1
        karaoke.gradient = false
        karaoke.hardStart = false
    }
}

export function setLyricsMode(mode: 'text' | 'karaoke'): void {
    if (mode !== 'text' && mode !== 'karaoke') return
    if (mode === 'karaoke' && !karaoke.lines.length) return
    karaoke.mode = mode
    renderLyrics()
}

// ── Загрузка ────────────────────────────────────────────────────────────

// Промис последней загрузки текста: revealKaraokeAt ждёт именно его.
let loadPromise: Promise<void> = Promise.resolve()
// Токен последней загрузки: ответ для трека, с которого уже переключились,
// не должен перезаписать текст текущего.
let loadToken = 0

export function loadLyrics(index: number): Promise<void> {
    loadPromise = fetchAndRender(index).catch(() => {})
    return loadPromise
}

async function fetchAndRender(index: number) {
    const release = player.currentRelease
    const track = release?.tracks[index]
    if (!release || !track) return

    const token = ++loadToken
    karaoke.currentIndex = -1

    // .lrc и .txt — параллельно.
    const [lrcText, txt] = await Promise.all([fetchTrackLrc(release, track), fetchTrackTxt(release, track)])
    // Пока грузили, заиграл другой трек — его текст уже грузится своим вызовом.
    if (token !== loadToken || player.currentRelease !== release || player.currentTrackIndex !== index) return

    karaoke.plainText = txt.trim() ? txt : 'Текст будет позже...'
    karaoke.lines = lrcText ? parseLRC(lrcText) : []
    // Полноэкранный режим — всегда караоке при наличии синхротекста.
    karaoke.mode = karaoke.lines.length ? 'karaoke' : 'text'
    renderLyrics()
}

// Переход из поиска к строке караоке: дожидаемся текста трека и его
// метаданных (к этому моменту seekTo уже перемотал), подсвечиваем строку
// и сразу, без плавной прокрутки, ставим её по центру.
export async function revealKaraokeAt(time: number): Promise<void> {
    const session = player.playSession
    await loadPromise
    const audio = getAudio()
    if (audio && audio.readyState < 1) {
        await new Promise<void>((resolve) => {
            audio.addEventListener('loadedmetadata', () => resolve(), { once: true })
            setTimeout(resolve, 8000)
        })
    }
    if (player.playSession !== session || !karaoke.lines.length) return
    karaoke.hardStart = false
    karaoke.justOpened = false
    const index = lineIndexAt(time)
    markLine(index)
    requestScroll(index, 'auto')
}

// ── Полноэкранный плеер ─────────────────────────────────────────────────

let lyricsToggleGuardUntil = 0

export function openFsPlayer(): void {
    // Пока ничего не играет (например, в комнате до первого трека), открывать нечего.
    if (!player.currentRelease) return
    karaoke.fsOpen = true
}

// Полноэкранный плеер сразу с открытым текстом (переход из поиска к строке).
export function openFsLyrics(): void {
    karaoke.fsLyricsOpen = true
    openFsPlayer()
}

export function closeFsPlayer(): void {
    karaoke.fsOpen = false
    karaoke.fsLyricsOpen = false
    lyricsToggleGuardUntil = 0
}

export function toggleFsLyrics(): void {
    // Защита от двойного срабатывания (касание + клик).
    const now = performance.now()
    if (now < lyricsToggleGuardUntil) return
    lyricsToggleGuardUntil = now + 260

    karaoke.fsLyricsOpen = !karaoke.fsLyricsOpen
    if (karaoke.fsLyricsOpen && karaoke.mode === 'karaoke') updateKaraoke()
}
