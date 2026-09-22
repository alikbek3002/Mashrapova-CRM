-- =====================================================================
-- Менеджеры получают доступ ко всей базе детей (решение директора 08-20).
--
-- Отменяет scoping из 20260522000003: раньше обычный manager видел и
-- редактировал только детей со своим responsible_manager_id, из-за чего:
--   * не видел «чужих» детей, их семьи, платежи, абонементы, посещения;
--   * не мог продать абонемент / принять оплату по чужому ребёнку
--     (бэкенд пускал, но клиентская выборка была пустой);
--   * падал с 42501 при создании ребёнка, если ответственным выбран
--     другой менеджер (children_staff_write with check).
--
-- Все политики (children, families, club_cards, payments, freezes,
-- attendance, enrollments, deposits) ссылаются на can_see_all_children(),
-- поэтому достаточно включить 'manager' в список ролей.
--
-- Триггеры trg_children_set_manager / trg_families_set_manager остаются:
-- ответственный менеджер по-прежнему проставляется автоматически, если
-- не выбран явно, — теперь это учёт, а не граница доступа.
-- =====================================================================

create or replace function can_see_all_children() returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(auth_role() in
    ('director','fitness_director','senior_manager','manager','cashier'), false)
$$;

notify pgrst, 'reload schema';
