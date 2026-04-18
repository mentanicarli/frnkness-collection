# Pupsiks Saga

Минималистичный музыкальный веб-плеер с коллекцией релизов, синхронизированными текстами и статистикой прослушиваний.

Проект создан для личного использования и не является стриминговым сервисом.

## Демо

https://mentanicarli.github.io/pupsiks-saga/

## Текущее состояние (апрель 2026)

- Приложение в рабочем состоянии: сборка и typecheck проходят
- Архитектура гибридная: Vue-компоненты + legacy runtime слой
- Визуальный и аудио-функционал реализован, но core-логика плеера пока не полностью перенесена в typed слой

## Основные возможности

### Плеер

- Мини-плеер с быстрым доступом
- Полноэкранный режим воспроизведения
- Переключение треков внутри релиза
- Режим Поток для непрерывного случайного воспроизведения
- Глобальный поиск по трекам, альбомам и строкам из текстов

### Тексты песен

- Поддержка .txt и .lrc форматов
- Переключение между обычным текстом и режимом караоке
- Синхронная подсветка строк с автопрокруткой

### Статистика

- Чарт треков по количеству прослушиваний
- Суммарный счетчик прослушиваний для альбомов
- Хранение данных через Supabase

### Интерфейс

- Динамическая цветовая тема на основе обложки
- Плавные анимации и переходы
- Адаптивная верстка для мобильных и desktop

### PWA

- Web App Manifest
- Service Worker с кэшированием shell/lyrics/media
- Работа в standalone-режиме после установки

## Технологии и зависимости

- Vue 3
- TypeScript (strict)
- Pinia
- Vite
- Supabase (`@supabase/supabase-js`)
- Tailwind CSS через CDN (подключается в `index.html`)
- Color Thief через CDN (подключается в `index.html`)

## Архитектура

Проект мигрирован с полностью статического HTML в Vue, но пока остается гибридным.

Что уже в typed слое:

- Конфиг релизов и feature-флаги (`src/config.ts`)
- Shared runtime state (`src/runtime/sharedState.ts`)
- Pinia store-обертка (`src/stores/appStore.ts`)
- Утилиты (`src/utils/*`) и типы (`src/types/index.ts`)

Что пока в legacy-слое:

- Основной imperative runtime плеера и навигации (`src/legacy/app-core.js`)
- Глобальный API `window.App`, который вызывается из шаблонов
- Значительная часть прямых DOM-операций

## Структура проекта

```text
src/
	App.vue
	components/
		AppHeader.vue
		MainPages.vue
		LyricsAndPlayers.vue
	stores/
		appStore.ts
	runtime/
		sharedState.ts
	utils/
		helpers.ts
		colors.ts
		lyrics.ts
		database.ts
	types/
		index.ts
	legacy/
		app-core.js
	assets/
		app.css
	config.ts
	main.ts

public/
	manifest.webmanifest
	sw.js

.env.example
index.html
tsconfig.json
tsconfig.node.json
vite.config.ts

audio/
images/
lyrics/
lyrics-books/
```

## Быстрый старт

### Требования

- Node.js 18+ (рекомендуется 20)

### Установка

```bash
npm install
```

### Настройка окружения

Скопируйте `.env.example` в `.env.local` и при необходимости укажите свои значения:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SHOW_NEW_RELEASE_PROMO`
- `VITE_NEW_RELEASE_PROMO_ID`

### Запуск и проверка

```bash
npm run dev
npm run typecheck
npm run build
npm run preview
```

Собранная версия находится в папке `dist`.

## Деплой (GitHub Pages)

Проект рассчитан на деплой через GitHub Actions.

- Для `username.github.io` используется root base `/`
- Для project pages используется `/<repo-name>/`

Базовый путь вычисляется автоматически в `vite.config.ts` при запуске в GitHub Actions.

## Конфигурация Supabase

Для работы чарта и счетчиков нужна таблица `play_counts` и RPC-функция `increment_play_count`.

Если Supabase недоступен, приложение продолжает работать, но чарт/счетчики будут пустыми.

## Ограничения

- Архитектура все еще гибридная (Vue + legacy runtime)
- Часть UI-событий идет через глобальный `window.App`
- Нет системы авторизации
- Нет автотестов (unit/e2e)

## Roadmap

- Перенос player/navigation логики из `src/legacy/app-core.js` в typed Vue/Pinia слой
- Замена inline обработчиков на события Vue (`@click` и actions)
- Постепенное сокращение прямых DOM-манипуляций
- Добавление базового набора unit/e2e тестов
- Дополнительная оптимизация загрузки медиа

## История изменений

### v1.4

- Добавлен глобальный поиск по трекам и текстам
- Добавлено переключение между текстом и караоке режимом
- Добавлена метрика прослушиваний альбомов
- Добавлен режим Поток

### v1.3

- Основная миграция проекта с HTML на Vue
- Второй пакет обновления дизайна
- Добавлена карточка Последний релиз

### v1.2

- Добавлена страница чарта
- Настроена интеграция счетчика прослушиваний с Supabase

### v1.1

- Добавлена поддержка LRC (караоке)
- Первое обновление дизайна

### v1.0

- Первый релиз с базовым функционалом

## Автор

- frnk ness - музыка и контент
- mentanicarli - разработчик

## Лицензия

Проект распространяется для личного использования.
Коммерческое использование не предполагается.

