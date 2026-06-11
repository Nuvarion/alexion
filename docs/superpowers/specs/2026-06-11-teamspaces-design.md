# Teamspaces — командные пространства

Дата: 2026-06-11. Статус: дизайн утверждён, ждёт реализации.

## Цель

Командные пространства как в Notion: общее дерево страниц и общая канбан-доска,
доступные нескольким пользователям. Личные страницы и личная доска каждого
пользователя остаются приватными и работают как раньше.

## Решения (зафиксированы с пользователем)

- В teamspace входят **страницы и канбан** (у каждого тимспейса своя доска).
- Приглашение **по ссылке** (изменено после реализации: email-инвайт без SMTP
  признан бессмысленным). У тимспейса одна постоянная ссылка `/invite/<token>`
  (uuid, таблица `teamspace_invites`, видна и сбрасывается только владельцем).
  Переход по ссылке: незалогиненный → токен в localStorage → форма
  регистрации/входа → после входа AppLayout применяет RPC `accept_invite`
  (идемпотентно); залогиненный вступает сразу. Миграция `0004_invite_links.sql`
  удалила email-механизм (invite_member, claim_memberships).
- Роли: **владелец + участники**. Участники равноправно редактируют всё;
  владелец дополнительно управляет составом, именем и удалением тимспейса.
- Синхронизация: **Supabase Realtime на списках** (дерево страниц, задачи) —
  изменения видны без перезагрузки. Контент страницы — last-write-wins,
  без живого совместного редактирования (CRDT отложен).

## Архитектура: «всё — workspace» (пересмотрено)

Изначально был выбран вариант «nullable teamspace_id» (null = личное), но
для двунаправленного переноса страниц личное ↔ teamspace он потребовал бы
жонглирования user_id (личная принадлежность была завязана на авторство).
Решение пересмотрено (см. план 2026-06-11-workspace-model.md): личное
пространство — обычная строка `teamspaces` с `kind='personal'` (создаётся
при регистрации), `teamspace_id` у pages/tasks NOT NULL, `user_id` — просто
автор, перенос между пространствами = смена `teamspace_id` поддерева
(RPC `move_page_to_space`, доступен участнику обоих пространств).
Личный workspace нельзя удалить/переименовать/расшарить (нет invite-строки,
политики update/delete ограничены kind='team').

## БД — миграция `supabase/migrations/0002_teamspaces.sql`

Таблицы:

```
teamspaces:        id uuid pk, name text, owner_id uuid -> auth.users, created_at
teamspace_members: teamspace_id uuid -> teamspaces (cascade),
                   email text (хранится в lowercase),
                   user_id uuid null -> auth.users,
                   role text check in ('owner','member'),
                   created_at; unique (teamspace_id, email)
```

Изменения:

- `pages.teamspace_id uuid null -> teamspaces on delete cascade` + индекс;
- `tasks.teamspace_id` — аналогично;
- создание тимспейса — только через RPC `create_teamspace(name)`
  (security definer): атомарно вставляет строку в `teamspaces` и запись
  владельца в `teamspace_members`, возвращает id. Двухшаговая вставка с
  клиента запрещена: select-политика `teamspaces` опирается на членство,
  и между двумя вставками пространство было бы невидимо своему создателю.

Функции/триггеры:

- `is_space_member(space_id uuid) returns boolean` — security definer,
  `exists(select 1 from teamspace_members where teamspace_id = space_id
  and user_id = auth.uid())`; используется в политиках, чтобы избежать
  рекурсии RLS;
- `create_teamspace(name text) returns uuid` — security definer; атомарно
  создаёт тимспейс с `owner_id = auth.uid()` и запись владельца в участниках;
- `invite_member(space_id uuid, member_email text)` — security definer;
  проверяет, что вызывающий — владелец; нормализует email в lowercase;
  ищет user_id в `auth.users` по email; вставляет участника (или возвращает
  ошибку при дубле);
- триггер на `auth.users` after insert: `update teamspace_members
  set user_id = new.id where email = lower(new.email) and user_id is null` —
  приглашённый «подхватывает» членство при регистрации.

RLS:

- `pages`, `tasks` (все четыре операции, политики переписываются):
  `(teamspace_id is null and user_id = auth.uid()) or is_space_member(teamspace_id)`;
  для insert — `with check` то же самое;
- `teamspaces`: select — участник (`is_space_member(id)`); insert —
  `owner_id = auth.uid()`; update/delete — владелец;
- `teamspace_members`: select — участник тимспейса (видит состав своих
  пространств, в т.ч. строки с user_id null); insert/delete — владелец
  тимспейса (insert обычно через RPC); update — никому (только триггер);
  участник может удалить **свою** строку («покинуть»).

`user_id` на строках pages/tasks остаётся автором строки (default auth.uid()).

## Фронтенд

Новая фича `src/features/teamspaces/`:

- `api.ts` — fetchTeamspaces (с участниками), createTeamspace, renameTeamspace,
  deleteTeamspace, inviteMember (RPC), removeMember, leaveTeamspace;
- `useTeamspaces.ts` — query `['teamspaces']`;
- `TeamspaceSettingsModal.tsx` — переименование, состав, инвайт по email
  (показывает «ожидает регистрации» для user_id null), удаление участника,
  «покинуть» (участник), удаление тимспейса (владелец, с confirm);
- `CreateTeamspaceButton.tsx` — кнопка + prompt/inline-форма имени.

Изменения существующего:

- `pages/api.ts`, `usePagesTree`, `usePageMutations`, `Sidebar`,
  `PageTreeItem`, `treeDnd`: всюду появляется параметр `spaceId: string | null`;
  query-ключи — `['pages', spaceId]`; фильтр `eq('teamspace_id', spaceId)` /
  `is('teamspace_id', null)`; insert проставляет `teamspace_id`;
- сайдбар: секция «Личное» + секция на каждый тимспейс (заголовок с именем
  и шестерёнкой настроек), у каждой секции своё дерево и свой «+»;
  внизу «+ Новый teamspace»;
- dnd: каждый тимспейс — отдельный `DndContext`; перенос между пространствами
  в v1 невозможен;
- канбан: селектор пространства (Личное / тимспейсы) над доской,
  ключ `['tasks', spaceId]`, insert с `teamspace_id`;
- переезд ссылок при переносе страницы (pageLinks) работает как есть —
  внутри одного пространства;
- импорт из Notion — всегда в личное пространство (без изменений).

## Realtime

Хук `useRealtimeSpace(spaceId)` (или один общий хук на все видимые
пространства): `supabase.channel(...)` с `postgres_changes` на `pages` и
`tasks` (фильтр по `teamspace_id=eq.<id>`), на событие — debounce-инвалидация
`['pages', spaceId]` / `['tasks', spaceId]` (и `['page', id]` для update
контента). События фильтруются RLS (private channels / authenticated).
Для личного пространства realtime не включаем — там один пользователь.
В Supabase Dashboard таблицы добавляются в публикацию
`supabase_realtime` (или это делает миграция: `alter publication
supabase_realtime add table pages, tasks`).

Открытая страница: чужой update приходит событием → инвалидация
`['page', id]` → рефетч → ремаунт редактора по `dataUpdatedAt`
(механизм уже существует). Одновременный набор текста двумя людьми —
last-write-wins; это осознанное ограничение v1.

## Вне скоупа v1

- Роль «читатель» (read-only), живые курсоры/CRDT;
- перенос страниц между пространствами (включая «личное → команда»);
- инвайт-ссылки; отправка email-уведомлений;
- импорт из Notion в teamspace.

## Критерии приёмки

1. Пользователь A создаёт тимспейс, приглашает B по email (B уже
   зарегистрирован) — B сразу видит секцию тимспейса, создаёт/редактирует
   страницы и задачи в нём; A видит изменения B без перезагрузки.
2. Приглашение незарегистрированного email: после регистрации с этим email
   тимспейс появляется автоматически.
3. Личные страницы A не видны B и наоборот; RLS не позволяет читать чужие
   личные строки даже прямым запросом к PostgREST.
4. Владелец удаляет участника — у того секция исчезает (после рефетча),
   доступ к строкам закрыт.
5. Существующие личные данные и сценарии (дерево, dnd, импорт, ссылки)
   работают без изменений.
