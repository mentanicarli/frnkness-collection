# Настройка админки

Пошаговая инструкция: что сделать один раз, чтобы заработала `https://frnkness.ru/admin.html`.
Команды выполняются в терминале из корня проекта (папка `frnkness-collection-main`).

Порядок: **шаг 0 → 1 → 2 → 3 → 4 → 5**. Ничего из этого не трогает статистику сайта:
миграция этапа 1 не меняет таблицу `play_counts` и функцию `increment_play_count`.

---

## Шаг 0. Аудит текущей статистики (пришли результат)

Нужен, чтобы следующая миграция (запись событий для графиков) не сломала счётчик.

1. Открой [supabase.com/dashboard](https://supabase.com/dashboard) → проект → слева **SQL Editor**.
2. Нажми **New query**, вставь целиком содержимое файла `supabase/audit/play_counts_audit.sql`.
3. Нажми **Run**. Запрос только читает данные.
4. Внизу появится одна таблица. Нажми **Export → CSV** (или сделай скриншот всей таблицы)
   и пришли мне.

---

## Шаг 1. Токен GitHub (fine-grained)

Токен позволяет функции делать коммиты в репозиторий. Он хранится только в секретах
функции и никогда не попадает в браузер.

1. GitHub → аватар справа вверху → **Settings**.
2. Слева внизу **Developer settings** → **Personal access tokens** → **Fine-grained tokens**.
3. **Generate new token**.
4. Заполни:
   - **Token name**: `frnkness-admin`
   - **Expiration**: `Custom` → дата через год (см. «Срок действия» ниже).
   - **Resource owner**: `mentanicarli`
   - **Repository access**: **Only select repositories** → `mentanicarli/frnkness-collection`.
5. **Permissions → Repository permissions**:
   - **Contents** → `Read and write`
   - **Actions** → `Read-only`
   - **Metadata** → `Read-only` (выставится сам, он обязательный)

   Остальное не трогай — `No access`.
6. **Generate token**. Скопируй токен (начинается с `github_pat_`) — GitHub покажет его один раз.
   Никуда его не вставляй, кроме команды из шага 3.

### Срок действия и обновление

У fine-grained токена есть срок действия. Когда он истечёт, админка покажет
«Токен GitHub недействителен — обнови его в секретах функции». GitHub заранее присылает
письмо об истечении. Чтобы обновить:

1. GitHub → Settings → Developer settings → Fine-grained tokens → `frnkness-admin`.
2. **Regenerate token** → выбери новый срок → скопируй новый токен.
3. Выполни команду из шага 3.4 с новым токеном. Передеплоить функцию не нужно.

---

## Шаг 2. Supabase CLI

На Windows глобальная установка через `npm i -g` не поддерживается, поэтому CLI
запускается через `npx` (скачается сам при первом запуске; нужен Node.js — он уже есть).

1. Проверь, что CLI запускается:

   ```bash
   npx supabase@latest --version
   ```

2. Войди в аккаунт Supabase (откроется браузер, подтверди вход):

   ```bash
   npx supabase@latest login
   ```

3. Привяжи проект. CLI спросит пароль базы данных — он в
   Supabase → **Project Settings → Database → Database password** (если не помнишь,
   там же **Reset database password**; сайт от этого не сломается — он ходит с публичным ключом).

   ```bash
   npx supabase@latest link --project-ref momcakikuivtvxkmgjhx
   ```

---

## Шаг 3. База, функция и секреты

1. Посмотри, что будет применено (ничего не меняет):

   ```bash
   npx supabase@latest db push --dry-run
   ```

   В списке должна быть одна миграция `20261001120000_admin_base.sql`.

2. Примени миграцию. CLI покажет список и спросит подтверждение — ответь `Y`:

   ```bash
   npx supabase@latest db push
   ```

   Она создаёт: функцию `is_admin()`, таблицу `play_events` (закрытую), приватный бакет
   `admin-uploads` (до 30 МБ, только mp3/jpg/png/pdf) и его политики.

3. Сгенерируй ключ для подписи загрузок и сохрани вывод (длинная строка из 64 символов):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Задай секреты функции. Подставь свой токен из шага 1 и ключ из шага 3.3:

   ```bash
   npx supabase@latest secrets set GITHUB_TOKEN=github_pat_ВСТАВЬ_ТОКЕН BLOB_SIGNING_KEY=ВСТАВЬ_КЛЮЧ
   ```

5. Задеплой функцию. `--no-verify-jwt` нужен потому, что токен проверяет сама функция
   (иначе браузер не пройдёт CORS-проверку); `--use-api` собирает функцию на стороне
   Supabase, Docker не нужен:

   ```bash
   npx supabase@latest functions deploy admin-content --no-verify-jwt --use-api
   ```

---

## Шаг 4. Вход: выключить регистрацию, создать админа

1. Supabase → **Authentication → Sign In / Providers**:
   - **Email** должен быть включён (Enabled).
   - **Allow new users to sign up** — **выключи** и нажми **Save**.
     Теперь зарегистрироваться сам никто не может.
2. **Authentication → Users → Add user → Create new user**:
   - email и надёжный пароль;
   - галочка **Auto Confirm User** — включена.
3. **SQL Editor → New query**, подставь свой email и выполни:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role": "admin"}'::jsonb
   where email = 'ТВОЙ_EMAIL';

   select email, raw_app_meta_data from auth.users;
   ```

   В результате у твоего email в `raw_app_meta_data` должно быть `"role": "admin"`.
   Если роль выдана, когда ты уже был залогинен, — выйди из админки и войди снова.

---

## Шаг 5. Проверка

**До публикации (локально, с ветки `feature/admin`):**

```bash
npm run dev
```

Открой адрес из терминала с `/admin.html` на конце (обычно `http://localhost:5173/admin.html`),
войди. На странице «Обзор» все три строки должны быть зелёными:
вход, GitHub (репозиторий и ветка), последняя версия сайта.

Если что-то красное — пришли текст ошибки.

**После публикации** (когда я получу «да» и ветка попадёт в `main`):
админка будет по адресу **https://frnkness.ru/admin.html**.

---

## Что где лежит

| Что | Где |
| --- | --- |
| Аудит статистики | `supabase/audit/play_counts_audit.sql` |
| Миграции | `supabase/migrations/` |
| Edge Function | `supabase/functions/admin-content/` (`index.ts` — Deno, `handler.ts` — логика) |
| Белый список путей и проверки | `supabase/functions/_shared/rules.ts` |
| Код админки | `src/admin/`, точка входа `admin.html` |

### Секреты функции

| Имя | Что это |
| --- | --- |
| `GITHUB_TOKEN` | fine-grained токен из шага 1 |
| `BLOB_SIGNING_KEY` | случайный ключ подписи загрузок из шага 3.3 |
| `GITHUB_REPO` | необязательно, по умолчанию `mentanicarli/frnkness-collection` |
| `GITHUB_BRANCH` | необязательно, по умолчанию `main` |

`SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` Supabase подставляет в функцию сам.
