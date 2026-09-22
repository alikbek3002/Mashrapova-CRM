-- =====================================================================
-- Manager-scoped доступ к детям + полноценный flow заморозок.
--
-- Контекст:
--   1. Дети раздаются по менеджерам (children.responsible_manager_id).
--      До этой миграции RLS пускал любого офис-сотрудника видеть всех
--      детей — менеджер Алик видел детей Чингиза. Теперь:
--        director / fitness_director / senior_manager / cashier → все
--        manager → только свои закреплённые
--        coach → через enrollments (как было)
--        parent → через family (как было)
--   2. Заморозки: родитель может запросить, manager-кому-привязан-ребёнок
--      может одобрить/отклонить (раньше только director/sr/fitness).
--      Уведомления родителю при approve/reject — добавляем в бэке;
--      RLS просто открывает запись.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Helper-функции
-- ---------------------------------------------------------------------

-- Роли, которые видят всех детей организации без manager-фильтра.
create or replace function can_see_all_children() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(auth_role() in
    ('director','fitness_director','senior_manager','cashier'), false)
$$;

-- Текущий пользователь — закреплённый менеджер этого ребёнка?
create or replace function is_responsible_manager(p_child_id uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from children c
    where c.id = p_child_id
      and c.responsible_manager_id = auth.uid()
  )
$$;

-- ---------------------------------------------------------------------
-- 2. Auto-присвоение responsible_manager_id при insert
--
-- Менеджер, добавляющий ребёнка, автоматически становится ответственным.
-- Старшие роли могут указать manager_id явно (или null = ничей).
-- ---------------------------------------------------------------------
create or replace function fn_children_set_manager() returns trigger
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

drop trigger if exists trg_children_set_manager on children;
create trigger trg_children_set_manager
  before insert on children
  for each row execute function fn_children_set_manager();

-- ---------------------------------------------------------------------
-- 3. children RLS — пересоздаём select/write для staff
-- ---------------------------------------------------------------------
drop policy if exists children_staff_select on children;
create policy children_staff_select on children for select
using (
  is_staff()
  and organization_id = auth_org()
  and (can_see_all_children() or responsible_manager_id = auth.uid())
);

drop policy if exists children_staff_write on children;
create policy children_staff_write on children for all
using (
  is_staff()
  and organization_id = auth_org()
  and (can_see_all_children() or responsible_manager_id = auth.uid())
)
with check (
  is_staff()
  and organization_id = auth_org()
  and (can_see_all_children() or responsible_manager_id = auth.uid())
);

-- ---------------------------------------------------------------------
-- 4. Families — менеджер видит семьи только своих детей
-- ---------------------------------------------------------------------
drop policy if exists families_staff_select on families;
create policy families_staff_select on families for select
using (
  is_staff()
  and organization_id = auth_org()
  and (
    can_see_all_children()
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
    or id in (select family_id from children where responsible_manager_id = auth.uid())
  )
)
with check (
  is_staff()
  and organization_id = auth_org()
);

-- ---------------------------------------------------------------------
-- 5. Каскад: club_cards, freezes, deposit, payments, attendance, enrollments
--    — manager видит записи только своих детей.
-- ---------------------------------------------------------------------
drop policy if exists club_cards_staff_read on club_cards;
create policy club_cards_staff_read on club_cards for select
using (
  is_staff()
  and organization_id = auth_org()
  and (can_see_all_children() or child_id in (select id from children where responsible_manager_id = auth.uid()))
);

drop policy if exists freezes_staff_read on freezes;
create policy freezes_staff_read on freezes for select
using (
  is_staff()
  and (can_see_all_children() or child_id in (select id from children where responsible_manager_id = auth.uid()))
);

drop policy if exists payments_staff_read on payments;
create policy payments_staff_read on payments for select
using (
  is_staff()
  and organization_id = auth_org()
  and (can_see_all_children() or child_id in (select id from children where responsible_manager_id = auth.uid()))
);

drop policy if exists attendance_staff_read on attendance;
create policy attendance_staff_read on attendance for select
using (
  is_staff()
  and (can_see_all_children() or child_id in (select id from children where responsible_manager_id = auth.uid()))
);

drop policy if exists enrollments_staff_read on enrollments;
create policy enrollments_staff_read on enrollments for select
using (
  is_staff()
  and exists (select 1 from groups g where g.id = enrollments.group_id and g.organization_id = auth_org())
  and (can_see_all_children() or child_id in (select id from children where responsible_manager_id = auth.uid()))
);

-- deposit_transactions: пересоздаём staff_read с manager-фильтром.
drop policy if exists dep_tx_staff_read on deposit_transactions;
create policy dep_tx_staff_read on deposit_transactions for select
using (
  is_staff()
  and organization_id = auth_org()
  and (can_see_all_children() or child_id in (select id from children where responsible_manager_id = auth.uid()))
);

drop policy if exists child_deposits_staff_read on child_deposits;
create policy child_deposits_staff_read on child_deposits for select
using (
  is_staff()
  and organization_id = auth_org()
  and (can_see_all_children() or child_id in (select id from children where responsible_manager_id = auth.uid()))
);

-- ---------------------------------------------------------------------
-- 6. Freezes — родитель может запросить (status=pending) для своих детей
-- ---------------------------------------------------------------------
drop policy if exists freezes_parent_insert on freezes;
create policy freezes_parent_insert on freezes for insert
with check (
  is_parent()
  and status = 'pending'
  and initiated_by = auth.uid()
  and child_id in (
    select c.id from children c
    join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------
-- 7. Notifications — родитель читает свои; staff читают всё.
--    (Если политики уже есть — пропускаем.)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'notifications' and policyname = 'notifications_self_read'
  ) then
    alter table notifications enable row level security;
    create policy notifications_self_read on notifications for select
      using (recipient_id = auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Обновляем кэш схемы PostgREST
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
