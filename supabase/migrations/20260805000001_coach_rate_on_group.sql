-- =====================================================================
-- Ставка тренера переезжает с абонемента на ГРУППУ.
--
-- Было: club_cards.coach_rate_per_lesson — ставка задавалась при продаже
-- каждой карты, зарплата собиралась lateral-подбором карты на дату.
-- Стало: groups.coach_rate_per_child — одна ставка на группе; логика
-- прежняя — тренер получает ставку за КАЖДОГО фактически пришедшего
-- (present) ребёнка на завершённом не-пробном занятии.
--
-- Колонку на картах не удаляем (история продаж), но расчёт её больше
-- не читает. Продажа абонемента поле ставки больше не показывает.
-- =====================================================================

alter table groups
  add column if not exists coach_rate_per_child numeric(10, 2) not null default 100
    check (coach_rate_per_child >= 0);

comment on column groups.coach_rate_per_child is
  'Сколько тренер получает за каждого пришедшего ребёнка на занятии этой группы.';

-- Бэкфилл: самая распространённая ставка среди карт детей группы —
-- если ставки правили руками, группа унаследует привычное значение.
update groups g
   set coach_rate_per_child = sub.rate
  from (
    select e.group_id,
           cc.coach_rate_per_lesson as rate,
           row_number() over (
             partition by e.group_id
             order by count(*) desc, cc.coach_rate_per_lesson desc
           ) as rn
      from enrollments e
      join club_cards cc on cc.child_id = e.child_id
     where e.archived_at is null
     group by e.group_id, cc.coach_rate_per_lesson
  ) sub
 where sub.group_id = g.id
   and sub.rn = 1
   and sub.rate is not null;

-- ---------------------------------------------------------------------
-- Факт: ставка группы за каждую present-отметку.
-- ---------------------------------------------------------------------
create or replace function compute_coach_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
as $$
  select coalesce(sum(g.coach_rate_per_child), 0)
    from lessons l
    join attendance a
      on a.lesson_id = l.id
     and a.status = 'present'
    join groups g on g.id = l.group_id
   where l.coach_id = p_coach
     and l.date between p_from and p_to
     and l.type <> 'trial'
     and l.status = 'completed';
$$;

-- ---------------------------------------------------------------------
-- Прогноз: будущие scheduled-занятия × дети, чьё окно записи покрывает
-- дату занятия, по ставке группы.
-- ---------------------------------------------------------------------
create or replace function project_coach_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
as $$
  select coalesce(sum(g.coach_rate_per_child), 0)
    from lessons l
    join groups g on g.id = l.group_id
    join enrollments e
      on e.group_id = l.group_id
     and e.archived_at is null
     and (e.start_date is null or e.start_date <= l.date)
     and (e.end_date   is null or e.end_date   >= l.date)
   where l.coach_id = p_coach
     and l.date between p_from and p_to
     and l.date >= current_date
     and l.type <> 'trial'
     and l.status = 'scheduled';
$$;

-- ---------------------------------------------------------------------
-- Максимум за период: каждый зачисленный ребёнок пришёл бы на все
-- занятия своего окна.
-- ---------------------------------------------------------------------
create or replace function compute_coach_max_payroll(
  p_coach uuid, p_from date, p_to date
) returns numeric
language sql stable security definer
as $$
  select coalesce(sum(g.coach_rate_per_child), 0)
    from lessons l
    join groups g on g.id = l.group_id
    join enrollments e
      on e.group_id = l.group_id
     and e.archived_at is null
     and (e.start_date is null or e.start_date <= l.date)
     and (e.end_date   is null or e.end_date   >= l.date)
   where l.coach_id = p_coach
     and l.date between p_from and p_to
     and l.type <> 'trial'
     and l.status not in ('cancelled', 'force_majeure');
$$;

notify pgrst, 'reload schema';
