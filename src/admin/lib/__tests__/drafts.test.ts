import { describe, it, expect, beforeEach, vi } from 'vitest'
import { draftAge, draftKey, readDraft, removeDraft, writeDraft } from '../drafts'

const KEY = draftKey('lrc', 'lyrics/singles/faaa.lrc')
const NOW = Date.parse('2026-10-05T15:00:00')

beforeEach(() => localStorage.clear())

describe('черновики в браузере', () => {
    it('запись, чтение, удаление; ключ — раздел и путь файла', () => {
        expect(KEY).toBe('adm-draft:lrc:lyrics/singles/faaa.lrc')
        expect(writeDraft(KEY, { savedAt: NOW, baseSha: 'a'.repeat(40), original: 'old', data: { lines: [{ text: 'Раз', time: 1 }] } })).toBe(true)
        expect(readDraft<{ lines: unknown[] }>(KEY, NOW)).toMatchObject({ v: 1, original: 'old', data: { lines: [{ text: 'Раз', time: 1 }] } })
        removeDraft(KEY)
        expect(readDraft(KEY, NOW)).toBeNull()
    })

    it('битый и чужой формат — как будто черновика нет', () => {
        localStorage.setItem(KEY, '{не json')
        expect(readDraft(KEY, NOW)).toBeNull()
        localStorage.setItem(KEY, JSON.stringify({ v: 2, savedAt: NOW, data: {} }))
        expect(readDraft(KEY, NOW)).toBeNull()
    })

    it('черновик старше месяца не предлагается и убирается', () => {
        writeDraft(KEY, { savedAt: NOW - 31 * 86400000, baseSha: '', original: '', data: 1 })
        expect(readDraft(KEY, NOW)).toBeNull()
        expect(localStorage.getItem(KEY)).toBeNull()
    })

    it('хранилище недоступно (квота, приватный режим) — без ошибок', () => {
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError')
        })
        expect(writeDraft(KEY, { savedAt: NOW, baseSha: '', original: '', data: 1 })).toBe(false)
        spy.mockRestore()
    })

    it('возраст черновика', () => {
        expect(draftAge(NOW - 20_000, NOW)).toBe('только что')
        expect(draftAge(NOW - 5 * 60000, NOW)).toBe('5 мин назад')
        expect(draftAge(Date.parse('2026-10-05T09:07:00'), NOW)).toBe('сегодня в 09:07')
        expect(draftAge(Date.parse('2026-10-04T18:02:00'), NOW)).toBe('вчера в 18:02')
    })
})
