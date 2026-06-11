-- Лимит вложенности страниц поднят с 10 до 15 (синхронно с MAX_PAGE_DEPTH
-- на фронтенде). Потолок обхода CTE = лимит + 2 — страховка от циклов.

create or replace function check_page_depth() returns trigger as $$
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
    where anc.d < 17
  )
  select max(d), bool_or(id = new.id) into ancestor_depth, is_cycle from anc;

  if is_cycle then
    raise exception 'cannot move page into its own subtree';
  end if;
  if ancestor_depth >= 15 then
    raise exception 'max page depth (15) exceeded';
  end if;
  return new;
end $$ language plpgsql;
