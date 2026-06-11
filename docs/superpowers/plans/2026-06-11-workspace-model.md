# Workspace Model + Cross-Space DnD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Коммиты делает ТОЛЬКО пользователь. Тестов нет: проверка = `yarn build` + `yarn lint` + браузер. Прод-миграции применяет пользователь (SQL Editor), локально — `npx supabase migration up`.

**Goal:** Личное пространство становится обычным workspace (`kind='personal'`), `teamspace_id` обязателен; перенос страниц между любыми пространствами через drag&drop в сайдбаре.

**Architecture:** Миграция 0005 (kind, backfill, NOT NULL, триггер личного workspace на регистрацию, упрощённые RLS, RPC `move_page_to_space` с BFS-переездом поддерева). Фронтенд: `spaceId: string` (не nullable), «Личное» = workspace kind='personal'; единый DndContext на весь сайдбар; кросс-пространственный дроп → RPC.

**Tech Stack:** Supabase (RLS, RPC, plpgsql), React 19, TanStack Query v5, dnd-kit.

Спека: docs/superpowers/specs/2026-06-11-teamspaces-design.md (раздел «Архитектура» обновлён).

---

### Task A: Миграция 0005_personal_workspaces.sql

**Files:** Create `supabase/migrations/0005_personal_workspaces.sql`

Содержимое (целиком):

```sql
-- Всё — workspace: личное пространство становится обычной строкой teamspaces
-- (kind='personal'), teamspace_id у pages/tasks обязателен. Перенос страницы
-- между пространствами = смена teamspace_id поддерева (move_page_to_space).

alter table teamspaces add column kind text not null default 'team'
  check (kind in ('personal', 'team'));

-- личные workspace для существующих пользователей + членство владельца
insert into teamspaces (name, owner_id, kind)
  select 'Личное', id, 'personal' from auth.users;

insert into teamspace_members (teamspace_id, email, user_id, role)
  select t.id, lower(u.email), u.id, 'owner'
  from teamspaces t
  join auth.users u on u.id = t.owner_id
  where t.kind = 'personal';

-- данные без пространства переезжают в личные workspace своих владельцев
update pages p
  set teamspace_id = t.id
  from teamspaces t
  where p.teamspace_id is null and t.kind = 'personal' and t.owner_id = p.user_id;

update tasks k
  set teamspace_id = t.id
  from teamspaces t
  where k.teamspace_id is null and t.kind = 'personal' and t.owner_id = k.user_id;

alter table pages alter column teamspace_id set not null;
alter table tasks alter column teamspace_id set not null;

-- личный workspace создаётся при регистрации
create function setup_personal_space() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
begin
  insert into teamspaces (name, owner_id, kind)
    values ('Личное', new.id, 'personal')
    returning id into ws;
  insert into teamspace_members (teamspace_id, email, user_id, role)
    values (ws, lower(new.email), new.id, 'owner');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function setup_personal_space();

-- личный workspace нельзя переименовать/удалить (и расшарить — у него нет
-- invite-строки); политики update/delete сужаются до kind='team'
drop policy teamspaces_update on teamspaces;
drop policy teamspaces_delete on teamspaces;
create policy teamspaces_update on teamspaces for update
  using (auth.uid() = owner_id and kind = 'team')
  with check (auth.uid() = owner_id and kind = 'team');
create policy teamspaces_delete on teamspaces for delete
  using (auth.uid() = owner_id and kind = 'team');

-- pages/tasks: доступ только по членству (особый случай null исчез)
drop policy pages_select on pages;
drop policy pages_insert on pages;
drop policy pages_update on pages;
drop policy pages_delete on pages;
create policy pages_select on pages for select using (is_space_member(teamspace_id));
create policy pages_insert on pages for insert with check (is_space_member(teamspace_id));
create policy pages_update on pages for update
  using (is_space_member(teamspace_id)) with check (is_space_member(teamspace_id));
create policy pages_delete on pages for delete using (is_space_member(teamspace_id));

drop policy tasks_select on tasks;
drop policy tasks_insert on tasks;
drop policy tasks_update on tasks;
drop policy tasks_delete on tasks;
create policy tasks_select on tasks for select using (is_space_member(teamspace_id));
create policy tasks_insert on tasks for insert with check (is_space_member(teamspace_id));
create policy tasks_update on tasks for update
  using (is_space_member(teamspace_id)) with check (is_space_member(teamspace_id));
create policy tasks_delete on tasks for delete using (is_space_member(teamspace_id));

-- ветка «личная страница другого пользователя» в проверке родителя умерла:
-- личное теперь тоже workspace, достаточно равенства пространств
create or replace function check_page_space() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent pages%rowtype;
begin
  if new.parent_id is null then
    return new;
  end if;
  select * into parent from pages where id = new.parent_id;
  if not found then
    raise exception 'parent page not found';
  end if;
  if parent.teamspace_id is distinct from new.teamspace_id then
    raise exception 'parent page belongs to another space';
  end if;
  return new;
end $$;

-- Перенос страницы (со всем поддеревом) в другое пространство.
-- Поддерево переезжает сверху вниз по уровням: pages_space_check сверяет
-- родителя, поэтому ребёнок может переехать только после своего родителя.
create function move_page_to_space(
  page_id uuid,
  target_space_id uuid,
  new_parent_id uuid,
  new_position double precision
) returns void
language plpgsql security definer set search_path = public as $$
declare
  src uuid;
  parent_depth int;
  subtree_height int;
  lvl_i int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select teamspace_id into src from pages where id = page_id;
  if src is null then
    raise exception 'page not found';
  end if;
  if not is_space_member(src) or not is_space_member(target_space_id) then
    raise exception 'not a member of source or target space';
  end if;
  if new_parent_id is not null and not exists (
    select 1 from pages where id = new_parent_id and teamspace_id = target_space_id
  ) then
    raise exception 'parent page belongs to another space';
  end if;

  create temp table _subtree on commit drop as
    with recursive sub as (
      select id, 0 as lvl from pages where id = page_id
      union all
      select p.id, sub.lvl + 1
      from pages p
      join sub on p.parent_id = sub.id
      where sub.lvl < 17
    )
    select id, lvl from sub;

  if exists (select 1 from _subtree where id = new_parent_id) then
    raise exception 'cannot move page into its own subtree';
  end if;

  -- глубина проверяется для всего поддерева, не только корня
  select coalesce(max(lvl), 0) into subtree_height from _subtree;
  if new_parent_id is null then
    parent_depth := 0;
  else
    with recursive anc as (
      select id, parent_id, 1 as d from pages where id = new_parent_id
      union all
      select p.id, p.parent_id, anc.d + 1
      from pages p join anc on p.id = anc.parent_id
      where anc.d < 17
    )
    select max(d) into parent_depth from anc;
  end if;
  if parent_depth + 1 + subtree_height > 15 then
    raise exception 'max page depth (15) exceeded';
  end if;

  update pages
    set teamspace_id = target_space_id, parent_id = new_parent_id, position = new_position
    where id = page_id;

  for lvl_i in select distinct lvl from _subtree where lvl > 0 order by lvl loop
    update pages set teamspace_id = target_space_id
      where id in (select id from _subtree where lvl = lvl_i);
  end loop;
end $$;

revoke execute on function move_page_to_space(uuid, uuid, uuid, double precision) from public;
grant execute on function move_page_to_space(uuid, uuid, uuid, double precision) to authenticated;
```

- [ ] A1. Создать файл, применить локально (`npx supabase migration up`).
- [ ] A2. psql-проверки: `select kind, count(*) from teamspaces group by kind`; `select count(*) from pages where teamspace_id is null` → 0; политики pages/tasks по 4 (using is_space_member); функции setup_personal_space/move_page_to_space существуют; функциональный тест move_page_to_space в транзакции с rollback (тестовый пользователь, два пространства, поддерево 2 уровня: после переноса все строки в целевом; перенос в своё поддерево падает; превышение глубины падает).
- [ ] A3. Прод НЕ трогать (пользователь применит сам).

---

### Task B: фронтенд — spaceId становится string, «Личное» = personal workspace

**Files:** Modify: `src/lib/types.ts`, `src/features/teamspaces/api.ts`, `useTeamspaces.ts`, `useSpaceRealtime.ts`, `src/components/AppLayout.tsx`, `src/features/pages/{api,usePagesTree,usePageMutations,Breadcrumbs,HomePage,Sidebar,SpaceTree,PageTreeItem}.ts(x)`, `src/features/kanban/{api,useTasks,KanbanPage,KanbanColumn,TaskEditModal}.ts(x)`, `src/features/import/{ImportPage,importPages,importTasksCsv}.ts(x)`

- [ ] B1. `types.ts`: `Teamspace.kind: 'personal' | 'team'`; `PageMeta.teamspace_id: string`; `Task.teamspace_id: string`.
- [ ] B2. `teamspaces/api.ts`: SPACE_COLUMNS + `kind`. `useTeamspaces.ts`: добавить хелпер
  ```ts
  // Личный workspace пользователя; undefined, пока список не загружен
  export function usePersonalSpace() {
    const { data: spaces, ...rest } = useTeamspaces()
    return { personal: spaces?.find((s) => s.kind === 'personal'), spaces, ...rest }
  }
  ```
- [ ] B3. Sweep `spaceId: string | null` → `string` во всех pages/tasks слоях (api: убрать ветку `.is('teamspace_id', null)` — всегда `.eq`; insert всегда с teamspace_id). `useCreateTask` подставляет spaceId как раньше.
- [ ] B4. `Sidebar.tsx`: `usePersonalSpace()`; секция «Личное» — `<SpaceTree spaceId={personal.id} />` без шестерёнки (заголовок «Личное» фиксированный), рендерится только когда personal загружен (иначе «Загрузка…»); команды — `spaces.filter(kind==='team')`. localStorage-ключ expanded: использовать space id.
- [ ] B5. `HomePage.tsx`: `usePersonalSpace()` → дерево личного; пока не загружено — спиннер.
- [ ] B6. Канбан: селектор — personal.id по умолчанию (value=spaceId, опция «Личное» = personal.id, команды отдельно); до загрузки personal — спиннер. Все хуки строковый spaceId.
- [ ] B7. Импорт: `importPages(..., spaceId)` и `importTasksCsv(text, spaceId)` — `PageInsert.teamspace_id: string` обязателен, NewTask как есть; ImportPage берёт personal.id из usePersonalSpace (кнопка импорта disabled пока не загружен).
- [ ] B8. `useSpaceRealtime`: подписка только на `kind==='team'` (AppLayout: `spaces.filter(...)`).
- [ ] B9. `Breadcrumbs`: spaceId: string. PageView передаёт page.teamspace_id (теперь string).
- [ ] B10. `yarn build` + `yarn lint` чистые; `grep -rn "teamspace_id: string | null\|string | null = null\|is('teamspace_id'" src/` — пусто (кроме осознанных мест, которых не должно остаться).

---

### Task C: единый DndContext + кросс-пространственный перенос

**Files:** Modify: `src/features/pages/Sidebar.tsx`, `SpaceTree.tsx`, `treeDnd.ts`, `usePageMutations.ts`, `api.ts` (pages)

- [ ] C1. `pages/api.ts`: добавить
  ```ts
  export async function movePageToSpace(
    id: string,
    targetSpaceId: string,
    parentId: string | null,
    position: number,
  ): Promise<void> {
    const { error } = await supabase.rpc('move_page_to_space', {
      page_id: id,
      target_space_id: targetSpaceId,
      new_parent_id: parentId,
      new_position: position,
    })
    if (error) throw error
  }
  ```
- [ ] C2. `treeDnd.ts`: `ROOT_END_ID` → функция `rootEndId(spaceId: string)` = `` `root-end:${spaceId}` ``; `computeDrop` принимает целевое дерево и возвращает дополнительно `targetSpaceId` (определяется по teamspace_id целевой страницы / по spaceId зоны root-end). `MovePageInput` + `targetSpaceId: string, sourceSpaceId: string`.
- [ ] C3. Поднять DndContext из SpaceTree в Sidebar: Sidebar владеет drag-state, сенсорами, обработчиками, DragOverlay; SpaceTree остаётся рендером дерева одной секции (droppable/draggable регистрируются в общий контекст через React-дерево). Expanded-state поднять в Sidebar: `Map<spaceId, Set<string>>` (+ localStorage per space, как сейчас), toggle передаётся вниз. handleDragEnd: собрать все деревья (`usePagesTree` для personal + каждой команды уже смонтированы — кэш; Sidebar читает их через queryClient.getQueryData(['pages', spaceId]) + buildTree, либо хранит реестр деревьев из SpaceTree через callback — выбрать вариант с getQueryData+buildTree, он без новых связей).
- [ ] C4. `useMovePage`: если `targetSpaceId === sourceSpaceId` — старый путь `movePage`; иначе `movePageToSpace` + переезд ссылки (логика pageLinks уже в mutationFn — оставить, работает по id); optimistic-обновление: убрать страницу из `['pages', source]` и НЕ добавлять в target (придёт инвалидацией), onSettled инвалидирует оба списка.
- [ ] C5. Превышение глубины при кросс-дропе — уже считается на дропе (toast); цель в своём поддереве — невозможна (поддерево в исходном пространстве, цель в другом… при переносе в ТО ЖЕ пространство работает старый запрет invalidIds; RPC дублирует проверку на сервере).
- [ ] C6. `yarn build`, `yarn lint`; браузером: перенос личное→команда (страница с детьми; ссылка переехала в нового родителя), команда→личное, команда→команда, внутри пространства — регресс.

---

### Task D: приёмка

- [ ] D1. Регресс: дерево/создание/удаление/dnd внутри пространства, канбан, импорт (в личное), инвайт-ссылка.
- [ ] D2. Кросс-перенос обоих направлений двумя аккаунтами: страница, перенесённая участником A из команды в личное, исчезает у B (realtime/рефетч) и появляется только у A.
- [ ] D3. Новая регистрация → личный workspace создан автоматически, старые сценарии работают.
