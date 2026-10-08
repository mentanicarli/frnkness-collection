/**
 * Разделы админки в боковой панели: сгруппированы по смыслу. Меняется только
 * навигация — сами разделы и адреса (#/users, #/lyrics, …) остались прежними.
 */
export interface NavItem {
    id: string
    label: string
    /** Только владельцу (база тоже не отдаст эти данные админу). */
    ownerOnly?: boolean
}

export interface NavGroup {
    id: string
    /** Заголовок группы; пустой — группа без заголовка (одиночный «Обзор»). */
    title: string
    items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
    { id: 'overview', title: '', items: [{ id: 'home', label: 'Обзор' }] },
    {
        id: 'content',
        title: 'Контент',
        items: [
            { id: 'lyrics', label: 'Тексты' },
            { id: 'lrc', label: 'Караоке' },
            { id: 'promo', label: 'Промо' },
            { id: 'catalog', label: 'Каталог' },
            { id: 'releases', label: 'Релизы' },
            { id: 'history', label: 'История' },
            { id: 'new-release', label: 'Новый релиз' }
        ]
    },
    {
        id: 'stats',
        title: 'Статистика',
        items: [
            { id: 'stats', label: 'Статистика' },
            { id: 'recap', label: 'Итоги года' },
            { id: 'errors', label: 'Ошибки' }
        ]
    },
    {
        id: 'people',
        title: 'Люди',
        items: [
            { id: 'users', label: 'Пользователи' },
            { id: 'recovery', label: 'Заявки', ownerOnly: true },
            { id: 'feedback', label: 'Обращения' },
            { id: 'tags', label: 'Теги', ownerOnly: true }
        ]
    }
]

/** Группы, которые видит пользователь: пункты «только владельцу» скрыты, пустые группы — тоже. */
export function visibleGroups(isOwner: boolean, groups: readonly NavGroup[] = NAV_GROUPS): NavGroup[] {
    return groups
        .map((g) => ({ ...g, items: g.items.filter((item) => !item.ownerOnly || isOwner) }))
        .filter((g) => g.items.length > 0)
}

/** Подсвеченный пункт: раздел из адреса; неизвестный адрес (заглушка) не подсвечивает ничего. */
export function isActive(sectionId: string, itemId: string): boolean {
    return sectionId === itemId
}
