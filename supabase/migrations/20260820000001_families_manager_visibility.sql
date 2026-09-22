-- =====================================================================
-- Менеджер не мог создать семью (а значит и карточку ребёнка):
-- PostgREST выполняет INSERT ... RETURNING, а families_staff_select
-- показывает обычному менеджеру только семьи, в которых уже есть его
-- дети. Свежесозданная семья детей не имеет → RETURNING не проходит
-- SELECT-политику → 42501 «new row violates row-level security policy
-- for table "families"».
--
-- Фикс:
--   1) авто-присвоение families.responsible_manager_id при insert
--      обычным менеджером (зеркало fn_children_set_manager);
--   2) политики семей учитывают families.responsible_manager_id —
--      менеджер видит и редактирует семьи, где он «менеджер семьи»,
--      плюс, как раньше, семьи со своими детьми.
-- =====================================================================

create or replace function fn_families_set_manager() returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if new.responsible_manager_id is null then
    select role into v_role from profiles where id = auth.uid();
    if v_role = 'manager' then
      new.responsible_manager_id := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_families_set_manager on families;
create trigger trg_families_set_manager
  before insert on families
  for each row execute function fn_families_set_manager();

drop policy if exists families_staff_select on families;
create policy families_staff_select on families for select
using (
  is_staff()
  and organization_id = auth_org()
  and (
    can_see_all_children()
    or responsible_manager_id = auth.uid()
    or id in (select family_id from children where responsible_manager_id = auth.uid())
  )
);

drop policy if exists families_staff_write on families;
create policy families_staff_write on families for all
using (
  is_staff()
  and organization_id = auth_org()
  and (
    can_see_all_children()
    or responsible_manager_id = auth.uid()
    or id in (select family_id from children where responsible_manager_id = auth.uid())
  )
)
with check (
  is_staff()
  and organization_id = auth_org()
);
