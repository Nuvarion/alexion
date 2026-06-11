# Расширение трекера задач: поля, вложения, комментарии

Дата: 2026-06-11

## Цель

Довести самописный канбан до уровня командного трекера: у задач появляются
приоритет, срок, исполнитель и видимые created/updated; к задачам и
комментариям можно прикреплять файлы; участники могут обсуждать задачу в
комментариях. Open source решения (Planka, Focalboard и т.п.) отклонены:
это отдельные приложения со своей БД и аутентификацией, их интеграция с
тимспейсами/RLS Alexion дороже, чем расширение своего канбана.

## Решения, принятые с пользователем

- Расширяем свой трекер, а не встраиваем стороннее решение.
- Приоритет: три уровня (низкий/средний/высокий) + «без приоритета» (null).
- Формат дат: настройка отображения из фиксированного списка, хранится в
  localStorage, применяется ко всем датам трекера.
- Файлы: до 5 МБ, исполняемые расширения запрещены; хранение в Supabase
  Storage (вариант «base64 в БД» отклонён: +33 % к размеру, расход более
  дефицитного лимита БД, тяжёлые строки в select и realtime).
- Комментарии: автор может редактировать и удалять свои; пометка «изменено».
- Вложения задач и комментариев — одна таблица `attachments`.
- Ссылки на страницы: триггер `[[` в описании задачи и комментариях;
  предлагаются только страницы пространства задачи.

## 1. Схема БД — миграция `0005_task_fields_comments_attachments.sql`

### Поля задач

`tasks.created_at` / `tasks.updated_at` уже существуют (включая триггер
`set_updated_at`) — изменения только на клиенте: начать их выбирать.

Новые колонки:

- `priority task_priority` — новый enum `('low', 'medium', 'high')`,
  nullable; null = без приоритета.
- `due_date date` — только дата, без времени.
- `assignee_id uuid references auth.users (id) on delete set null` —
  nullable.

Триггер `check_task_assignee` (before insert or update of assignee_id,
teamspace_id; security definer, как `check_page_space`):

- `assignee_id is null` — ок;
- задача командная (`teamspace_id is not null`) — исполнитель обязан быть
  участником этого тимспейса (`teamspace_members.user_id`);
- задача личная (`teamspace_id is null`) — исполнитель запрещён
  (raise exception).

Если участник позже покинет тимспейс, `assignee_id` остаётся (FK указывает
на auth.users, не на членство) — клиент показывает «(не участник)».
Повторная валидация при выходе участника не делается (v1).

### Комментарии — `task_comments`

```sql
create table task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks (id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index task_comments_task_idx on task_comments (task_id);
```

- Триггер `set_updated_at` (функция уже есть).
- RLS:
  - select / insert: видимость через задачу — `exists (select 1 from tasks
    where id = task_id)`; подзапрос выполняется под RLS вызывающего, поэтому
    наследует политики tasks (личное или членство). Для insert дополнительно
    `author_id = auth.uid()`.
  - update / delete: только `author_id = auth.uid()`; update with check
    запрещает менять author_id (`author_id = auth.uid()`).
- Пометка «изменено» на клиенте: `updated_at > created_at`.

### Вложения — `attachments`

```sql
create table attachments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks (id) on delete cascade,
  comment_id  uuid references task_comments (id) on delete cascade,
  file_path   text not null,          -- путь в Storage: <task_id>/<uuid>-<имя>
  file_name   text not null,
  size_bytes  integer not null,
  mime_type   text not null,
  created_by  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index attachments_task_idx on attachments (task_id);
create index attachments_comment_idx on attachments (comment_id);
```

- `task_id` заполнен всегда (и для файлов комментариев — задачей того
  комментария); `comment_id` заполнен только у файлов из комментариев.
- RLS: select/insert — видимость задачи (как у комментариев), insert
  дополнительно `created_by = auth.uid()`; delete — `created_by =
  auth.uid()`. Update не нужен (политики нет).

### Storage

- Приватный бакет `attachments`; создаётся в миграции инсертом в
  `storage.buckets` с `file_size_limit = 5 МБ`.
- Путь объекта: `<task_id>/<uuid>-<имя файла>`.
- Политики на `storage.objects` (bucket_id = 'attachments'):
  select / insert / delete — первый сегмент пути (`(storage.foldername(name))[1]`)
  приводится к uuid и должен быть id задачи, видимой пользователю под его
  RLS (`exists (select 1 from tasks where id = ...)`); для delete
  дополнительно `owner = auth.uid()`.
- Выдача файлов: signed URL на 1 час (`createSignedUrl`); для картинок —
  превью `<img>` по тому же signed URL.
- Клиентская валидация перед загрузкой: размер ≤ 5 МБ, чёрный список
  расширений (.exe, .dll, .bat, .cmd, .sh, .ps1, .msi, .apk, .com, .scr).
- Очистка Storage: метаданные каскадятся БД, файлы — клиентом. Перед
  `deleteTask` клиент удаляет объекты `<task_id>/*` из бакета; перед
  удалением комментария / отдельного вложения — соответствующие объекты.
  Ограничение v1: при обрыве между удалением строк и файлов объект может
  осиротеть; это принято.

### Realtime

`alter publication supabase_realtime add table task_comments, attachments;`

## 2. Клиент

### Типы (`src/lib/types.ts`)

- `TaskPriority = 'low' | 'medium' | 'high'`.
- `Task` += `priority: TaskPriority | null`, `due_date: string | null`,
  `assignee_id: string | null`, `created_at: string`, `updated_at: string`,
  `comment_count: number`, `attachment_count: number`.
- Новые `TaskComment`, `Attachment` по схеме таблиц.

### API и хуки (`src/features/kanban/`)

- `api.ts`: расширить `COLUMNS` новыми колонками и счётчиками
  `task_comments(count)`, `attachments(count)` (PostgREST-агрегация одним
  запросом); расширить `TaskPatch` (`priority`, `due_date`, `assignee_id`).
- Новые модули `comments.ts` (fetch/create/update/delete по task_id) и
  `attachments.ts` (list по task_id, upload в Storage + insert метаданных,
  delete файла + строки, signedUrl). Загрузка файла: валидация → upload в
  Storage → insert в `attachments`; при ошибке insert — удалить загруженный
  объект.
- Хуки `useComments(taskId)`, `useAttachments(taskId)` на TanStack Query;
  ключи `['comments', taskId]`, `['attachments', taskId]`.
- `useSpaceRealtime`: подписка на task_comments/attachments, инвалидация
  ключей по `task_id` события и списка задач (счётчики).

### Карточка задачи (`TaskCard.tsx`)

Бейджи под названием: цветная точка/бейдж приоритета; срок (красный, если
`due_date` в прошлом и статус не done); кружок с инициалами исполнителя
(по email участника); счётчики «📎 N» и «💬 N», если > 0.

### Модалка задачи

`TaskEditModal` разбивается на контейнер + подкомпоненты:

- `TaskFields` — название, описание, статус, приоритет, срок (нативный
  `<input type="date">`), исполнитель — `<select>` из участников тимспейса
  (email), пункт «Не назначено»; для личных задач селект скрыт.
- `AttachmentList` — список вложений задачи (без comment_id): превью для
  image/*, имя + размер + скачивание для остальных, удаление своих; кнопка
  загрузки.
- `CommentList` / `CommentComposer` — список комментариев (автор, дата,
  «изменено», вложения комментария, редактирование/удаление своих) и
  composer: textarea + прикрепление файлов + отправка. Файлы composer
  загружаются после создания комментария (получив его id).
- Внизу модалки: «Создана … · Обновлена …» в выбранном формате.

Имена людей: маппинг `user_id → email` из уже загружаемого списка
участников тимспейса; для личных задач автор всегда текущий пользователь;
неизвестный user_id → «(не участник)».

### Ссылки на страницы через `[[`

Работают в описании задачи и в комментариях. Изменений схемы БД не требуют —
ссылка живёт в тексте.

- **Формат токена**: `[[Заголовок|page:<uuid>]]`. Вставка кладёт текущий
  заголовок страницы — текст остаётся читаемым при редактировании.
  Рендер резолвит ссылку по uuid: живой заголовок берётся из кэша дерева
  страниц (`usePagesTree`), переименования видны сразу; заголовок из токена —
  fallback на время загрузки. Страница не найдена (удалена или нет
  доступа) — нессылочный текст «(страница недоступна)».
- **`MentionTextarea`** (`src/components/` или внутри фичи kanban) — обёртка
  над textarea: набор `[[` открывает дропдаун под полем со страницами
  пространства задачи (плоский список `PageMeta` из `usePagesTree`
  по `task.teamspace_id`), дальнейший ввод фильтрует по заголовку,
  Enter/клик вставляет токен и закрывает дропдаун, Esc — закрывает.
  Используется в редакторе описания и в composer комментариев.
- **`RichText`** + парсер (`src/lib/pageLinks.ts`): разбивает текст по
  regex токена, токены рендерит ссылками на страницу (существующий роут
  страницы), остальное — текстом. Комментарии в списке рендерятся через
  `RichText`.
- **Режим просмотра описания**: по умолчанию описание показывается как
  `RichText` с кликабельными ссылками; клик по тексту или кнопка
  «Редактировать» переключает в `MentionTextarea`.
- **Область**: командная задача — только страницы её тимспейса, личная —
  только личные страницы; ссылка гарантированно открывается у всех, кто
  видит задачу (RLS).

### Формат дат (`src/lib/dateFormat.ts`)

- Варианты: `DD.MM.YYYY`, `D MMM YYYY` (рус. локаль), `YYYY-MM-DD`,
  «относительный» («2 часа назад», «вчера»).
- created/updated в абсолютных форматах показываются с `HH:mm`;
  `due_date` — только дата во всех форматах.
- Реализация: `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat`, без новых
  зависимостей. Выбор в localStorage; селектор — в шапке канбан-страницы;
  React-контекст или простой хук с подпиской на изменение, чтобы карточки и
  модалка перерисовывались.

## Вне скоупа v1

- Импорт CSV с новыми полями (importTasksCsv не трогаем).
- Сжатие картинок перед загрузкой.
- Упоминания @ и уведомления.
- Перевалидация assignee при выходе участника из тимспейса.
- Фоновая сборка осиротевших объектов Storage.

## Тестирование

В проекте нет тестовой инфраструктуры — проверка ручная по чек-листу:

1. Миграция применяется на чистую схему 0001–0004 без ошибок.
2. Поля: выставить приоритет/срок/исполнителя в командной задаче; убедиться,
   что исполнитель выбирается только из участников; у личной задачи селекта
   исполнителя нет.
3. RLS: участник видит комментарии/вложения задач своего тимспейса и не
   видит чужих (проверка вторым аккаунтом); редактирование чужого
   комментария запрещено.
4. Файлы: загрузка ≤ 5 МБ ок; > 5 МБ и .exe отклоняются; превью картинок;
   скачивание по signed URL; удаление своего вложения удаляет и файл.
5. Комментарии: добавление/редактирование («изменено»)/удаление; файлы в
   комментарии; realtime-появление у второго участника.
6. Удаление задачи убирает её файлы из Storage.
7. Формат дат: переключение мгновенно меняет карточки и модалку,
   сохраняется после перезагрузки.
8. Ссылки `[[`: дропдаун открывается и фильтрует; в списке только страницы
   пространства задачи; вставленная ссылка кликабельна в описании и
   комментарии и ведёт на страницу; после переименования страницы ссылка
   показывает новый заголовок; после удаления — «(страница недоступна)».
