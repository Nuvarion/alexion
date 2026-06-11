# Teamspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Правила проекта:** коммиты выполняет ТОЛЬКО пользователь — шаги «Коммит» означают «остановись и предложи пользователю сообщение коммита». Тестового раннера в проекте нет: проверка = `yarn build` + `yarn lint` + сценарий в браузере (dev-сервер `yarn start`, Playwright MCP или вручную). `.env.local` указывает на ПРОД-Supabase — миграцию применять и в прод (SQL Editor), и локально.

**Goal:** Командные пространства (общее дерево страниц + общий канбан) для нескольких пользователей, с инвайтом по email и realtime-обновлением списков.

**Architecture:** Nullable `teamspace_id` в `pages`/`tasks` (null = личное), таблицы `teamspaces`/`teamspace_members`, RLS через security-definer `is_space_member()`, создание/инвайт через RPC. Фронтенд: все pages/tasks-запросы параметризуются `spaceId`, сайдбар рендерит секцию на пространство, realtime — postgres_changes → инвалидация query-ключей.

**Tech Stack:** Supabase (Postgres RLS, RPC, Realtime), React 19, TanStack Query v5, react-router 7, dnd-kit.

Спека: `docs/superpowers/specs/2026-06-11-teamspaces-design.md`.

---

### Task 1: Миграция БД

**Files:**
- Create: `supabase/migrations/0002_teamspaces.sql`

- [ ] **Step 1.1: Создать файл миграции** со следующим содержимым (целиком):

```sql
-- Teamspaces: общие пространства (страницы + канбан) для нескольких пользователей.
-- null в pages.teamspace_id / tasks.teamspace_id = личные данные (как раньше).

create table teamspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table teamspace_members (
  teamspace_id uuid not null references teamspaces (id) on delete cascade,
  email        text not null,
  user_id      uuid references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (teamspace_id, email)
);

create index teamspace_members_user_idx on teamspace_members (user_id);

alter table pages add column teamspace_id uuid references teamspaces (id) on delete cascade;
create index pages_space_idx on pages (teamspace_id);
alter table tasks add column teamspace_id uuid references teamspaces (id) on delete cascade;
create index tasks_space_idx on tasks (teamspace_id);

-- security definer, чтобы политики pages/tasks/teamspaces не рекурсировали
-- в RLS самих teamspace_members
create function is_space_member(space_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from teamspace_members
    where teamspace_id = space_id and user_id = auth.uid()
  );
$$;

-- Создание тимспейса атомарно с записью владельца: select-политика
-- teamspaces опирается на членство, двухшаговая вставка с клиента
-- оставила бы пространство невидимым создателю.
create function create_teamspace(space_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if length(trim(space_name)) = 0 then
    raise exception 'teamspace name must not be empty';
  end if;
  insert into teamspaces (name, owner_id)
    values (trim(space_name), auth.uid())
    returning id into new_id;
  insert into teamspace_members (teamspace_id, email, user_id, role)
    select new_id, lower(email), id, 'owner' from auth.users where id = auth.uid();
  return new_id;
end $$;

create function invite_member(space_id uuid, member_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  normalized text := lower(trim(member_email));
  existing_user uuid;
begin
  if not exists (select 1 from teamspaces where id = space_id and owner_id = auth.uid()) then
    raise exception 'only the owner can invite members';
  end if;
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email';
  end if;
  select id into existing_user from auth.users where lower(email) = normalized limit 1;
  insert into teamspace_members (teamspace_id, email, user_id, role)
    values (space_id, normalized, existing_user, 'member');
end $$;

-- Приглашённый без аккаунта «подхватывает» членство при регистрации
create function claim_memberships() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update teamspace_members set user_id = new.id
  where email = lower(new.email) and user_id is null;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function claim_memberships();

revoke execute on function create_teamspace(text) from public;
revoke execute on function invite_member(uuid, text) from public;
grant execute on function create_teamspace(text) to authenticated;
grant execute on function invite_member(uuid, text) to authenticated;

-- RLS

alter table teamspaces enable row level security;
alter table teamspace_members enable row level security;

create policy teamspaces_select on teamspaces for select using (is_space_member(id));
create policy teamspaces_update on teamspaces for update
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy teamspaces_delete on teamspaces for delete using (auth.uid() = owner_id);
-- insert-политики нет: создание только через RPC create_teamspace

create policy members_select on teamspace_members for select using (is_space_member(teamspace_id));
-- удалить участника может владелец, выйти — сам участник; owner-строка неприкосновенна
create policy members_delete on teamspace_members for delete using (
  role <> 'owner' and (
    user_id = auth.uid()
    or exists (select 1 from teamspaces t where t.id = teamspace_id and t.owner_id = auth.uid())
  )
);
-- insert только через RPC, update только триггером — политик нет

-- pages/tasks: личное ИЛИ членство в тимспейсе строки
drop policy pages_select on pages;
drop policy pages_insert on pages;
drop policy pages_update on pages;
drop policy pages_delete on pages;

create policy pages_select on pages for select
  using ((teamspace_id is null and auth.uid() = user_id) or is_space_member(teamspace_id));
create policy pages_insert on pages for insert
  with check ((teamspace_id is null and auth.uid() = user_id) or is_space_member(teamspace_id));
create policy pages_update on pages for update
  using ((teamspace_id is null and auth.uid() = user_id) or is_space_member(teamspace_id))
  with check ((teamspace_id is null and auth.uid() = user_id) or is_space_member(teamspace_id));
create policy pages_delete on pages for delete
  using ((teamspace_id is null and auth.uid() = user_id) or is_space_member(teamspace_id));

drop policy tasks_select on tasks;
drop policy tasks_insert on tasks;
drop policy tasks_update on tasks;
drop policy tasks_delete on tasks;

create policy tasks_select on tasks for select
  using ((teamspace_id is null and auth.uid() = user_id) or is_space_member(teamspace_id));
create policy tasks_insert on tasks for insert
  with check ((teamspace_id is null and auth.uid() = user_id) or is_space_member(teamspace_id));
create policy tasks_update on tasks for update
  using ((teamspace_id is null and auth.uid() = user_id) or is_space_member(teamspace_id))
  with check ((teamspace_id is null and auth.uid() = user_id) or is_space_member(teamspace_id));
create policy tasks_delete on tasks for delete
  using ((teamspace_id is null and auth.uid() = user_id) or is_space_member(teamspace_id));

-- Realtime: события изменений pages/tasks (фильтрация по RLS на стороне Supabase)
alter publication supabase_realtime add table pages, tasks;
```

- [ ] **Step 1.2: Применить локально** (если поднят локальный Supabase): `npx supabase migration up`. Если локальный стек не используется — пропустить.

- [ ] **Step 1.3: Применить в прод**: содержимое файла → Supabase Dashboard → SQL Editor → Run. Ожидаемо: Success, без ошибок.

- [ ] **Step 1.4: Проверить SQL-ом** (SQL Editor):

```sql
select is_space_member(gen_random_uuid());                -- false, функция работает
select count(*) from pages where teamspace_id is not null; -- 0
```

- [ ] **Step 1.5: Проверить, что старое не сломалось**: открыть приложение, дерево личных страниц и канбан загружаются как раньше.

- [ ] **Step 1.6: Пауза — предложить пользователю коммит** «Teamspaces: миграция — таблицы, RLS, RPC, realtime-публикация».

---

### Task 2: Типы и API тимспейсов

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/features/teamspaces/api.ts`
- Create: `src/features/teamspaces/useTeamspaces.ts`

- [ ] **Step 2.1: Добавить типы** в конец `src/lib/types.ts`:

```ts
export interface Teamspace {
  id: string
  name: string
  owner_id: string
}

export interface TeamspaceMember {
  teamspace_id: string
  email: string
  user_id: string | null
  role: 'owner' | 'member'
}
```

И добавить `teamspace_id` в `PageMeta` (нужен Breadcrumbs, чтобы знать пространство страницы):

```ts
export interface PageMeta {
  id: string
  parent_id: string | null
  title: string
  position: number
  teamspace_id: string | null
}
```

- [ ] **Step 2.2: Создать `src/features/teamspaces/api.ts`**:

```ts
import { supabase } from '../../lib/supabase'
import type { Teamspace, TeamspaceMember } from '../../lib/types'

export async function fetchTeamspaces(): Promise<Teamspace[]> {
  const { data, error } = await supabase
    .from('teamspaces')
    .select('id, name, owner_id')
    .order('created_at')
  if (error) throw error
  return data
}

export async function fetchMembers(spaceId: string): Promise<TeamspaceMember[]> {
  const { data, error } = await supabase
    .from('teamspace_members')
    .select('teamspace_id, email, user_id, role')
    .eq('teamspace_id', spaceId)
    .order('created_at')
  if (error) throw error
  return data as TeamspaceMember[]
}

export async function createTeamspace(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_teamspace', { space_name: name })
  if (error) throw error
  return data as string
}

export async function inviteMember(spaceId: string, email: string): Promise<void> {
  const { error } = await supabase.rpc('invite_member', {
    space_id: spaceId,
    member_email: email,
  })
  if (error) throw error
}

// и «удалить участника» (владелец), и «покинуть» (сам участник)
export async function removeMember(spaceId: string, email: string): Promise<void> {
  const { error } = await supabase
    .from('teamspace_members')
    .delete()
    .match({ teamspace_id: spaceId, email })
  if (error) throw error
}

export async function renameTeamspace(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('teamspaces').update({ name }).eq('id', id)
  if (error) throw error
}

export async function deleteTeamspace(id: string): Promise<void> {
  const { error } = await supabase.from('teamspaces').delete().eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 2.3: Создать `src/features/teamspaces/useTeamspaces.ts`**:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createTeamspace,
  deleteTeamspace,
  fetchMembers,
  fetchTeamspaces,
  inviteMember,
  removeMember,
  renameTeamspace,
} from './api'

export function useTeamspaces() {
  return useQuery({ queryKey: ['teamspaces'], queryFn: fetchTeamspaces })
}

export function useMembers(spaceId: string) {
  return useQuery({
    queryKey: ['teamspace-members', spaceId],
    queryFn: () => fetchMembers(spaceId),
  })
}

function useInvalidateSpaces() {
  const queryClient = useQueryClient()
  return (spaceId?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['teamspaces'] })
    if (spaceId) {
      void queryClient.invalidateQueries({ queryKey: ['teamspace-members', spaceId] })
    }
  }
}

export function useCreateTeamspace() {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: (name: string) => createTeamspace(name),
    onSuccess: () => invalidate(),
  })
}

export function useInviteMember() {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: ({ spaceId, email }: { spaceId: string; email: string }) =>
      inviteMember(spaceId, email),
    onSuccess: (_d, { spaceId }) => invalidate(spaceId),
  })
}

export function useRemoveMember() {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: ({ spaceId, email }: { spaceId: string; email: string }) =>
      removeMember(spaceId, email),
    onSuccess: (_d, { spaceId }) => invalidate(spaceId),
  })
}

export function useRenameTeamspace() {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameTeamspace(id, name),
    onSuccess: () => invalidate(),
  })
}

export function useDeleteTeamspace() {
  const invalidate = useInvalidateSpaces()
  return useMutation({
    mutationFn: (id: string) => deleteTeamspace(id),
    onSuccess: () => invalidate(),
  })
}
```

- [ ] **Step 2.4: Проверить**: `yarn build` — упадёт на `META_COLUMNS` (PageMeta теперь требует teamspace_id, а select его не возвращает). Это ожидаемо — чинится в Task 3. Если других ошибок нет — ок, идти дальше.

---

### Task 3: Pages со spaceId

**Files:**
- Modify: `src/features/pages/api.ts`
- Modify: `src/features/pages/usePagesTree.ts`
- Modify: `src/features/pages/usePageMutations.ts`
- Modify: `src/features/pages/Breadcrumbs.tsx`
- Modify: `src/features/pages/HomePage.tsx`

- [ ] **Step 3.1: `api.ts`** — `META_COLUMNS` добавить `teamspace_id`; `fetchPageMetas` и `createPage` принимают `spaceId`:

```ts
const META_COLUMNS = 'id, parent_id, title, position, teamspace_id'

export async function fetchPageMetas(spaceId: string | null): Promise<PageMeta[]> {
  let query = supabase.from('pages').select(META_COLUMNS).order('position')
  query = spaceId ? query.eq('teamspace_id', spaceId) : query.is('teamspace_id', null)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createPage(
  parentId: string | null,
  position: number,
  spaceId: string | null,
): Promise<PageMeta> {
  const { data, error } = await supabase
    .from('pages')
    .insert({ parent_id: parentId, position, title: '', teamspace_id: spaceId })
    .select(META_COLUMNS)
    .single()
  if (error) throw error
  return data
}
```

`insertPages` (импорт из Notion) не трогаем: teamspace_id не передаётся → null → личное, по спеке.

- [ ] **Step 3.2: `usePagesTree.ts`** — параметр spaceId, ключ `['pages', spaceId]`:

```ts
export function usePagesTree(spaceId: string | null) {
  const query = useQuery({
    queryKey: ['pages', spaceId],
    queryFn: () => fetchPageMetas(spaceId),
  })
  const tree = useMemo(() => buildTree(query.data ?? []), [query.data])
  return { ...query, tree, metas: query.data ?? [] }
}
```

- [ ] **Step 3.3: `usePageMutations.ts`** — все хуки принимают `spaceId: string | null`; читать/инвалидировать `['pages', spaceId]`:

```ts
export function useCreatePage(spaceId: string | null) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: (parentId: string | null) => {
      const metas = queryClient.getQueryData<PageMeta[]>(['pages', spaceId]) ?? []
      const siblings = metas.filter((m) => m.parent_id === parentId)
      return createPage(parentId, positionAfterLast(siblings), spaceId)
    },
    onSuccess: async (page) => {
      await queryClient.invalidateQueries({ queryKey: ['pages', spaceId] })
      navigate(`/page/${page.id}`)
    },
  })
}
```

`useRenamePage` — инвалидирует `{ queryKey: ['pages'] }` (префикс покрывает все пространства, spaceId не нужен). `useDeletePage(spaceId)` — инвалидирует `['pages', spaceId]`. `useMovePage(spaceId)`: в `onMutate`/`onError`/`onSettled` заменить ключ `['pages']` на `['pages', spaceId]` (инвалидации `['page', parentId]` остаются как есть).

- [ ] **Step 3.4: `Breadcrumbs.tsx`** — компонент получает пространство страницы из самой страницы. Открыть файл, найти `usePagesTree()` и вызов `getAncestry`; пробросить `spaceId` пропсом из `PageView` (`page.teamspace_id`):

```tsx
// Breadcrumbs.tsx: сигнатура
export default function Breadcrumbs({ pageId, spaceId }: { pageId: string; spaceId: string | null }) {
  const { metas } = usePagesTree(spaceId)
  ...
}
// PageView.tsx (PageContent):
<Breadcrumbs pageId={page.id} spaceId={page.teamspace_id} />
```

`Page` наследует `PageMeta`, поэтому `page.teamspace_id` уже типизирован; `fetchPage` использует `META_COLUMNS` и вернёт его автоматически.

- [ ] **Step 3.5: `HomePage.tsx`** — список «Мои страницы» = личные корни: заменить `usePagesTree()` на `usePagesTree(null)`.

- [ ] **Step 3.6: Временная заглушка, чтобы собрать проект**: в `Sidebar.tsx` заменить `usePagesTree()` → `usePagesTree(null)`, `useCreatePage()` → `useCreatePage(null)`, `useMovePage()` → `useMovePage(null)`; в `PageTreeItem.tsx` — `useCreatePage(...)`/`useDeletePage(...)` пока тоже `(null)` (в Task 4 сюда придёт настоящий spaceId).

- [ ] **Step 3.7: Проверить**: `yarn build` и `yarn lint` чистые; в браузере личное дерево работает как раньше (создание, dnd, удаление).

- [ ] **Step 3.8: Пауза — предложить пользователю коммит** «Teamspaces: pages-слой параметризован spaceId».

---

### Task 4: Сайдбар — секции пространств

**Files:**
- Create: `src/features/pages/SpaceTree.tsx`
- Modify: `src/features/pages/Sidebar.tsx`
- Modify: `src/features/pages/PageTreeItem.tsx`

- [ ] **Step 4.1: Вынести дерево+dnd в `SpaceTree.tsx`.** Перенести из текущего `Sidebar.tsx` всё, что касается одного дерева: `loadExpanded`/`saveExpanded` (ключ localStorage теперь `sidebar-expanded:${spaceId ?? 'personal'}`), `OverlayTree`, `RootDropZone`, состояние `expanded`/`drag`, сенсоры, `handleDragStart`/`handleDragEnd`, `DndContext` с деревом. Компонент:

```tsx
interface SpaceTreeProps {
  spaceId: string | null
}

export default function SpaceTree({ spaceId }: SpaceTreeProps) {
  const { tree, isLoading } = usePagesTree(spaceId)
  const movePage = useMovePage(spaceId)
  // ...expanded, drag, sensors, обработчики — перенесены из Sidebar как есть,
  // только saveExpanded/loadExpanded получают spaceId в ключе
  return (
    <DndContext ...>
      {tree.map((node) => (
        <PageTreeItem key={node.id} node={node} depth={1} expanded={expanded}
          onToggle={toggle} drag={drag} spaceId={spaceId} />
      ))}
      <RootDropZone />
      <DragOverlay style={{ height: 'auto' }}>...</DragOverlay>
    </DndContext>
  )
}
```

`RootDropZone` остаётся внутри `SpaceTree` — у каждого пространства свой DndContext, id `root-end` не конфликтуют между контекстами.

- [ ] **Step 4.2: `PageTreeItem.tsx`** — новый проп `spaceId: string | null`, прокидывается в `useCreatePage(spaceId)`, `useDeletePage(spaceId)` и рекурсивно детям.

- [ ] **Step 4.3: Переписать `Sidebar.tsx`** на секции:

```tsx
import { useState } from 'react'
import SpaceTree from './SpaceTree'
import { useCreatePage } from './usePageMutations'
import { useCreateTeamspace, useTeamspaces } from '../teamspaces/useTeamspaces'
import TeamspaceSettingsModal from '../teamspaces/TeamspaceSettingsModal'
import type { Teamspace } from '../../lib/types'

function SectionHeader({ title, onAdd, onSettings }: {
  title: string
  onAdd: () => void
  onSettings?: () => void
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      color: 'var(--color-text-muted)', fontSize: 13, marginTop: 8 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      <span style={{ display: 'inline-flex', flexShrink: 0 }}>
        {onSettings && <button type="button" title="Настройки" onClick={onSettings}>⚙</button>}
        <button type="button" title="Новая страница" onClick={onAdd}>+</button>
      </span>
    </div>
  )
}

function SpaceSection({ space, onSettings }: { space: Teamspace; onSettings: () => void }) {
  const createPage = useCreatePage(space.id)
  return (
    <>
      <SectionHeader title={space.name} onAdd={() => createPage.mutate(null)} onSettings={onSettings} />
      <SpaceTree spaceId={space.id} />
    </>
  )
}

export default function Sidebar() {
  const { data: spaces } = useTeamspaces()
  const createPersonalPage = useCreatePage(null)
  const createSpace = useCreateTeamspace()
  const [settingsSpace, setSettingsSpace] = useState<Teamspace | null>(null)

  function handleCreateSpace() {
    const name = window.prompt('Название teamspace:')
    if (name?.trim()) createSpace.mutate(name.trim())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <SectionHeader title="Личное" onAdd={() => createPersonalPage.mutate(null)} />
      <SpaceTree spaceId={null} />
      {(spaces ?? []).map((space) => (
        <SpaceSection key={space.id} space={space} onSettings={() => setSettingsSpace(space)} />
      ))}
      <button type="button" className="ghost-button" onClick={handleCreateSpace}>
        + Новый teamspace
      </button>
      {settingsSpace && (
        <TeamspaceSettingsModal space={settingsSpace} onClose={() => setSettingsSpace(null)} />
      )}
    </div>
  )
}
```

Примечание: «Личное» занимает оставшееся место через `RootDropZone` (flex: 1) внутри SpaceTree — проверить визуально; если секции разъезжаются, заменить у RootDropZone `flex: 1` на фиксированный `minHeight: 24` (граница: зона дропа в корень всё ещё нужна).

- [ ] **Step 4.4: Проверить в браузере**: секция «Личное» работает (дерево, dnd, создание); «+ Новый teamspace» создаёт пространство, секция появляется с пустым деревом; «+» в секции тимспейса создаёт страницу именно в нём (проверить SQL-ом: `select title, teamspace_id from pages where teamspace_id is not null` — строка есть). До Task 5 модалка настроек ещё не существует — временно передать `onSettings={undefined}` или закомментировать кнопку, если сборка падает.

- [ ] **Step 4.5: `yarn build`, `yarn lint`** — чистые.

- [ ] **Step 4.6: Пауза — коммит** «Teamspaces: секции пространств в сайдбаре, деревья со spaceId».

---

### Task 5: Модалка настроек тимспейса

**Files:**
- Create: `src/features/teamspaces/TeamspaceSettingsModal.tsx`

Перед написанием открыть `src/features/kanban/TaskEditModal.tsx` и использовать те же классы/структуру модалки (оверлей, карточка), чтобы стиль совпадал.

- [ ] **Step 5.1: Создать компонент.** Текущий пользователь берётся из существующего хука `useAuth()` (`src/features/auth/useAuth.ts`, возвращает `{ session }`). Стиль модалки скопировать из `TaskEditModal.tsx` (тот же оверлей/карточка — подставить реальные классы из него вместо `modal-overlay`/`modal-card`, если они называются иначе):

```tsx
import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import type { Teamspace } from '../../lib/types'
import {
  useDeleteTeamspace,
  useInviteMember,
  useMembers,
  useRemoveMember,
  useRenameTeamspace,
} from './useTeamspaces'

interface Props {
  space: Teamspace
  onClose: () => void
}

export default function TeamspaceSettingsModal({ space, onClose }: Props) {
  const { session } = useAuth()
  const userId = session?.user.id
  const isOwner = userId === space.owner_id

  const { data: members } = useMembers(space.id)
  const invite = useInviteMember()
  const remove = useRemoveMember()
  const rename = useRenameTeamspace()
  const deleteSpace = useDeleteTeamspace()
  const [name, setName] = useState(space.name)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')

  function handleInvite() {
    setError('')
    invite.mutate(
      { spaceId: space.id, email: email.trim() },
      {
        onSuccess: () => setEmail(''),
        onError: (e) => setError(e instanceof Error ? e.message : 'Не удалось пригласить'),
      },
    )
  }

  function handleDeleteSpace() {
    if (!window.confirm('Удалить teamspace со всеми страницами и задачами?')) return
    deleteSpace.mutate(space.id, { onSuccess: onClose })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Настройки teamspace</h2>

        <label style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Название
        </label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!isOwner} />
          {isOwner && (
            <button
              type="button"
              onClick={() => rename.mutate({ id: space.id, name: name.trim() })}
              disabled={!name.trim() || name.trim() === space.name}
            >
              Сохранить
            </button>
          )}
        </div>

        <label style={{ display: 'block', fontSize: 13, color: 'var(--color-text-muted)' }}>
          Участники
        </label>
        <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 16px' }}>
          {(members ?? []).map((m) => (
            <li
              key={m.email}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.email}
                {m.role === 'owner' && ' · владелец'}
                {m.user_id === null && ' · ждёт регистрации'}
              </span>
              {m.role !== 'owner' && (isOwner || m.user_id === userId) && (
                <button
                  type="button"
                  title={m.user_id === userId ? 'Покинуть' : 'Удалить'}
                  onClick={() =>
                    remove.mutate(
                      { spaceId: space.id, email: m.email },
                      { onSuccess: m.user_id === userId ? onClose : undefined },
                    )
                  }
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>

        {isOwner && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="email"
                placeholder="email участника"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button type="button" onClick={handleInvite} disabled={!email.trim()}>
                Пригласить
              </button>
            </div>
            {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
            <button
              type="button"
              style={{ color: 'var(--color-danger)', marginTop: 16 }}
              onClick={handleDeleteSpace}
            >
              Удалить teamspace
            </button>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5.2: Сверить классы модалки** с `TaskEditModal.tsx` и `index.css` — заменить `modal-overlay`/`modal-card` на реально существующие, чтобы стиль совпадал с канбаном.

- [ ] **Step 5.3: Подключить в Sidebar** (если в Task 4 кнопка была закомментирована — вернуть).

- [ ] **Step 5.4: Проверить в браузере**: переименование меняет заголовок секции; инвайт несуществующего email добавляет строку «ждёт регистрации»; инвайт существующего (второй тестовый аккаунт) — строку с доступом; повторный инвайт того же email показывает ошибку (дубль ключа); удаление участника убирает строку; «Удалить teamspace» убирает секцию.

- [ ] **Step 5.5: `yarn build`, `yarn lint`; пауза — коммит** «Teamspaces: модалка настроек — состав, инвайты, переименование, удаление».

---

### Task 6: Канбан со spaceId

**Files:**
- Modify: `src/features/kanban/api.ts` (открыть и привести fetchTasks/createTask по аналогии с pages)
- Modify: `src/features/kanban/useTasks.ts`
- Modify: `src/features/kanban/KanbanPage.tsx`

- [ ] **Step 6.1: `api.ts` канбана** — `fetchTasks(spaceId: string | null)` добавляет `.eq('teamspace_id', spaceId)` / `.is('teamspace_id', null)`; `createTask` принимает и вставляет `teamspace_id` (тип `NewTask` дополнить полем `teamspace_id: string | null`).

- [ ] **Step 6.2: `useTasks.ts`** — `useTasks(spaceId)` с ключом `['tasks', spaceId]`; `useCreateTask(spaceId)`, `useUpdateTask(spaceId)`, `useDeleteTask(spaceId)`, `useMoveTask(spaceId)` — везде ключ `['tasks', spaceId]` (в `useMoveTask` также в `onMutate`/`onError`).

- [ ] **Step 6.3: `KanbanPage.tsx`** — селектор пространства над доской:

```tsx
const { data: spaces } = useTeamspaces()
const [spaceId, setSpaceId] = useState<string | null>(null)
// над доской:
<select
  value={spaceId ?? ''}
  onChange={(e) => setSpaceId(e.target.value || null)}
  style={{ marginBottom: 16 }}
>
  <option value="">Личное</option>
  {(spaces ?? []).map((s) => (
    <option key={s.id} value={s.id}>{s.name}</option>
  ))}
</select>
```

`useTasks(spaceId)`, `useMoveTask(spaceId)` и прокинуть spaceId туда, где создаются задачи (quick add в `KanbanColumn` — найти `useCreateTask` по grep и добавить параметр).

- [ ] **Step 6.4: Проверить в браузере**: «Личное» — старые задачи на месте; выбор тимспейса — пустая доска, создание/перенос задач работает; SQL: `select title, teamspace_id from tasks where teamspace_id is not null` — строки есть.

- [ ] **Step 6.5: `yarn build`, `yarn lint`; пауза — коммит** «Teamspaces: канбан со spaceId и переключателем пространств».

---

### Task 7: Realtime

**Files:**
- Create: `src/features/teamspaces/useSpaceRealtime.ts`
- Modify: `src/components/AppLayout.tsx`

- [ ] **Step 7.1: Создать хук**:

```ts
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// Подписка на изменения pages/tasks тимспейсов: чужие правки инвалидируют
// списки без перезагрузки. Личное пространство не подписываем — там один
// пользователь. Контент открытой страницы подтянется через ['page', id].
export function useSpaceRealtime(spaceIds: string[]) {
  const queryClient = useQueryClient()
  const key = spaceIds.slice().sort().join(',')

  useEffect(() => {
    if (!key) return
    const channel = supabase.channel('teamspace-changes')
    for (const spaceId of key.split(',')) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pages', filter: `teamspace_id=eq.${spaceId}` },
        (payload) => {
          void queryClient.invalidateQueries({ queryKey: ['pages', spaceId] })
          const row = (payload.new ?? payload.old) as { id?: string }
          if (row?.id) void queryClient.invalidateQueries({ queryKey: ['page', row.id] })
        },
      )
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `teamspace_id=eq.${spaceId}` },
        () => void queryClient.invalidateQueries({ queryKey: ['tasks', spaceId] }),
      )
    }
    channel.subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [key, queryClient])
}
```

- [ ] **Step 7.2: Подключить в `AppLayout.tsx`** (он рендерится только для залогиненных):

```tsx
const { data: spaces } = useTeamspaces()
useSpaceRealtime((spaces ?? []).map((s) => s.id))
```

- [ ] **Step 7.3: Проверить вдвоём**: два окна (обычное + инкогнито), два аккаунта в одном тимспейсе. Аккаунт A создаёт страницу в тимспейсе — у B секция обновляется без перезагрузки (допустима задержка 1–2 с). A редактирует контент страницы, открытой у B, — у B контент обновляется после сохранения A (ремаунт по dataUpdatedAt). Перенос задачи на канбане A виден у B.

Если события не приходят: проверить Dashboard → Database → Replication, что `pages`/`tasks` в публикации `supabase_realtime` (Step 1.1 добавлял их SQL-ом).

- [ ] **Step 7.4: `yarn build`, `yarn lint`; пауза — коммит** «Teamspaces: realtime-инвалидация списков».

---

### Task 8: Приёмка по спеке

- [ ] **8.1** Пользователь A создаёт тимспейс, приглашает зарегистрированного B → B сразу видит секцию (после рефетча/перезахода), редактирует страницы и задачи; A видит правки B без перезагрузки.
- [ ] **8.2** Инвайт незарегистрированного email → регистрация с этим email → тимспейс виден автоматически.
- [ ] **8.3** Личные данные изолированы: под B выполнить в консоли браузера прямой запрос `await supabase.from('pages').select('*').is('teamspace_id', null)` — вернутся только страницы B.
- [ ] **8.4** Владелец удаляет B из тимспейса → у B доступ пропадает (после обновления), прямые запросы к страницам тимспейса возвращают пусто.
- [ ] **8.5** Регресс личного: дерево, dnd с переездом ссылок, импорт из Notion, канбан «Личное» — работают как раньше.
- [ ] **8.6** Финальные `yarn build`, `yarn lint`; пауза — финальный коммит.
