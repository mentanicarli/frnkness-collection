import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

vi.mock('../social/api', () => ({ api: { tagsAll: vi.fn() } }))

const { api } = await import('../social/api')
const tags = await import('../social/tags')
const { default: UserTag } = await import('../components/UserTag.vue')

const U1 = '00000000-0000-4000-8000-000000000001'
const U2 = '00000000-0000-4000-8000-000000000002'
const payload = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over })
const base = () => ({
    tags: [
        { id: 1, name: 'Легенда', color: '#FFD700' },
        { id: 2, name: 'Тёмный', color: '#101010' }
    ],
    assignments: [{ user_id: U1, tag_id: 1 }]
})

const els: HTMLElement[] = []
function mountTag(userId: string | null) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    els.push(el)
    createApp({ render: () => h(UserTag, { userId }) }).mount(el)
    return el
}

afterEach(() => {
    els.splice(0).forEach((e) => e.remove())
    tags.stopTagsPolling()
    vi.useRealTimers()
    vi.mocked(api.tagsAll).mockReset()
})

describe('справочник тегов на сайте', () => {
    it('тег по пользователю; у остальных тега нет; цвет приводится к нижнему регистру', () => {
        tags.applyTags(payload())
        expect(tags.tagOf(U1)).toEqual({ id: 1, name: 'Легенда', color: '#ffd700' })
        expect(tags.tagOf(U2)).toBeNull()
        expect(tags.tagOf(null)).toBeNull()
        expect(tags.tagOf(undefined)).toBeNull()
    })

    it('тег с неверным цветом не показывается: цвет попадает в стиль, пускаем только #RRGGBB', () => {
        tags.applyTags({
            tags: [
                { id: 1, name: 'Хак', color: 'red; background:url(//evil)' },
                { id: 2, name: 'Нормальный', color: '#123456' }
            ],
            assignments: [
                { user_id: U1, tag_id: 1 },
                { user_id: U2, tag_id: 2 }
            ]
        })
        expect(tags.tagOf(U1)).toBeNull()
        expect(tags.tagOf(U2)?.name).toBe('Нормальный')
    })

    it('назначение на несуществующий тег игнорируется; пустой ответ очищает всё', () => {
        tags.applyTags({ tags: [], assignments: [{ user_id: U1, tag_id: 99 }] })
        expect(tags.tagOf(U1)).toBeNull()
        tags.applyTags(payload())
        tags.applyTags(null)
        expect(tags.tagOf(U1)).toBeNull()
        expect(tags.tagsStore.loaded).toBe(true)
    })

    it('изменение названия и цвета видно сразу после обновления; удаление снимает тег у всех', async () => {
        tags.applyTags(payload())
        vi.mocked(api.tagsAll).mockResolvedValueOnce(payload({ tags: [{ id: 1, name: 'Суперлегенда', color: '#000000' }, { id: 2, name: 'Тёмный', color: '#101010' }] }))
        await tags.loadTags()
        expect(tags.tagOf(U1)).toEqual({ id: 1, name: 'Суперлегенда', color: '#000000' })
        vi.mocked(api.tagsAll).mockResolvedValueOnce({ tags: [{ id: 2, name: 'Тёмный', color: '#101010' }], assignments: [] })
        await tags.loadTags()
        expect(tags.tagOf(U1)).toBeNull()
    })

    it('ошибка загрузки оставляет прежние значки; устаревший ответ не затирает свежий', async () => {
        tags.applyTags(payload())
        vi.mocked(api.tagsAll).mockRejectedValueOnce(new Error('offline'))
        await tags.loadTags()
        expect(tags.tagOf(U1)?.name).toBe('Легенда')

        let resolveSlow!: (v: ReturnType<typeof payload>) => void
        vi.mocked(api.tagsAll)
            .mockReturnValueOnce(new Promise((r) => (resolveSlow = r)))
            .mockResolvedValueOnce(payload({ tags: [{ id: 1, name: 'Новый', color: '#ffffff' }, { id: 2, name: 'Тёмный', color: '#101010' }] }))
        const slow = tags.loadTags()
        await tags.loadTags()
        resolveSlow(payload())
        await slow
        expect(tags.tagOf(U1)?.name).toBe('Новый')
    })

    it('опрос раз в минуту, пока вкладка видна; выход очищает справочник', async () => {
        vi.useFakeTimers()
        vi.mocked(api.tagsAll).mockResolvedValue(payload())
        tags.startTagsPolling()
        await vi.advanceTimersByTimeAsync(0)
        expect(api.tagsAll).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(api.tagsAll).toHaveBeenCalledTimes(2)
        tags.stopTagsPolling()
        await vi.advanceTimersByTimeAsync(180_000)
        expect(api.tagsAll).toHaveBeenCalledTimes(2)
        expect(tags.tagOf(U1)).toBeNull()
    })
})

describe('значок UserTag', () => {
    it('название, цвет фона и автоматический цвет текста', async () => {
        tags.applyTags(payload({ assignments: [{ user_id: U1, tag_id: 1 }, { user_id: U2, tag_id: 2 }] }))
        const light = mountTag(U1).querySelector<HTMLElement>('[data-testid="user-tag"]')!
        expect(light.textContent).toBe('Легенда')
        expect(light.style.background).toContain('rgb(255, 215, 0)')
        expect(light.style.color).toBe('rgb(0, 0, 0)')
        const dark = mountTag(U2).querySelector<HTMLElement>('[data-testid="user-tag"]')!
        expect(dark.style.color).toBe('rgb(255, 255, 255)')
    })

    it('без тега ничего не рисуется; смена тега обновляет значок на месте', async () => {
        tags.applyTags(payload())
        expect(mountTag(U2).querySelector('[data-testid="user-tag"]')).toBeNull()
        const el = mountTag(U1)
        tags.applyTags(payload({ tags: [{ id: 1, name: 'Другое', color: '#ffffff' }, { id: 2, name: 'Тёмный', color: '#101010' }] }))
        await nextTick()
        expect(el.querySelector('[data-testid="user-tag"]')!.textContent).toBe('Другое')
    })

    it('название выводится как текст, разметка не выполняется', () => {
        tags.applyTags({ tags: [{ id: 1, name: '<img src=x onerror=alert(1)>', color: '#112233' }], assignments: [{ user_id: U1, tag_id: 1 }] })
        const el = mountTag(U1)
        expect(el.querySelector('img')).toBeNull()
        expect(el.querySelector('[data-testid="user-tag"]')!.textContent).toBe('<img src=x onerror=alert(1)>')
    })
})
