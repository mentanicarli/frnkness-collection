# frnk ness collection

Минималистичный музыкальный веб-плеер с коллекцией релизов, синхронизированными текстами и статистикой прослушиваний.

Проект создан для личного использования и не является стриминговым сервисом.

## Демо

https://frnkness.ru/

## Возможности

- Мини-плеер и полноэкранный плеер
- Переключение треков внутри релиза
- Режим Поток (случайное непрерывное воспроизведение)
- Отдельная страница у каждого трека: текст, описание, разборы строк, ссылка для отправки
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
- Контент: `src/content/releases.json` (реестр релизов) и `src/content/site.json` (промо-блок)
- Конфиг: `src/config.ts` — импортирует JSON и отдаёт `releases`, настройки промо и адрес Supabase
- Утилиты и типы: `src/utils/*`, `src/types/index.ts`

### Runtime-слой

Здесь живёт вся логика приложения: рендер карточек и треклистов, воспроизведение,
тексты, поиск, чарт и цветовые акценты.

- Оркестратор: `src/legacy/app-core.js` — принимает зависимости, собирает модули и `window.App`
- Модули: `src/legacy/modules/*.js` (`player`, `lyrics`, `fullscreen`, `colors`, `chart`, `search`, `ui`, `track`, `router`)
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
	supabaseConfig.ts
	env.d.ts
	content/
		releases.json
		site.json
	admin/            админка (см. раздел «Админка»)
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
		slug.ts
		trackNotes.ts
		promoCard.ts
		__tests__/
			helpers.test.ts
			lyrics.test.ts
			slug.test.ts
			trackNotes.test.ts
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
			router.js
			search.js
			track.js
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
Обе переменные необязательные: без них используются значения по умолчанию из `src/supabaseConfig.ts`.

Промо-блок на главной настраивается не env-переменными, а файлом `src/content/site.json`:

```json
{ "promo": { "enabled": true, "releaseId": "zlaya-nostalgia" } }
```

### Команды

```bash
npm run dev
npm run typecheck
npm run test:run
npm run build
npm run preview
npm run test:e2e        # Playwright-тесты админки (Supabase и GitHub замоканы)
npm run check:function  # проверка типов Edge Function через Deno
```

`npm run build` после сборки запускает `scripts/check-dist.mjs`: он проверяет, что код
админки не попал в бандл сайта и в precache service worker.

`npm test` запускает Vitest в watch-режиме, `npm run test:run` — однократный прогон (используется в CI).

Сборка создается в папке `dist`.

## Адреса страниц

Навигация построена на hash-роутинге (`src/legacy/modules/router.js`).
Единственный источник правды — `location.hash`: переходы только меняют адрес,
а отрисовкой занимается обработчик `hashchange`. Поэтому «назад» и «вперёд»
в браузере работают штатно, а прямая ссылка открывает нужный экран.

```text
#/                                 главная
#/chart                            чарт
#/release/<releaseId>              страница релиза
#/track/<releaseId>/<slug>         страница трека
```

Слаг трека берётся из имени файла с текстом без ведущего номера:
`01-makanochki.txt` → `makanochki` (`src/utils/slug.ts`). Транслитерация не
нужна, потому что имена файлов уже в латинице.

Неизвестный адрес не показывает ошибку: битый слаг уводит на страницу релиза,
неизвестный релиз — на главную, мусор в адресе приводится к `#/`.

## Разборы строк и описание трека

Рядом с текстом песни можно положить файл `<имя текста>.notes.json` — он даёт
странице трека блок «О треке» и разборы отдельных строк:

```text
lyrics/album1/01-poopsicks.txt          текст песни
lyrics/album1/01-poopsicks.notes.json   описание и разборы
```

```json
{
  "about": "Абзац про трек.

Пустая строка разделяет абзацы.",
  "annotations": [
    { "line": "строка из текста песни", "note": "что она означает" }
  ]
}
```

Оба поля необязательные. Строка ищется в тексте без учёта регистра, лишних
пробелов и знаков по краям, поэтому запятую в конце можно не копировать. Метки
секций вида `[Припев]` разборы не принимают. Если строка встречается в песне
несколько раз, разбор показывается только у первого вхождения — иначе припев
подчёркивал бы полтекста одним и тем же комментарием.

Все такие файлы собираются в один `track-notes.json` на этапе сборки, так что
страница трека не ходит за ними по отдельности.

## Добавление релиза

1. Положите аудио в `audio/<папка релиза>/`, обложку — в `images/`.
2. Создайте папку `lyrics/<папка релиза>/` и файлы текстов. Пустой `.txt` допустим —
   на сайте отобразится «Текст будет позже...».
3. Для караоке рядом с `имя.txt` положите `имя.lrc` с таймкодами вида `[00:12.34]`.
4. Добавьте запись в конец `src/content/releases.json`.

Имена файлов могут содержать пробелы и кириллицу — пути кодируются
хелпером `buildAssetUrl` из `src/utils/helpers.ts`.

Чтобы новый релиз попал в промо-блок на главной, укажите его ключ
в `promo.releaseId` в `src/content/site.json`.

Всё это умеет делать админка (раздел «Новый релиз»).

Важно: существующие релизы в `releases.json` не переименовывайте и не переставляйте
в них треки — ключ статистики `<releaseId>-<индекс трека>` перепутает прослушивания.
Админка и функция `admin-content` такие изменения не пропускают.

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

Схема базы для админки — в `supabase/migrations/`, Edge Function — в `supabase/functions/admin-content/`.

## Админка

Отдельная страница `admin.html` (вторая точка входа Vite, код в `src/admin/`). Вход — Supabase Auth,
права — `app_metadata.role = 'admin'`. Вся защита на сервере: RLS, проверки в RPC и в функции.

- Изменения контента уходят коммитами в `main` через Edge Function `admin-content`;
  токен GitHub хранится только в секретах функции.
- Функция пропускает только пути из белого списка (`lyrics/**`, `audio/**`, `images/**`,
  `lyrics-books/**`, `src/content/*.json`) — правила в `supabase/functions/_shared/rules.ts`.
- Медиафайлы загружаются через приватный бакет `admin-uploads` в Supabase Storage.
- Админка не входит в бандл сайта и не кэшируется service worker.
- Статистика: `increment_play_count` пишет каждое прослушивание ещё и в `play_events`;
  дашборд читает агрегаты через admin-only RPC (`admin_stats_*`). Графики по дням —
  с даты запуска журнала, итоги за всё время — из `play_counts`. Прямая запись в
  `play_counts` закрыта, менять счётчик может только `increment_play_count`.
- Миграции проверяются на PGlite (Postgres в WASM) в `supabase/tests/` — входят в `npm run test:run`.

Разделы:

- **Статистика** — сводка, прослушивания по дням, топы, карточка релиза.
- **Тексты** — текст песни, «О треке», разборы строк, предпросмотр как на сайте.
- **Караоке** — синхронизация строк с аудио, результат — `.lrc`.
- **Промо** — промо-блок на главной (`src/content/site.json`).
- **Каталог** — чего не хватает у треков и релизов, файлы без ссылок.
- **Новый релиз** — файлы, пустые тексты и запись в `releases.json` одним коммитом.

Каждое сохранение — подтверждение со списком файлов и один коммит `admin: …`;
после него админка показывает статус сборки в GitHub Actions.

Настройка с нуля — [docs/admin-setup.md](docs/admin-setup.md).

## Ограничения

- Основная логика приложения находится в runtime-слое `src/legacy/`, а не в компонентах Vue
- Интеграция между слоями идет через `window.App` и bridge
- TypeScript покрывает Vue-слой и утилиты; модули в `src/legacy/modules/` типами не проверяются
- Роутинг построен на hash-адресах, поэтому страницы треков не индексируются поисковиками,
  а превью ссылки в мессенджерах одинаковое для всего сайта. Чтобы это изменить,
  понадобится генерация отдельного HTML на трек при сборке
- Юнит-тестами покрыты утилиты и логика админки; e2e-тесты есть только у админки
- Правки из админки появляются на сайте через 1–2 минуты — после сборки в GitHub Actions

## Автор

- frnk ness - музыка и контент
- mentanicarli - разработка

## Лицензия

Только личное использование.
