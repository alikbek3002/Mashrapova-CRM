-- =====================================================================
-- Доступ родителя к профилям прикреплённого менеджера и тренера.
--
-- Проблема: в родительском PWA в карточке ребёнка показываются
-- «Менеджер» и «Тренер», но запросы useProfile() / useChildPrimaryCoach()
-- упирались в RLS на profiles (profiles_self_read разрешает SELECT
-- только для собственного профиля или для is_staff). Родитель не staff
-- → возвращается null → в UI «не назначен».
--
-- Решаем добавлением двух точечных SELECT-политик: разрешаем родителю
-- читать профиль, если он:
--   а) responsible_manager этого родителя для одного из его детей,
--   б) coach в группе, куда зачислен один из его детей.
--
-- Политики OR-объединяются с существующей profiles_self_read.
-- =====================================================================

-- Менеджер ребёнка (children.responsible_manager_id → profiles.id)
drop policy if exists profiles_parent_read_managers on profiles;
create policy profiles_parent_read_managers on profiles
  for select
  using (
    is_parent()
    and exists (
      select 1
        from children c
        join families f on f.id = c.family_id
       where c.responsible_manager_id = profiles.id
         and f.parent_user_id = auth.uid()
         and c.deleted_at is null
    )
  );

-- Тренер группы, куда зачислен ребёнок (enrollments → groups.coach_id)
drop policy if exists profiles_parent_read_coaches on profiles;
create policy profiles_parent_read_coaches on profiles
  for select
  using (
    is_parent()
    and exists (
      select 1
        from enrollments e
        join children c on c.id = e.child_id
        join families f on f.id = c.family_id
        join groups   g on g.id = e.group_id
       where g.coach_id = profiles.id
         and f.parent_user_id = auth.uid()
         and e.archived_at is null
         and c.deleted_at is null
    )
  );
