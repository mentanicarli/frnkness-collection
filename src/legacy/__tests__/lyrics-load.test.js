// Загрузка текста при быстром переключении треков: ответ для прошлого трека,
// пришедший позже, не должен перезаписать текст текущего.
import { describe, it, expect, vi } from 'vitest'
import { createLyricsModule } from '../modules/lyrics'

const release = {
    lyricsPath: 'lyrics/a/',
    tracks: [
        { num: 1, title: 'Первый', lyricsFile: '01-first.txt' },
        { num: 2, title: 'Второй', lyricsFile: '02-second.txt' }
    ]
}

function deferred() {
    let resolve
    const promise = new Promise(r => { resolve = r })
    return { promise, resolve }
}

function setup() {
    const files = new Map()
    const fetchTextFile = vi.fn(url => {
        if (!files.has(url)) files.set(url, deferred())
        return files.get(url).promise
    })
    const state = {
        currentRelease: release, currentTrackIndex: 0, parsedLyrics: [], currentLyricIndex: -1,
        lyricsNodes: { regular: [], fullscreen: [] }, lyricsMode: 'text', karaokeHardStart: false
    }
    const ctx = {
        dom: { audio: { currentTime: 0 }, fsLyricsBody: document.createElement('div') },
        state,
        utils: { buildAssetUrl: (p, f) => p + f, parseLRC: () => [], fetchTextFile },
        modules: { fullscreen: { syncFsPlayerModeState: vi.fn() } }
    }
    const lyrics = createLyricsModule(ctx)
    const reply = (url, text) => {
        if (!files.has(url)) files.set(url, deferred())
        files.get(url).resolve(text)
    }
    return { lyrics, state, reply, fetchTextFile }
}

describe('loadLyrics', () => {
    it('.lrc и .txt запрашиваются параллельно', () => {
        const { lyrics, fetchTextFile } = setup()
        lyrics.loadLyrics(0)
        expect(fetchTextFile).toHaveBeenCalledWith('lyrics/a/01-first.lrc')
        expect(fetchTextFile).toHaveBeenCalledWith('lyrics/a/01-first.txt')
    })

    it('поздний ответ прошлого трека не перезаписывает текст текущего', async () => {
        const { lyrics, state, reply } = setup()
        const first = lyrics.loadLyrics(0)
        // переключились на второй трек, пока текст первого ещё грузится
        state.currentTrackIndex = 1
        const second = lyrics.loadLyrics(1)
        reply('lyrics/a/02-second.lrc', '')
        reply('lyrics/a/02-second.txt', 'текст второго')
        await second
        reply('lyrics/a/01-first.lrc', '')
        reply('lyrics/a/01-first.txt', 'текст первого')
        await first
        expect(state.currentLyricsPlainText).toBe('текст второго')
    })

    it('без текста — заглушка', async () => {
        const { lyrics, state, reply } = setup()
        const done = lyrics.loadLyrics(0)
        reply('lyrics/a/01-first.lrc', '')
        reply('lyrics/a/01-first.txt', '   ')
        await done
        expect(state.currentLyricsPlainText).toBe('Текст будет позже...')
    })
})
