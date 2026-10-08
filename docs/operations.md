# Эксплуатация: выпуск, проверки, аварии, секреты, настройки

Инструкция по работе с боевой частью: Supabase, GitHub, Cloudflare. Здесь описано, как выпускать
изменения, проверять права, действовать при аварии, какие есть секреты и какие настройки сделаны
в панелях. Устройство отдельных возможностей смотри в коде и в комментариях к миграциям.

Команды Supabase выполняет владелец; ассистент в этом репозитории Supabase не трогает
(правило в `CLAUDE.md`) и только готовит файлы и список команд.

## Содержание

1. [Как всё устроено](#как-всё-устроено)
2. [Выпуск изменений базы и функций](#выпуск-изменений-базы-и-функций)
3. [Проверка прав](#проверка-прав)
4. [Аварийные действия](#аварийные-действия)
5. [Секреты функций](#секреты-функций)
6. [Настройки, сделанные руками](#настройки-сделанные-руками)
7. [Обновление токена GitHub](#обновление-токена-github)
8. [Домен и DNS](#домен-и-dns)
9. [Лимиты](#лимиты)

## Как всё устроено

| Что | Где |
|---|---|
| Сайт и админка | GitHub Pages, публикуются из `main` через `.github/workflows/deploy-pages.yml` |
| Проверки pull request | `.github/workflows/ci.yml` (typecheck, юнит-тесты, `check:content`, сборка) |
| Будильник Supabase | `.github/workflows/keepalive.yml`: раз в 3 дня один лёгкий запрос, иначе бесплатный проект засыпает |
| База | Supabase, проект `momcakikuivtvxkmgjhx`; схема только в `supabase/migrations/` |
| Edge Functions | `supabase/functions/`: `admin-content`, `admin-users`, `account`, `register`, `recovery-request`; общий код в `_shared/` |
| Правки контента из админки | коммиты прямо в `main` через `admin-content` (токен GitHub в секретах функции) |
| SQL для аварий | `supabase/setup/accounts_emergency.sql` |
| Проверка прав | `supabase/audit/check_all.sql`, проверка счётчика: `supabase/audit/verify_play_counter.sql` |

Пуш в `main` публикует сайт сам. Если пуш меняет только контент (`lyrics/`, `audio/`, `images/`,
`lyrics-books/`, `src/content/*.json`), деплой прогоняет `check:content` и сборку; любой другой
пуш ещё и `typecheck` с юнит-тестами. Страницы превью ссылок (`/r/…`, `/t/…`) строит сама сборка,
поэтому новый релиз из админки получает их сразу.

Если деплой завис на шаге «Deploy to GitHub Pages» (дольше 10 минут): GitHub → Actions → запуск →
**Cancel workflow**, потом **Re-run all jobs**. Это сбой на стороне GitHub Pages, код ни при чём.

## Выпуск изменений базы и функций

Порядок всегда такой: **сначала база, потом функции, потом мерж** (сайт обновляется сам
после мержа). Так сайт и функции не обращаются к таблицам, которых ещё нет. Если не уверен,
что новое совместимо со старым сайтом, в описании PR это написано.

Терминал в папке проекта. Supabase CLI запускается через `npx` (на Windows глобальная установка
не поддерживается).

```bash
# 1. Войти и привязать проект (пароль базы: Supabase → Project Settings → Database;
#    если забыл, там же «Reset database password»: сайт от этого не сломается)
npx supabase@latest login
npx supabase@latest link --project-ref momcakikuivtvxkmgjhx

# 2. Посмотреть, что будет применено (ничего не меняет).
#    В списке должны быть только новые миграции из PR. Если есть что-то ещё, остановись.
npx supabase@latest db push --dry-run

# 3. Применить миграции
npx supabase@latest db push

# 4. Проверить права: выполнить supabase/audit/check_all.sql (раздел «Проверка прав»)

# 5. Задеплоить функции, которые менялись (см. ниже)
npx supabase@latest functions deploy <имя> --no-verify-jwt --use-api

# 6. Отключиться
npx supabase@latest unlink
```

- `--no-verify-jwt` нужен: вход проверяют сами функции (иначе браузер не пройдёт CORS-проверку,
  а регистрация и заявки работают без входа). Он же записан в `supabase/config.toml`.
- `--use-api` собирает функцию на стороне Supabase, Docker не нужен.
- Миграции применяются по порядку имён файлов, каждая в своей транзакции. Уже применённые файлы
  не переименовывать и не править: в базе записана их история.

**Какие функции деплоить.** Если менялся код в `supabase/functions/_shared/`:

| Что менялось | Что деплоить |
|---|---|
| `accountsCore.ts`, `accountsDeps.ts`, `recoveryCode.ts`, `http.ts` | четыре функции аккаунтов: `register`, `account`, `recovery-request`, `admin-users` |
| `accounts.ts` (правила ника и пароля, роли) | четыре функции аккаунтов **и** `admin-content` (он берёт оттуда роли) |
| `cors.ts` | все пять функций |
| `rules.ts`, `revert.ts`, `tokenExpiry.ts`, `admin-content/` | `admin-content` |

Проверка типов функций Deno (в CI не запускается): `npm run check:function`.

После миграций, которые трогают статистику (`play_counts`, `play_events`, `increment_play_count`),
выполни `supabase/audit/verify_play_counter.sql`: блок вызывает счётчик от имени анонима,
показывает строку «ТЕСТ … plays N → N+1, событий X → X+1» и намеренно завершается ошибкой, чтобы
откатить всё. Данные не меняются.

**Откат кода сайта:** `git revert <merge-коммит>` и пуш в `main`, сайт соберётся заново. База при
этом не меняется; как убрать отдельные объекты из базы, описано в разделе «Аварийные действия».

## Проверка прав

`supabase/audit/check_all.sql`: один запрос, одна таблица результата. Выполни целиком в Supabase →
SQL Editor после каждого `db push` и после деплоя. Скрипт только читает.

В каждой строке «статус» = `OK` или `ПРОБЛЕМА`, а в «деталях» перечислено, что именно не так.
Все 18 строк должны быть `OK`. Что проверяется:

| № | Что |
|---|---|
| 1 | RLS включён на всех таблицах `public` |
| 2 | политики есть только у таблиц, которые читает сайт |
| 3–4 | у `anon` и у `PUBLIC` нет никаких прав на таблицы и колонки |
| 5–6 | `authenticated` читает напрямую только разрешённые таблицы и колонки профилей (нет ключа ника), пишет только аватар и «о себе» |
| 7 | у `anon` и `authenticated` нет прав на счётчики (sequence) |
| 8–9 | аноним вызывает только `keepalive` и `log_client_error`; у `PUBLIC` нет права вызова ни у одной функции |
| 10 | внутренние помощники закрыты и для сайта, и для анонима |
| 11–12 | у каждой `security definer` функции задан `search_path`; `admin_*` и `owner_*` проверяют роль внутри |
| 13 | ровно пять политик Realtime (комнаты и реакции) |
| 14 | бакеты Storage: `admin-uploads` и `playlist-covers` закрыты, `avatars` открыт, лишних нет |
| 15–16 | защитный триггер на `auth.users` включён; владелец ровно один |
| 17–18 | в таблице кодов только хеши; цвета тегов `#rrggbb`, названия до 20 символов |

**Если есть `ПРОБЛЕМА`:** не чини вслепую. Если это нежелательное право или функция, закрой её
(`revoke … from anon, authenticated, public`) и перепроверь. Если изменение задумано (новая таблица,
которую сайт читает напрямую, новая функция для анонима), нужно поправить списки «РАЗРЕШЕНО» в самом
скрипте, пояснить причину в миграции и прогнать `npm run test:run`: тест `supabase/tests/audit.test.ts`
проверяет скрипт на настоящем Postgres (PGlite) и умышленно ломает права, чтобы убедиться, что скрипт
их замечает.

Новая таблица в `public` по умолчанию закрыта для `anon` и `authenticated` (права по умолчанию
отозваны миграцией аккаунтов). Новой таблице для сайта права дают явно и только на нужное.

## Аварийные действия

Все SQL-блоки выполняются в Supabase → **SQL Editor**.

### Вернуть владельца, сбросить пароль, найти ник

Файл `supabase/setup/accounts_emergency.sql` целиком копируется в редактор, дальше **выделяешь
мышкой один нужный блок** и нажимаешь **Run** (выполнится только выделенное).

- **Блок 0:** кто есть кто: ники, роли, баны, технические адреса.
- **Блок 1:** вернуть себе роль владельца и снять бан: подставь свой ник.
- **Блок 2:** задать новый пароль и завершить все сеансы: подставь ник и пароль (минимум 8 символов).
  Пароль сохраняется только хешем; запрос потом лучше удалить из истории SQL Editor.
- **Блок 3:** не помню ник: смотри блок 0; нет ника: зарегистрируй новый на сайте и выдай ему роль блоком 1.

Владельца нельзя удалить, понизить или забанить ни из админки, ни из функций: это держит триггер
`guard_auth_users`. Блоки 1–2 обходят его строкой `set local app.owner_override = 'on'` (действует
только внутри этого запуска).

### Пользователь забыл пароль

1. **У него есть код восстановления:** «Забыли пароль?» → «У меня есть код» (ник, код, новый пароль).
   Код одноразовый; после входа ему предложат создать новый.
2. **Кода нет:** заявка на странице «Забыли пароль?». Владелец видит её в админке → «Люди» → «Заявки»,
   связывается по контакту, задаёт временный пароль (при входе сайт попросит придумать новый) и закрывает
   заявку; контакт при закрытии стирается.
3. **Совсем без заявки:** админка → «Пользователи» → карточка → «Временный пароль».

### Выключить комнаты

Закрывает все комнаты и убирает политики Realtime. Остальной сайт продолжает работать:

```sql
update public.rooms set closed_at = now(), closed_reason = 'admin' where closed_at is null;
delete from public.room_members;
delete from public.room_invites;
drop policy if exists "rooms: members listen" on realtime.messages;
drop policy if exists "rooms: owner sends commands" on realtime.messages;
drop policy if exists "rooms: members announce presence" on realtime.messages;
```

Только реакции и журнал комнат (комнаты, топ-4 и лента остаются):

```sql
drop policy if exists "rooms: members hear reactions" on realtime.messages;
drop policy if exists "rooms: members send reactions" on realtime.messages;
drop trigger if exists room_visits_join on public.room_members;
drop trigger if exists room_visits_leave on public.room_members;
```

После этого `check_all.sql` покажет `ПРОБЛЕМА` в строке 13: это ожидаемо, пока политики выключены.
Вернуть политики повторным `db push` не получится (миграция уже записана): нужна новая миграция-восстановление.

### Убрать из базы обращения, журнал ошибок, код восстановления и теги

Эти объекты не связаны с остальной схемой, их можно убрать целиком. Перед удалением кода и тегов
задеплой версии функций без выдачи кода (иначе `register` будет пытаться его выдать; регистрация
при этом не ломается, но кода не будет).

Обращения, журнал ошибок, список пользователей:

```sql
drop function if exists public.list_discoverable_users(text, text, integer);
drop function if exists public.log_client_error(text, text, text, text, text, text);
drop function if exists public.admin_errors_list(boolean);
drop function if exists public.admin_errors_resolve(text, boolean);
drop function if exists public.submit_feedback(text, text, text, text);
drop function if exists public.admin_feedback_list(text);
drop function if exists public.admin_feedback_set(bigint, text);
drop function if exists public.admin_feedback_new_count();
drop function if exists public.scrub_client_text(text, integer);
drop function if exists public.client_errors_site_cap();
drop table if exists public.client_errors;
drop table if exists public.feedback_reports;
```

Код восстановления и теги:

```sql
drop function if exists public.recovery_code_set(uuid, text);
drop function if exists public.recovery_code_consume(uuid, text);
drop function if exists public.recovery_code_confirm(uuid);
drop function if exists public.my_recovery_code_state();
drop function if exists public.tags_all();
drop function if exists public.owner_tag_create(text, text);
drop function if exists public.owner_tag_update(bigint, text, text);
drop function if exists public.owner_tag_delete(bigint);
drop function if exists public.owner_user_set_tag(uuid, bigint);
drop function if exists public.require_owner();
drop function if exists public.tag_json(public.user_tags);
drop function if exists public.tag_clean_color(text);
drop function if exists public.tag_clean_name(text);
drop function if exists public.tags_limit();
drop table if exists public.user_tag_assignments;
drop table if exists public.user_tags;
drop table if exists public.recovery_codes;
```

Без этих таблиц строки 17–18 в `check_all.sql` упадут с ошибкой «таблицы нет»: вместе с таблицами убери эти проверки.

### Сайт сломался после мержа

Скажи ассистенту или сделай сам `git revert` merge-коммита (раздел «Выпуск»): сайт соберётся
заново без откатываемых изменений. База при этом не меняется, вход (по нику) продолжает работать.

### Realtime: комната ведёт себя странно

Сайт пишет журнал комнат в консоль браузера: F12 → Console → фильтр `[rooms]`. В нём нет токенов
и паролей, только статусы, номера попыток, id комнаты и ошибки. По нему видно, нашлась ли комната,
сколько было попыток подключения и чем кончилась каждая. Лимиты Realtime на бесплатном тарифе проверяй
в панели (Realtime → Settings) и в документации Supabase (порядок: около 200 одновременных
подключений на проект). Один слушатель в комнате занимает одно подключение.

## Секреты функций

Supabase → Edge Functions → Secrets, либо `npx supabase@latest secrets set ИМЯ=значение`;
посмотреть, какие есть (только имена и хеши): `npx supabase@latest secrets list`. Значения не
хранятся в репозитории и сюда не записываются.

| Имя | Зачем | Менять можно? |
|---|---|---|
| `ACCOUNTS_HASH_SECRET` | ключ HMAC для хешей кодов восстановления и для хешей IP и ников в лимитах | **Нельзя.** После смены хеши уже созданных кодов восстановления перестанут подходить, и людям придётся создавать коды заново. Если секрет не задан, берётся service-ключ проекта: тогда **не перевыпускай и service-ключ** |
| `TURNSTILE_SECRET_KEY` | проверка капчи на сервере (без него регистрация, заявки и вход по коду отклоняются) | можно: выпусти новый в Cloudflare и задай командой `secrets set` |
| `GITHUB_TOKEN` | токен fine-grained для коммитов админки; **срок действия ограничен** | можно и нужно раз в год, см. [Обновление токена GitHub](#обновление-токена-github) |
| `BLOB_SIGNING_KEY` | ключ подписи загрузок в админке (64 hex-символа: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) | можно: оборвёт только загрузки, идущие в этот момент |
| `GITHUB_REPO`, `GITHUB_BRANCH` | необязательные; по умолчанию `mentanicarli/frnkness-collection` и `main` | не нужны |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | подставляет сам Supabase | не задаются руками |

Публичные значения лежат в коде и секретами не являются: адрес проекта и публичный ключ
(`src/supabaseConfig.ts`, `.env.example`), ключ сайта Turnstile (`DEFAULT_TURNSTILE_SITE_KEY` там же).

В GitHub Actions секреты репозитория `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` нужны деплою
и будильнику; Settings → Secrets and variables → Actions. Это публичные значения.

## Настройки, сделанные руками

Из кода их не поменять; если что-то из этого собьётся, сайт поведёт себя неправильно.
Названия пунктов Supabase иногда переименовывает: ищи по смыслу.

### Supabase → Authentication

- **Sign In / Providers:** «Allow new users to sign up» **выключено**: регистрация идёт только через нашу
  функцию с капчей. **Email включён**, «Confirm email» **включено**, «Secure email change» и
  «Secure password change» включены. Phone, Anonymous sign-ins, все соцсети и «Allow manual linking» выключены.
- **Почта не используется.** Технический адрес аккаунта (`u-…@id.frnkness.ru`) считается из ника и не секретен,
  поэтому: SMTP не настроен (Authentication → Emails → SMTP Settings пусто), у домена `id.frnkness.ru` нет почтовых
  записей (MX) и их создавать не нужно, а **хук отправки писем** гарантирует, что письма не уходят никогда.
- **Authentication → Hooks → Send Email hook:** тип Postgres, схема `public`, функция
  `auth_hook_send_email_noop`, включён.
- **Rate Limits:** лимит писем держи низким (например, 2 в час; письма всё равно не отправляются); «Sign-ups and sign-ins»
  оставь по умолчанию (30 за 5 минут с IP): это лимит попыток входа по нику.

### Supabase → Realtime

- Realtime включён. **«Allow public access» выключено**: тогда любой канал, кроме приватных с проверкой прав,
  отвергается. Без этого посторонний мог бы открыть публичный канал с чужим названием (сайт открывает только приватные).
- Ничего больше включать не нужно: комнаты работают на Broadcast и Presence, а не на подписках на таблицы;
  `pg_cron` не нужен (пустую комнату база закрывает сама, старые записи журнала ошибок удаляются при открытии раздела «Ошибки»).

### Supabase → Storage

Бакеты создают миграции, руками их не менять (проверяет `check_all.sql`, строка 14): `admin-uploads`
(приватный, до 30 МБ, mp3/jpg/png/pdf), `avatars` (открытый, до 512 КБ), `playlist-covers` (приватный, до 512 КБ).

### Cloudflare Turnstile

Виджет `frnkness` (капча при регистрации, заявках и входе по коду): Cloudflare → Turnstile. В списке адресов
`frnkness.ru`; `localhost` нужен только для проверки на своём компьютере, Cloudflare советует его в боевом
виджете не держать. Публичный ключ (Site Key) записан в `src/supabaseConfig.ts`, секретный (Secret Key) лежит в
секрете `TURNSTILE_SECRET_KEY`. Домен в Cloudflare переносить не нужно.

### GitHub

- **Settings → Pages:** источник публикации: «GitHub Actions» (деплой делает workflow).
- **Settings → Secrets and variables → Actions:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- **Токен для админки** (`frnkness-admin`): см. [Обновление токена GitHub](#обновление-токена-github).
- **Dependabot** (`.github/dependabot.yml`): раз в неделю присылает pull request с обновлениями. Их проверяет `CI`;
  сайт они не трогают, пока ты их не смержишь. Мерж только при зелёном CI.
- **Правило для всех PR:** красный CI не мержим, сначала чиним.

## Обновление токена GitHub

**У токена `frnkness-admin` есть срок действия.** Это fine-grained токен, с которым функция `admin-content`
делает коммиты из админки; после истечения правки из админки перестают сохраняться.

**Где посмотреть дату:**

- в админке на странице «Обзор» строка «Токен GitHub действует ещё N дней (до дд.мм.гггг)»; за 30 дней
  она превращается в жёлтое предупреждение, после истечения в красное «Токен GitHub недействителен»;
- GitHub → аватар → **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
  `frnkness-admin`**, поле Expiration;
- GitHub заранее присылает письмо об истечении.

**Как обновить** (передеплоить функцию не нужно):

1. GitHub → Settings → Developer settings → Fine-grained tokens → `frnkness-admin` → **Regenerate token**,
   выбери новый срок (рекомендуется год) и скопируй токен (`github_pat_…`, GitHub показывает его один раз).
2. В терминале: `npx supabase@latest secrets set GITHUB_TOKEN=github_pat_ВСТАВЬ_ТОКЕН`
   (после `link`, в конце `unlink`, как в разделе «Выпуск»).
3. Админка → «Обзор»: строка про токен должна показать новую дату.

**Если токен приходится создавать заново:** Resource owner `mentanicarli`, **Only select repositories** →
`mentanicarli/frnkness-collection`; права: Contents: Read and write, Actions: Read-only, Metadata: Read-only
(выставляется сам); остальное No access.

## Домен и DNS

**Заполнить владельцу** (в репозитории этих сведений нет, поэтому здесь пустые строки):

| Что | Значение |
|---|---|
| Домен | frnkness.ru |
| Регистратор домена | _заполнить_ |
| Где настроен DNS | _заполнить_ (у регистратора или в другом сервисе) |
| Записи на GitHub Pages (A/CNAME) | _заполнить_ |
| Когда продлевать домен | _заполнить дату_ |
| Кто и как получает уведомление о продлении | _заполнить_ |

Домен `id.frnkness.ru` нужен только для технических адресов аккаунтов, это не настоящий адрес сайта.
Почтовых записей (MX) для него быть не должно (см. настройки Authentication).

## Лимиты

Проверяет база или функции; полезно помнить, когда пользователь пишет «не работает».

| Что | Сколько |
|---|---|
| Регистраций с одного IP | 10 в сутки |
| Заявок «Забыли пароль?» | 3 в сутки на ник и 3 на IP (сверх лимита ответ тот же, заявка не создаётся) |
| Вход по коду восстановления | 5 попыток в час на ник и 10 в час на IP (верные и неверные) |
| Проверок пароля (смена пароля, удаление аккаунта, новый код) | 10 в час на аккаунт |
| Попыток входа | встроенный лимит Supabase (30 за 5 минут с IP) |
| Смена ника | раз в 30 дней |
| Обращения «Сообщить о проблеме» | 5 в сутки на пользователя, до 1000 символов |
| Журнал ошибок | 20 записей в час на пользователя или браузер и 500 в час на весь сайт; записи старше 30 дней удаляются при открытии раздела «Ошибки» |
| Плейлистов у пользователя / треков в плейлисте / в избранном | 50 / 200 / 2000 |
| Исходящих заявок в друзья | 20 в сутки |
| «Сейчас слушает» | запись не чаще раза в 30 секунд, видна 5 минут |
| Обложка плейлиста / аватар | до 512 КБ |
| Тегов | не больше 50, название до 20 символов |
| Комната | до 20 человек, пустая закрывается через 30 минут |
