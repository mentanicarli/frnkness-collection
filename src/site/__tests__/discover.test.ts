import { describe, expect, it, vi } from 'vitest'

vi.mock('../social/api', () => ({
    api: { discoverUsers: vi.fn() },
    errorText: (e: unknown) => (e instanceof Error ? e.message : 'Что-то пошло не так')
}))

const { createDiscover } = await import('../social/discover')

const user = (n: number, relation = 'none') => ({ id: `id-${n}`, nick: `user${n}`, avatar: 'initials:0', relation }) as never
const page = (ns: number[], next: string | null) => ({ users: ns.map((n) => user(n)), has_more: next !== null, next })
const deferred = <T>() => {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((r) => (resolve = r))
    return { promise, resolve }
}

describe('список пользователей в «Друзьях»', () => {
    it('первая страница сразу, дальше — по курсору; когда страницы кончились, больше не запрашивает', async () => {
        const fetchPage = vi.fn()
            .mockResolvedValueOnce(page([1, 2], 'user2'))
            .mockResolvedValueOnce(page([3], null))
        const d = createDiscover(fetchPage, 2)
        await d.search('')
        expect(d.state.users.map((u) => u.nick)).toEqual(['user1', 'user2'])
        expect(d.state.hasMore).toBe(true)
        expect(fetchPage).toHaveBeenLastCalledWith('', null, 2)
        await d.loadMore()
        expect(fetchPage).toHaveBeenLastCalledWith('', 'user2', 2)
        expect(d.state.users).toHaveLength(3)
        expect(d.state.hasMore).toBe(false)
        await d.loadMore()
        expect(fetchPage).toHaveBeenCalledTimes(2)
    })

    it('параллельные «подгрузить» (прокрутка + кнопка) не запрашивают одну страницу дважды', async () => {
        const gate = deferred<ReturnType<typeof page>>()
        const fetchPage = vi.fn().mockReturnValueOnce(gate.promise)
        const d = createDiscover(fetchPage, 2)
        const first = d.search('')
        void d.loadMore()
        void d.loadMore()
        gate.resolve(page([1], null))
        await first
        expect(fetchPage).toHaveBeenCalledTimes(1)
    })

    it('новый запрос начинает список заново; запоздавший ответ на прошлый запрос отбрасывается', async () => {
        const slow = deferred<ReturnType<typeof page>>()
        const fetchPage = vi.fn().mockReturnValueOnce(slow.promise).mockResolvedValueOnce(page([7], null))
        const d = createDiscover(fetchPage, 5)
        const p1 = d.search('ab')
        const p2 = d.search('abc')
        await p2
        slow.resolve(page([1, 2, 3], null))
        await p1
        expect(d.state.users.map((u) => u.nick)).toEqual(['user7'])
        expect(d.state.query).toBe('abc')
        expect(fetchPage).toHaveBeenNthCalledWith(2, 'abc', null, 5)
    })

    it('один пользователь не попадает в список дважды', async () => {
        const fetchPage = vi.fn().mockResolvedValueOnce(page([1, 2], 'user2')).mockResolvedValueOnce(page([2, 3], null))
        const d = createDiscover(fetchPage, 2)
        await d.search('')
        await d.loadMore()
        expect(d.state.users.map((u) => u.id)).toEqual(['id-1', 'id-2', 'id-3'])
    })

    it('ошибка показывается и не теряет загруженное; повтор продолжает с того же места', async () => {
        const fetchPage = vi.fn().mockResolvedValueOnce(page([1], 'user1')).mockRejectedValueOnce(new Error('Нет связи')).mockResolvedValueOnce(page([2], null))
        const d = createDiscover(fetchPage, 1)
        await d.search('')
        await d.loadMore()
        expect(d.state.error).toBe('Нет связи')
        expect(d.state.users).toHaveLength(1)
        expect(d.state.hasMore).toBe(true)
        await d.loadMore()
        expect(d.state.error).toBe('')
        expect(d.state.users).toHaveLength(2)
        expect(fetchPage).toHaveBeenLastCalledWith('', 'user1', 1)
    })

    it('после заявки статус меняется на месте, без перезагрузки списка', async () => {
        const fetchPage = vi.fn().mockResolvedValueOnce(page([1], null))
        const d = createDiscover(fetchPage, 5)
        await d.search('')
        d.setRelation('id-1', 'outgoing')
        expect(d.state.users[0].relation).toBe('outgoing')
        d.setRelation('нет такого', 'friend')
        expect(fetchPage).toHaveBeenCalledTimes(1)
    })

    it('пустой результат: loaded=true и список пуст (страница покажет «Никого не нашли»)', async () => {
        const d = createDiscover(vi.fn().mockResolvedValueOnce(page([], null)), 5)
        await d.search('  zzz  ')
        expect(d.state.query).toBe('zzz')
        expect(d.state.loaded).toBe(true)
        expect(d.state.users).toEqual([])
    })
})
