# frnk ness collection

Минималистичный музыкальный веб-плеер с коллекцией релизов, синхронизированными текстами и статистикой прослушиваний.

Проект создан для личного использования и не является стриминговым сервисом.

## Демо

https://frnkness.ru/

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
- Vite
- Supabase (`@supabase/supabase-js`)
- Tailwind CSS 4 через плагин `@tailwindcss/vite` (импорт в `src/assets/app.css`)
- Color Thief через npm-пакет `colorthief` (инициализируется в `src/main.ts`)
- Vitest для юнит-тестов

## Архитектура

Проект организован в два связанных слоя.

### Vue-слой

Отвечает за разметку экранов и тонкие обработчики. Данные в шаблонах не рендерятся —
компоненты задают DOM-каркас с `id`-атрибутами, за который цепляется runtime.

- Компоненты интерфейса: `src/components/*`
- Корневая композиция: `src/App.vue`, `src/main.ts`
- Реактивное состояние: `src/runtime/sharedState.ts`
- Конфиг и данные релизов: `src/config.ts`
- Утилиты и типы: `src/utils/*`, `src/types/index.ts`

### Runtime-слой

Здесь живёт вся логика приложения: рендер карточек и треклистов, воспроизведение,
тексты, поиск, чарт и цветовые акценты.

- Оркестратор: `src/legacy/app-core.js` — принимает зависимости, собирает модули и `window.App`
- Модули: `src/legacy/modules/*.js` (`player`, `lyrics`, `fullscreen`, `colors`, `chart`, `search`, `ui`)
- Единая точка вызова runtime из Vue: `src/runtime/legacyBridge.ts`

Конфиг, утилиты и общее состояние передаются в runtime явно через `initLegacyApp(deps)`
в `src/main.ts` — модули ничего не импортируют из Vue-слоя напрямую.
Bridge задаёт единый контракт вызовов (`window.App`) и отделяет шаблоны Vue от прямых обращений к runtime-API.

## Структура каталогов

```text
src/
	App.vue
	main.ts
	config.ts
	env.d.ts
	sw.js
	components/
		AppHeader.vue
		MainPages.vue
		LyricsAndPlayers.vue
	runtime/
		sharedState.ts
		legacyBridge.ts
	utils/
		helpers.ts
		lyrics.ts
		__tests__/
			helpers.test.ts
			lyrics.test.ts
	types/
		index.ts
	legacy/
		app-core.js
		app-core.d.ts
		modules/
			chart.js
			colors.js
			fullscreen.js
			lyrics.js
			player.js
			search.js
			ui.js
	assets/
		app.css

public/
	manifest.webmanifest
	404.html

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

- `VITE_SUPABASE_URL` — адрес проекта Supabase
- `VITE_SUPABASE_ANON_KEY` — публичный ключ Supabase
- `VITE_SHOW_NEW_RELEASE_PROMO` — `false` скрывает промо-блок на главной
- `VITE_NEW_RELEASE_PROMO_ID` — ID релиза для промо-блока (ключ из `releases` в `src/config.ts`)

Все переменные необязательные: без них используются значения по умолчанию из `src/config.ts`.

### Команды

```bash
npm run dev
npm run typecheck
npm run test:run
npm run build
npm run preview
```

`npm test` запускает Vitest в watch-режиме, `npm run test:run` — однократный прогон (используется в CI).

Сборка создается в папке `dist`.

## Добавление релиза

1. Положите аудио в `audio/<папка релиза>/`, обложку — в `images/`.
2. Создайте папку `lyrics/<папка релиза>/` и файлы текстов. Пустой `.txt` допустим —
   на сайте отобразится «Текст будет позже...».
3. Для караоке рядом с `имя.txt` положите `имя.lrc` с таймкодами вида `[00:12.34]`.
4. Добавьте запись в `releases` в `src/config.ts`.

Имена файлов могут содержать пробелы и кириллицу — пути кодируются
хелпером `buildAssetUrl` из `src/utils/helpers.ts`.

Чтобы новый релиз попал в промо-блок на главной, укажите его ключ
в `PROMO_RELEASE_ID` (`src/config.ts`) или в `VITE_NEW_RELEASE_PROMO_ID`.

## PWA и кэширование

- Исходник service worker: `src/sw.js`, собирается через `vite-plugin-pwa` в режиме `injectManifest`
- В `dist` service worker попадает как `sw.js`; в dev-режиме он не генерируется
- Кэши: app shell, медиа (`audio`, `images`), тексты (`lyrics`)
- Версия статического кэша выводится из хэшей сборки, ручное обновление не требуется
- Для GitHub Pages регистрация service worker выполняется через `import.meta.env.BASE_URL` в `src/main.ts`
- Для GitHub Pages используется относительный `base` в Vite, чтобы ассеты и manifest открывались корректно и на custom domain, и на project pages
- В `public/404.html` лежит статический fallback для GitHub Pages

## Деплой

Проект рассчитан на GitHub Pages и деплоится через GitHub Actions workflow `.github/workflows/deploy-pages.yml`.
Перед сборкой workflow прогоняет `npm run typecheck` и `npm run test:run`.

Сборка Vite настроена с `base: './'`, поэтому в `dist/index.html` используются относительные пути к ассетам.

При публикации на GitHub Pages проверьте, что в Repo Settings → Pages выбран источник из деплоя workflow, а сайт после деплоя отмечен как активный.

Если вы публикуете релиз вручную через branch deploy, убедитесь, что в корне опубликованной директории лежат `index.html` и `404.html`, а все ссылки на ассеты остаются относительными.

## Конфигурация Supabase

Для статистики требуется:

- таблица `play_counts` с колонками `track_key` и `plays`
- RPC-функция `increment_play_count`

Ключ трека имеет вид `<releaseId>-<индекс трека>` (индекс с нуля).
Если Supabase недоступен, интерфейс продолжает работать, а статистика возвращает пустые данные.

## Ограничения

- Основная логика приложения находится в runtime-слое `src/legacy/`, а не в компонентах Vue
- Интеграция между слоями идет через `window.App` и bridge
- TypeScript покрывает Vue-слой и утилиты; модули в `src/legacy/modules/` типами не проверяются
- Тестами покрыты только утилиты (`src/utils/__tests__/`), UI-тестов нет
- Системы авторизации нет

## Автор

- frnk ness - музыка и контент
- mentanicarli - разработка

## Лицензия

Только личное использование.
