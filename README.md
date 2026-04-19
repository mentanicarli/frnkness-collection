# Pupsiks Saga

Минималистичный музыкальный веб-плеер с коллекцией релизов, синхронизированными текстами и статистикой прослушиваний.

Проект создан для личного использования и не является стриминговым сервисом.

## Демо

https://mentanicarli.github.io/pupsiks-saga/

## Возможности

- Мини-плеер и полноэкранный плеер
- Переключение треков внутри релиза
- Режим Поток (случайное непрерывное воспроизведение)
- Глобальный поиск по трекам, релизам и строкам текста
- Поддержка текстов в форматах .txt и .lrc
- Режимы отображения текста: обычный и караоке
- Чарт по прослушиваниям и суммарные прослушивания альбомов
- Динамический цветовой акцент на основе обложки
- PWA (manifest + service worker)

## Технологии

- Vue 3
- TypeScript (strict)
- Pinia
- Vite
- Supabase (`@supabase/supabase-js`)
- Tailwind CSS через CDN в `index.html`
- Color Thief через CDN в `index.html`

## Архитектура

Проект организован в два связанных слоя.

### Vue-слой

- Компоненты интерфейса: `src/components/*`
- Корневая композиция: `src/App.vue`, `src/main.ts`
- Реактивное состояние: `src/runtime/sharedState.ts`
- Store-адаптер: `src/stores/appStore.ts`
- Конфиг и данные релизов: `src/config.ts`
- Утилиты и типы: `src/utils/*`, `src/types/index.ts`

### Runtime-слой

- Основной runtime: `src/legacy/app-core.js`
- Единая точка вызова runtime из Vue: `src/runtime/legacyBridge.ts`

Bridge задает единый контракт вызовов (`window.App`) и отделяет шаблоны Vue от прямых обращений к legacy-API.

## Структура каталогов

```text
src/
	App.vue
	main.ts
	config.ts
	components/
		AppHeader.vue
		MainPages.vue
		LyricsAndPlayers.vue
	runtime/
		sharedState.ts
		legacyBridge.ts
	stores/
		appStore.ts
	utils/
		helpers.ts
		lyrics.ts
		colors.ts
		database.ts
	types/
		index.ts
	legacy/
		app-core.js
		app-core.d.ts
	assets/
		app.css

public/
	manifest.webmanifest
	sw.js

audio/
images/
lyrics/
lyrics-books/
```

## Запуск

### Требования

- Node.js 18+

### Установка

```bash
npm install
```

### Переменные окружения

Создайте `.env.local` на основе `.env.example`.

Используемые переменные:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SHOW_NEW_RELEASE_PROMO`
- `VITE_NEW_RELEASE_PROMO_ID`

### Команды

```bash
npm run dev
npm run typecheck
npm run build
npm run preview
```

Сборка создается в папке `dist`.

## PWA и кэширование

- Service worker: `public/sw.js`
- Кэши: app shell, медиа (`audio`, `images`), тексты (`lyrics`)
- Для GitHub Pages регистрация service worker выполняется через `import.meta.env.BASE_URL` в `src/main.ts`

## Деплой

Проект рассчитан на GitHub Pages.

`vite.config.ts` автоматически вычисляет `base`:

- `/` для репозиториев вида `username.github.io`
- `/<repo-name>/` для project pages

## Конфигурация Supabase

Для статистики требуется:

- таблица `play_counts`
- RPC-функция `increment_play_count`

Если Supabase недоступен, интерфейс продолжает работать, а статистика возвращает пустые данные.

## Ограничения

- Основная логика плеера находится в runtime-слое `src/legacy/app-core.js`
- Интеграция между слоями идет через `window.App` и bridge
- Системы авторизации нет
- Автотесты не добавлены

## Автор

- frnk ness - музыка и контент
- mentanicarli - разработка

## Лицензия

Только личное использование.

