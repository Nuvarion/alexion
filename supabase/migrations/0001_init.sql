-- Схема: страницы с вложенностью (max 10) и задачи канбана.
-- Применять в Supabase SQL Editor (или supabase db push).

create type task_status as enum ('todo', 'in_progress', 'done');

create table pages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id   uuid references pages (id) on delete cascade,
  title       text not null default '',
  content     jsonb not null default '[]'::jsonb,
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index pages_user_idx on pages (user_id);
create index pages_parent_idx on pages (parent_id);

create table tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  description text not null default '',
  status      task_status not null default 'todo',
  position    double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index tasks_user_idx on tasks (user_id);

-- updated_at

create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

create trigger pages_updated_at before update on pages
  for each row execute function set_updated_at();

create trigger tasks_updated_at before update on tasks
  for each row execute function set_updated_at();

-- Лимит вложенности 10 + защита от самоссылки и циклов.
-- Клиентская проверка дублирует это только для UX.

create function check_page_depth() returns trigger as $$
declare
  ancestor_depth int;
  is_cycle boolean;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.id = new.parent_id then
    raise exception 'page cannot be its own parent';
  end if;

  with recursive anc as (
    select id, parent_id, 1 as d from pages where id = new.parent_id
    union all
    select p.id, p.parent_id, anc.d + 1
    from pages p
    join anc on p.id = anc.parent_id
    where anc.d < 12
  )
  select max(d), bool_or(id = new.id) into ancestor_depth, is_cycle from anc;

  if is_cycle then
    raise exception 'cannot move page into its own subtree';
  end if;
  if ancestor_depth >= 10 then
    raise exception 'max page depth (10) exceeded';
  end if;
  return new;
end $$ language plpgsql;

create trigger pages_depth_check before insert or update of parent_id on pages
  for each row execute function check_page_depth();

-- RLS: каждый видит только свои строки

alter table pages enable row level security;
alter table tasks enable row level security;

create policy pages_select on pages for select using (auth.uid() = user_id);
create policy pages_insert on pages for insert with check (auth.uid() = user_id);
create policy pages_update on pages for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy pages_delete on pages for delete using (auth.uid() = user_id);

create policy tasks_select on tasks for select using (auth.uid() = user_id);
create policy tasks_insert on tasks for insert with check (auth.uid() = user_id);
create policy tasks_update on tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy tasks_delete on tasks for delete using (auth.uid() = user_id);
