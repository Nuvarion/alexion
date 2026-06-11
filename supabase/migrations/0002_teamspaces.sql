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
  email        text not null check (email = lower(email)),
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

-- Родитель страницы обязан быть в том же пространстве (и для личных
-- страниц — у того же пользователя): RLS проверяет только саму строку,
-- а check_page_depth читает родителя под RLS вызывающего и чужого
-- родителя «не видит». security definer — чтобы видеть родителя всегда.
-- Смена teamspace_id у страницы с детьми не валидируется: в v1 такого пути
-- нет (никто не пишет teamspace_id после insert); фича «перенос страницы
-- между пространствами» обязана начать с пересмотра этого триггера.
create function check_page_space() returns trigger
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
  if new.teamspace_id is null and parent.user_id <> new.user_id then
    raise exception 'parent page belongs to another user';
  end if;
  return new;
end $$;

create trigger pages_space_check
  before insert or update of parent_id, teamspace_id on pages
  for each row execute function check_page_space();

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
  begin
    insert into teamspace_members (teamspace_id, email, user_id, role)
      values (space_id, normalized, existing_user, 'member');
  exception when unique_violation then
    raise exception 'already invited';
  end;
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
