-- =====================================================================
-- Бесконечная рекурсия в RLS персональных тренировок.
--
-- pt_sessions_parent_select читает pt_lessons, а pt_lessons_coach_select
-- читает pt_sessions — Postgres видит цикл и падает с
-- «infinite recursion detected in policy for relation pt_sessions» на любом
-- запросе, который задевает эти таблицы (в том числе profiles при входе —
-- через profiles_parent_read_pt_coaches). На чистой базе из-за этого
-- никто не мог войти.
--
-- Решение: id считаем в security definer функциях (без повторной проверки
-- RLS). Смысл доступа тот же, что был в политиках.
-- =====================================================================

-- Сессии ПТ, в которых есть дети текущего родителя.
create or replace function parent_pt_session_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$
  select l.session_id
  from pt_lessons l
  join children c on c.id = l.child_id
  join families f on f.id = c.family_id
  where f.parent_user_id = auth.uid()
$$;

-- Сессии ПТ текущего тренера (основной или фактический тренер).
create or replace function coach_pt_session_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$
  select s.id from pt_sessions s
  where s.coach_id = auth.uid() or s.actual_coach_id = auth.uid()
$$;

-- Тренеры ПТ детей текущего родителя (по пакетам и по занятиям).
create or replace function parent_pt_coach_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$
  select p.coach_id
  from pt_packages p
  join children c on c.id = p.child_id
  join families f on f.id = c.family_id
  where f.parent_user_id = auth.uid()
  union
  select x.coach_id
  from pt_sessions s
  join pt_lessons l on l.session_id = s.id
  join children c on c.id = l.child_id
  join families f on f.id = c.family_id
  cross join lateral (values (s.coach_id), (s.actual_coach_id)) as x(coach_id)
  where f.parent_user_id = auth.uid() and x.coach_id is not null
$$;

alter policy pt_sessions_parent_select on pt_sessions
  using (is_parent() and id in (select parent_pt_session_ids()));

alter policy pt_lessons_coach_select on pt_lessons
  using (is_coach() and session_id in (select coach_pt_session_ids()));

alter policy profiles_parent_read_pt_coaches on profiles
  using (is_parent() and id in (select parent_pt_coach_ids()));

notify pgrst, 'reload schema';
