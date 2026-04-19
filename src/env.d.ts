/// <reference types="vite/client" />

// Декларация импорта Vue SFC для TypeScript.
// Нужна, чтобы *.vue корректно типизировались в TS-проектах Vite.
declare module '*.vue' {
    import { DefineComponent } from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
}
