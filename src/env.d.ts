/// <reference types="vite/client" />

// Типы собственных env-переменных проекта.
interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL?: string
    readonly VITE_SUPABASE_ANON_KEY?: string
    readonly VITE_SHOW_NEW_RELEASE_PROMO?: string
    readonly VITE_NEW_RELEASE_PROMO_ID?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

// Декларация импорта Vue SFC для TypeScript.
// Нужна, чтобы *.vue корректно типизировались в TS-проектах Vite.
declare module '*.vue' {
    import { DefineComponent } from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
}

// Тип браузерной версии ColorThief (npm-пакет colorthief экспортирует класс для браузера,
// но package.json указывает на Node.js types — переопределяем здесь).
declare module 'colorthief' {
    type RGBColor = [number, number, number]
    export default class ColorThief {
        getColor(img: HTMLImageElement, quality?: number): RGBColor | null
        getPalette(img: HTMLImageElement, colorCount?: number, quality?: number): RGBColor[] | null
    }
}
