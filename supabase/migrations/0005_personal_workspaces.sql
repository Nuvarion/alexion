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

-- Данные без пространства переезжают в личные workspace своих владельцев.
-- Триггер pages_space_check проверяет родителя per-row, а порядок строк в
-- UPDATE не гарантирован (ребёнок может обновиться раньше родителя) — на
-- время backfill выключаем. Согласованность гарантирует сам запрос: всё
-- дерево одного владельца получает один и тот же workspace (межпользовательское
-- родительство личных страниц невозможно с миграции 0002).
alter table pages disable trigger pages_space_check;

update pages p
  set teamspace_id = t.id
  from teamspaces t
  where p.teamspace_id is null and t.kind = 'personal' and t.owner_id = p.user_id;

alter table pages enable trigger pages_space_check;

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
  -- email обязателен для членства; пользователи без email (phone/anonymous,
  -- если их когда-нибудь включат) не должны блокировать регистрацию
  if new.email is null then
    return new;
  end if;
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

  -- on commit drop не срабатывает между вызовами в одной транзакции
  drop table if exists _subtree;
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
