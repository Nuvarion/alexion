-- Инвайт по email заменён ссылками-приглашениями: без SMTP письмо не
-- отправлялось, и приглашение по адресу не имело смысла. У тимспейса одна
-- постоянная ссылка (/invite/<token>); сброс токена отзывает старую.

create table teamspace_invites (
  teamspace_id uuid primary key references teamspaces (id) on delete cascade,
  token        uuid not null unique default gen_random_uuid(),
  created_at   timestamptz not null default now()
);

-- токен видит и сбрасывает только владелец
alter table teamspace_invites enable row level security;
create policy invites_select on teamspace_invites for select
  using (exists (select 1 from teamspaces t where t.id = teamspace_id and t.owner_id = auth.uid()));
create policy invites_update on teamspace_invites for update
  using (exists (select 1 from teamspaces t where t.id = teamspace_id and t.owner_id = auth.uid()))
  with check (exists (select 1 from teamspaces t where t.id = teamspace_id and t.owner_id = auth.uid()));

-- ссылки для уже существующих тимспейсов
insert into teamspace_invites (teamspace_id) select id from teamspaces;

-- создание тимспейса теперь заводит и ссылку-приглашение
create or replace function create_teamspace(space_name text) returns uuid
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
  insert into teamspace_invites (teamspace_id) values (new_id);
  return new_id;
end $$;

-- Вступление по ссылке: идемпотентно, возвращает id тимспейса
create function accept_invite(invite_token uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  space_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select teamspace_id into space_id from teamspace_invites where token = invite_token;
  if space_id is null then
    raise exception 'invalid invite';
  end if;
  insert into teamspace_members (teamspace_id, email, user_id, role)
    select space_id, lower(email), id, 'member' from auth.users where id = auth.uid()
    on conflict (teamspace_id, email) do nothing;
  return space_id;
end $$;

revoke execute on function accept_invite(uuid) from public;
grant execute on function accept_invite(uuid) to authenticated;

-- email-инвайты больше не используются; ожидавшие регистрации записи неактивируемы
drop function invite_member(uuid, text);
drop trigger on_auth_user_created on auth.users;
drop function claim_memberships();
delete from teamspace_members where user_id is null;
