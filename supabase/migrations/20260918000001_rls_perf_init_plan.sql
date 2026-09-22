-- =====================================================================
-- RLS performance: initplan-кэш хелперов + удаление мёртвых веток scoping.
--
-- Проблема (жалоба офиса 2026-09-18: дашборд/списки пустые у директора и
-- менеджеров): SELECT-политики вызывали is_staff()/auth_org()/
-- can_see_all_children() (SECURITY DEFINER → SELECT из profiles) НА КАЖДУЮ
-- СТРОКУ, а ветка `child_id IN (SELECT children WHERE responsible_manager_id
-- = auth.uid())` гоняла вложенный скан children на каждую строку families/
-- club_cards/payments/… На embed-запросах (children + families + groups +
-- sections + enrollments) это давало 3–8 c и упиралось в statement_timeout
-- (57014) — PostgREST молча возвращал пусто.
--
-- Два приёма (оба — стандартная рекомендация Supabase, поведение не меняют):
--   1) обернуть вызовы в скалярный подзапрос `(select f())` — планировщик
--      считает их один раз на запрос (InitPlan), а не на строку;
--   2) is_staff() и can_see_all_children() — РОВНО один и тот же набор ролей
--      (director/fitness_director/senior_manager/manager/cashier, см.
--      20260820000005), поэтому при staff-роли `can_see_all_children()`
--      всегда true и ветка `(can_see_all_children() OR child_id IN (...))`
--      тождественно равна TRUE. Убираем вложенный скан children целиком.
--      Границу «staff видит только свою орг» держит organization_id.
--
-- Семантика доступа не меняется: staff по-прежнему видит всю базу своей
-- организации (это и есть поведение с 2026-08-20), coach/parent — свой
-- скоуп. Только быстрее. Откат — восстановить прежние USING (дамп политик
-- сохранён в сессии; либо вернуть OR-ветки).
-- =====================================================================

-- ---- families ----
alter policy families_staff_select on families
  using ((select is_staff()) and organization_id = (select auth_org()));
alter policy families_staff_update on families
  using ((select is_staff()) and organization_id = (select auth_org()))
  with check ((select is_staff()) and organization_id = (select auth_org()));
alter policy families_staff_write on families
  using ((select is_staff()) and organization_id = (select auth_org()))
  with check ((select is_staff()) and organization_id = (select auth_org()));
alter policy families_parent_select on families
  using ((select is_parent()) and parent_user_id = (select auth.uid()));

-- ---- children ----
alter policy children_staff_select on children
  using ((select is_staff()) and organization_id = (select auth_org()));
alter policy children_staff_write on children
  using ((select is_staff()) and organization_id = (select auth_org()))
  with check ((select is_staff()) and organization_id = (select auth_org()));
alter policy children_coach_select on children
  using ((select is_coach()) and id in (select coach_child_ids()));
alter policy children_parent_select on children
  using ((select is_parent()) and family_id in (select parent_family_ids()));

-- ---- club_cards ----
alter policy club_cards_staff_read on club_cards
  using ((select is_staff()) and organization_id = (select auth_org()));
alter policy club_cards_coach_read on club_cards
  using ((select is_coach()) and child_id in (select coach_child_ids()));
alter policy club_cards_parent_read on club_cards
  using ((select is_parent()) and child_id in (select parent_child_ids()));

-- ---- payments ----
alter policy payments_staff_read on payments
  using ((select is_staff()) and organization_id = (select auth_org()));
alter policy payments_parent_read on payments
  using ((select is_parent()) and child_id in (select parent_child_ids()));

-- ---- deposit_transactions ----
alter policy dep_tx_staff_read on deposit_transactions
  using ((select is_staff()) and organization_id = (select auth_org()));
alter policy dep_tx_parent_read on deposit_transactions
  using ((select is_parent()) and child_id in (select parent_child_ids()));

-- ---- child_deposits ----
alter policy child_deposits_staff_read on child_deposits
  using ((select is_staff()) and organization_id = (select auth_org()));
alter policy child_deposits_parent_read on child_deposits
  using ((select is_parent()) and child_id in (select parent_child_ids()));

-- ---- enrollments (у таблицы нет organization_id — орг через groups) ----
alter policy enrollments_staff_read on enrollments
  using ((select is_staff()) and exists (
    select 1 from groups g
    where g.id = enrollments.group_id and g.organization_id = (select auth_org())));
alter policy enrollments_coach_read on enrollments
  using ((select is_coach()) and group_id in (select coach_group_ids()));
alter policy enrollments_parent_read on enrollments
  using ((select is_parent()) and child_id in (select parent_child_ids()));
alter policy enrollments_staff_write on enrollments
  using ((select is_staff()))
  with check ((select is_staff()));

-- ---- groups ----
alter policy groups_read on groups
  using (organization_id = (select auth_org()));
alter policy groups_staff_write on groups
  using ((select is_staff()) and organization_id = (select auth_org()))
  with check ((select is_staff()) and organization_id = (select auth_org()));

-- ---- sections ----
alter policy sections_read on sections
  using (organization_id = (select auth_org()));
alter policy sections_staff_write on sections
  using ((select is_staff()) and organization_id = (select auth_org()))
  with check ((select is_staff()) and organization_id = (select auth_org()));

-- ---- lessons ----
alter policy lessons_staff_read on lessons
  using ((select is_staff()) and organization_id = (select auth_org()));
alter policy lessons_staff_update on lessons
  using ((select is_staff()) and organization_id = (select auth_org()))
  with check ((select is_staff()) and organization_id = (select auth_org()));
alter policy lessons_staff_write on lessons
  with check ((select is_staff()) and organization_id = (select auth_org()));
alter policy lessons_coach_read on lessons
  using ((select is_coach()) and coach_id = (select auth.uid()));
alter policy lessons_parent_read on lessons
  using ((select is_parent()) and group_id in (
    select e.group_id from enrollments e
    where e.child_id in (select parent_child_ids()) and e.archived_at is null));

-- ---- attendance (у таблицы нет organization_id — staff видит по роли) ----
alter policy attendance_staff_read on attendance
  using ((select is_staff()));
alter policy attendance_staff_write on attendance
  using ((select is_staff()))
  with check ((select is_staff()) and exists (
    select 1 from lessons l
    where l.id = attendance.lesson_id and l.date <= current_date));
alter policy attendance_coach_read on attendance
  using ((select is_coach()) and lesson_id in (select coach_lesson_ids()));
alter policy attendance_coach_write on attendance
  using ((select is_coach()) and exists (
    select 1 from lessons l
    where l.id = attendance.lesson_id and l.coach_id = (select auth.uid())))
  with check ((select is_coach()) and exists (
    select 1 from lessons l
    where l.id = attendance.lesson_id and l.coach_id = (select auth.uid())
      and l.date <= current_date and fn_attendance_date_allowed(attendance.child_id, l.date)));
alter policy attendance_parent_read on attendance
  using ((select is_parent()) and child_id in (select parent_child_ids()));

-- ---- freezes (нет organization_id — staff видит по роли) ----
alter policy freezes_staff_read on freezes
  using ((select is_staff()));
alter policy freezes_coach_read on freezes
  using ((select is_coach()) and child_id in (select coach_child_ids()));
alter policy freezes_parent_read on freezes
  using ((select is_parent()) and child_id in (select parent_child_ids()));

notify pgrst, 'reload schema';
