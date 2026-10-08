import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, isActive, visibleGroups } from '../nav'

const ids = (groups: ReturnType<typeof visibleGroups>) => groups.flatMap((g) => g.items.map((i) => i.id))

describe('навигация админки: группы', () => {
    it('все прежние разделы на месте, каждый ровно один раз, а группы — «Контент», «Статистика», «Люди»', () => {
        const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id))
        expect([...all].sort()).toEqual(['catalog', 'errors', 'feedback', 'history', 'home', 'lrc', 'lyrics', 'new-release', 'promo', 'recap', 'recovery', 'releases', 'stats', 'tags', 'users'])
        expect(new Set(all).size).toBe(all.length)
        expect(NAV_GROUPS.map((g) => g.title).filter(Boolean)).toEqual(['Контент', 'Статистика', 'Люди'])
        const byTitle = (title: string) => NAV_GROUPS.find((g) => g.title === title)!.items.map((i) => i.id)
        expect(byTitle('Контент')).toEqual(['lyrics', 'lrc', 'promo', 'catalog', 'releases', 'history', 'new-release'])
        expect(byTitle('Статистика')).toEqual(['stats', 'recap', 'errors'])
        expect(byTitle('Люди')).toEqual(['users', 'recovery', 'feedback', 'tags'])
    })

    it('«Теги» видит только владелец (как и «Заявки»)', () => {
        expect(ids(visibleGroups(true))).toContain('tags')
        expect(ids(visibleGroups(false))).not.toContain('tags')
    })

    it('«Заявки» видит только владелец; у админа группа «Люди» остаётся с «Пользователями»', () => {
        expect(ids(visibleGroups(true))).toContain('recovery')
        const forAdmin = visibleGroups(false)
        expect(ids(forAdmin)).not.toContain('recovery')
        expect(forAdmin.find((g) => g.title === 'Люди')!.items.map((i) => i.id)).toEqual(['users', 'feedback'])
    })

    it('пустые группы не показываются', () => {
        const groups = [
            { id: 'a', title: 'Только владельцу', items: [{ id: 'secret', label: 'Секрет', ownerOnly: true }] },
            { id: 'b', title: 'Всем', items: [{ id: 'open', label: 'Открыто' }] }
        ]
        expect(visibleGroups(false, groups).map((g) => g.id)).toEqual(['b'])
        expect(visibleGroups(true, groups).map((g) => g.id)).toEqual(['a', 'b'])
    })

    it('подсвечивается ровно выбранный раздел', () => {
        const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id))
        expect(all.filter((id) => isActive('users', id))).toEqual(['users'])
        expect(all.filter((id) => isActive('нет-такого', id))).toEqual([])
    })
})
