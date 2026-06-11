# Alexion

Аналог Notion: заметки с блочным редактором (текст + код с подсветкой),
вложенные страницы до 15 уровней, kanban-трекер задач, импорт экспорта Notion
(Markdown & CSV) и командные пространства (teamspaces) с приглашением по
ссылке. Перенос страниц drag & drop между любыми пространствами. Доступ
разграничен через Row Level Security.

Стек: React 19 + Vite + TypeScript, [BlockNote](https://www.blocknotejs.org)
(редактор), [Supabase](https://supabase.com) (Postgres + Auth + Realtime,
free tier), @dnd-kit (drag & drop), TanStack Query. Хостинг: GitHub Pages.

## Локальная разработка

Нужны Node 22+ и Docker (для локального Supabase).

```bash
yarn install
npx supabase start        # поднимает локальный Postgres+Auth, применяет миграции
yarn start                # http://localhost:5173
```

После `supabase start` возьми `API URL` и `Publishable key` из вывода
(`npx supabase status`) и положи в `.env.local`:

```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<publishable key>
```

## Развёртывание (бесплатно)

### 1. Supabase

1. [supabase.com](https://supabase.com) → New project (Free).
2. SQL Editor → выполнить миграции из `supabase/migrations/` по порядку
   (0001 → 0005).
3. Authentication → Sign In / Up → отключить «Confirm email» (или настроить SMTP).
4. Authentication → URL Configuration → Site URL = адрес прод-сайта,
   в Additional Redirect URLs добавить `http://localhost:5173`.
5. Project Settings → API Keys: скопировать Project URL и publishable key.

### 2. GitHub Pages

1. Запушить репозиторий на GitHub (base-путь в `vite.config.ts` совпадает
   с именем репозитория: `/alexion/`).
2. Settings → Pages → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → секреты:
   - `VITE_SUPABASE_URL` — Project URL (для сборки);
   - `VITE_SUPABASE_ANON_KEY` — publishable key (для сборки).
4. Пуш в `main` запускает `.github/workflows/deploy.yml`: сборка, SPA-fallback
   (копия `index.html` → `404.html`), публикация. Сайт:
   `https://<логин>.github.io/alexion/`.

### 3. Keep-alive (важно)

Supabase free паузит проект после 7 дней без запросов к БД (после 90 дней паузы
восстановление сильно усложняется). В репозитории есть
`.github/workflows/keep-alive.yml` — пингует БД дважды в неделю. Для него нужны
ещё два секрета:

- `SUPABASE_URL` — Project URL
- `SUPABASE_ANON_KEY` — publishable key

## Импорт из Notion

Notion → Settings → Export content → «Markdown & CSV» → загрузить zip на
странице «Импорт». Страницы попадают в контейнер «Imported <дата>» с
сохранением иерархии (глубже лимита — поднимаются с отчётом), внутренние
ссылки переписываются на созданные страницы, выбранный CSV импортируется в
задачи. Вложения (картинки/файлы) не переносятся.

## Структура

```
supabase/migrations/      схема: pages, tasks, teamspaces, RLS, RPC, триггеры
src/lib/                  клиент Supabase, типы, fractional indexing
src/hooks/                useDebouncedSave (debounce + flush)
src/components/           layout, тосты
src/features/auth/        сессия, формы входа/регистрации, ProtectedRoute
src/features/pages/       деревья пространств, редактор BlockNote, dnd, крошки
src/features/kanban/      доска с пространствами, optimistic drag&drop
src/features/teamspaces/  пространства, инвайт-ссылки, realtime, настройки
src/features/import/      разбор Notion-zip (чистый), импорт страниц и CSV
```
