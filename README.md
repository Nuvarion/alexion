# Alexion

Личный аналог Notion: заметки с блочным редактором (текст + код с подсветкой),
вложенные страницы до 10 уровней, минималистичный kanban-трекер задач и импорт
экспорта Notion (Markdown & CSV). Мульти-пользовательский: у каждого аккаунта
свои данные (Row Level Security).

Стек: React 19 + Vite + TypeScript, [BlockNote](https://www.blocknotejs.org)
(редактор), [Supabase](https://supabase.com) (Postgres + Auth, free tier),
@dnd-kit (drag & drop), TanStack Query. Хостинг: Cloudflare Pages (free).

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
2. SQL Editor → вставить содержимое `supabase/migrations/0001_init.sql` → Run.
3. Authentication → Sign In / Up → отключить «Confirm email» (или настроить SMTP).
4. Authentication → URL Configuration → Site URL = адрес прод-сайта,
   в Additional Redirect URLs добавить `http://localhost:5173`.
5. Project Settings → API: скопировать Project URL и anon/publishable key.

### 2. Cloudflare Pages

1. Запушить репозиторий на GitHub.
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Build command: `yarn build`, output: `dist`.
4. Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (из шага 1.5).

SPA-fallback уже настроен (`public/_redirects`).

### 3. Keep-alive (важно)

Supabase free паузит проект после 7 дней без запросов к БД (после 90 дней паузы
восстановление сильно усложняется). В репозитории есть
`.github/workflows/keep-alive.yml` — пингует БД дважды в неделю. В настройках
GitHub-репозитория → Secrets and variables → Actions добавить:

- `SUPABASE_URL` — Project URL
- `SUPABASE_ANON_KEY` — anon/publishable key

## Импорт из Notion

Notion → Settings → Export content → «Markdown & CSV» → загрузить zip на
странице «Импорт». Страницы попадают в контейнер «Imported <дата>» с
сохранением иерархии (глубже лимита — поднимаются с отчётом), выбранный CSV
импортируется в задачи. Вложения (картинки/файлы) не переносятся.

## Структура

```
supabase/migrations/   схема: pages, tasks, RLS, триггер глубины
src/lib/               клиент Supabase, типы, fractional indexing
src/hooks/             useDebouncedSave (debounce + flush)
src/features/auth/     сессия, формы входа/регистрации, ProtectedRoute
src/features/pages/    дерево страниц, редактор BlockNote, автосейв, крошки
src/features/kanban/   доска, конфиг колонок, optimistic drag&drop
src/features/import/   разбор Notion-zip (чистый), импорт страниц и CSV
```
